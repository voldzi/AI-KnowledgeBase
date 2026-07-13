from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from tests.conftest import make_client


BLANK_PDF = (
    b"%PDF-1.7\n%\xc2\xb5\xc2\xb6\n% Written by MuPDF 1.27.2\n\n"
    b"1 0 obj\n<</Type/Catalog/Pages 2 0 R/Info<</Producer(MuPDF 1.27.2)>>>>\nendobj\n\n"
    b"2 0 obj\n<</Type/Pages/Count 1/Kids[4 0 R]>>\nendobj\n\n"
    b"3 0 obj\n<<>>\nendobj\n\n"
    b"4 0 obj\n<</Type/Page/MediaBox[0 0 595 842]/Rotate 0/Resources 3 0 R/Parent 2 0 R>>\nendobj\n\n"
    b"xref\n0 5\n0000000000 65535 f \n0000000042 00000 n \n0000000120 00000 n \n0000000172 00000 n \n0000000193 00000 n \n\n"
    b"trailer\n<</Size 5/Root 1 0 R/ID[<5031C3B1C2B55BC3AB38C29B6DC2B47E><06114F597CD2988A8D9E31295DD2493B>]>>\n"
    b"startxref\n284\n%%EOF\n"
)


def test_text_ingestion_creates_report(tmp_path: Path) -> None:
    source = tmp_path / "policy.md"
    source.write_text(
        "\n\n".join(
            [
                "# Test directive",
                "Article 4 Exception approvals",
                "Paragraph 2 The document owner approves an exception after justification is provided.",
                "Evidence RMO 12/2024 is coordinated through aiip.office@example.cz on 10. 7. 2026.",
                "Another paragraph contains additional rules for a citable chunk.",
            ]
        ),
        encoding="utf-8",
    )

    external_statuses: list[dict[str, str]] = []

    with make_client(tmp_path) as client:
        async def track_external_status(**payload) -> None:
            external_statuses.append(payload)

        client.app.state.registry.update_external_document_current = track_external_status
        response = client.post(
            "/api/v1/ingestion/jobs",
            json={
                "document_id": "doc_123",
                "document_version_id": "ver_456",
                "source_file_uri": str(source),
                "parser_profile": "controlled_document",
                "ocr_enabled": True,
                "chunking_strategy": "legal_structured",
                "embedding_profile": "default",
            },
        )

        body = response.json()
        report = client.get(f"/api/v1/ingestion/jobs/{body['job_id']}/report")
        job = client.get(f"/api/v1/ingestion/jobs/{body['job_id']}")
        jobs = client.get("/api/v1/ingestion/jobs")
        points = client.app.state.indexer.mock_points

    assert response.status_code == 201
    assert body["status"] == "completed"
    assert body["parser_profile"] == "controlled_document"
    assert job.json()["status"] == "completed"
    assert jobs.status_code == 200
    assert jobs.json()[0]["job_id"] == body["job_id"]
    assert report.status_code == 200
    assert report.json()["documents_processed"] == 1
    assert report.json()["chunks_created"] >= 1
    assert report.json()["ocr_used"] is False
    assert report.json()["quality"]["extraction_profile"] == "document_text_v1"
    assert report.json()["quality"]["text_chars_extracted"] > 0
    assert report.json()["errors"] == []
    assert [item["ingestion_status"] for item in external_statuses] == ["INGESTING", "INDEXED"]
    assert all(item["ingestion_job_id"] == body["job_id"] for item in external_statuses)
    payload = points[0]["payload"]
    assert payload["document_title"] == "Mock document doc_123"
    assert payload["version_label"] == "mock"
    assert payload["document_type"] == "directive"
    assert payload["status"] == "valid"
    assert payload["source_file_uri"] == str(source)
    assert payload["source_file_name"] == "policy.md"
    assert payload["source_mime_type"] in {"text/markdown", "text/plain"}
    assert payload["source_size_bytes"] == source.stat().st_size
    assert payload["metadata"]["extraction_profile"] == "document_text_v1"
    entity_payload = next(
        point["payload"]
        for point in points
        if "document_number" in point["payload"]["metadata"]["intelligence"]["entity_types"]
    )
    assert entity_payload["metadata"]["intelligence"]["entity_extraction_profile"] == "rule_based_v1"
    assert "document_number" in entity_payload["metadata"]["intelligence"]["entity_types"]
    assert "email" in entity_payload["metadata"]["intelligence"]["entity_types"]
    assert "date" in entity_payload["metadata"]["intelligence"]["entity_types"]
    assert "RMO12/2024" in entity_payload["entity_values"]
    assert "aiip.office@example.cz" in entity_payload["entity_values"]
    assert "document_number:RMO12/2024" in entity_payload["entity_pairs"]
    assert "email:aiip.office@example.cz" in entity_payload["entity_pairs"]


def test_ocr_sidecar_fallback_marks_warning(tmp_path: Path) -> None:
    source = tmp_path / "scan.txt"
    source.write_text("", encoding="utf-8")
    source.with_suffix(source.suffix + ".ocr.txt").write_text(
        "Article 1 OCR text. This text came from OCR fallback and creates a citable chunk.",
        encoding="utf-8",
    )

    with make_client(tmp_path) as client:
        response = client.post(
            "/api/v1/ingestion/jobs",
            json={
                "document_id": "doc_ocr",
                "document_version_id": "ver_ocr",
                "source_file_uri": str(source),
                "parser_profile": "controlled_document",
                "ocr_enabled": True,
                "chunking_strategy": "legal_structured",
                "embedding_profile": "default",
            },
        )
        report = client.get(f"/api/v1/ingestion/jobs/{response.json()['job_id']}/report")

    assert response.status_code == 201
    assert response.json()["status"] == "completed_with_warnings"
    assert report.json()["ocr_used"] is True
    assert report.json()["quality"]["parser_engine"] == "ocr_sidecar"
    assert report.json()["quality"]["quality_tier"] == "good"
    assert report.json()["quality"]["requires_review"] is False
    assert "ocr_text_sidecar" in report.json()["quality"]["capabilities"]
    assert {warning["code"] for warning in report.json()["warnings"]} == {"NO_TEXT_EXTRACTED"}


def test_ocrmypdf_pdf_fallback_records_quality_metadata(tmp_path: Path, monkeypatch) -> None:
    source = tmp_path / "scan.pdf"
    source.write_bytes(BLANK_PDF)

    def fake_run(command, **kwargs):
        sidecar_path = Path(command[command.index("--sidecar") + 1])
        sidecar_path.write_text(
            "Article 2 OCR PDF text. This OCR output creates a citable controlled-document chunk.",
            encoding="utf-8",
        )
        Path(command[-1]).write_bytes(b"%PDF-1.4\n%%EOF\n")
        assert command[0] == "ocrmypdf"
        assert "-l" in command
        assert kwargs["timeout"] == 300
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    with make_client(tmp_path, {"AKL_INGESTION_OCR_PROVIDER": "ocrmypdf"}) as client:
        response = client.post(
            "/api/v1/ingestion/jobs",
            json={
                "document_id": "doc_pdf_ocr",
                "document_version_id": "ver_pdf_ocr",
                "source_file_uri": str(source),
                "parser_profile": "controlled_document",
                "ocr_enabled": True,
            },
        )
        report = client.get(f"/api/v1/ingestion/jobs/{response.json()['job_id']}/report")
        payload = client.app.state.indexer.mock_points[0]["payload"]

    assert response.status_code == 201
    assert report.json()["ocr_used"] is True
    assert report.json()["quality"]["parser_name"] == "ocr_ocrmypdf"
    assert report.json()["quality"]["parser_engine"] == "ocrmypdf"
    assert report.json()["quality"]["quality_tier"] == "good"
    assert "pdf_ocr" in report.json()["quality"]["capabilities"]
    assert payload["metadata"]["parser_engine"] == "ocrmypdf"
    assert payload["metadata"]["parser_quality"]["quality_tier"] == "good"


def test_pdf_ingestion_uses_layout_parser_metadata(tmp_path: Path) -> None:
    fitz = pytest.importorskip("fitz")

    source = tmp_path / "directive.pdf"
    document = fitz.open()
    page = document.new_page()
    page.insert_text(
        (72, 72),
        "Article 7 Document owner duties\nThe owner reviews the directive every year.",
    )
    document.save(source)
    document.close()

    with make_client(tmp_path, {"AKL_INGESTION_PDF_ENGINE": "pymupdf"}) as client:
        response = client.post(
            "/api/v1/ingestion/jobs",
            json={
                "document_id": "doc_pdf",
                "document_version_id": "ver_pdf",
                "source_file_uri": str(source),
                "extraction_profile": "layout_text_v1",
            },
        )
        body = response.json()
        report = client.get(f"/api/v1/ingestion/jobs/{body['job_id']}/report")
        payload = client.app.state.indexer.mock_points[0]["payload"]

    assert response.status_code == 201
    assert body["status"] == "completed"
    assert body["extraction_profile"] == "layout_text_v1"
    assert report.json()["quality"]["parser_engine"] == "pymupdf"
    assert report.json()["quality"]["pages_with_text"] == 1
    assert report.json()["quality"]["quality_score"] > 0.75
    assert payload["metadata"]["parser_engine"] == "pymupdf"
    assert payload["metadata"]["extraction_profile"] == "layout_text_v1"


def test_authz_denial_is_stored_in_report(tmp_path: Path) -> None:
    source = tmp_path / "policy.txt"
    source.write_text("Document text that would otherwise be processed into a chunk.", encoding="utf-8")

    with make_client(tmp_path, {"AKL_INGESTION_REGISTRY_MOCK_ALLOW": "false"}) as client:
        response = client.post(
            "/api/v1/ingestion/jobs",
            json={
                "document_id": "doc_denied",
                "document_version_id": "ver_denied",
                "source_file_uri": str(source),
            },
        )
        report = client.get(f"/api/v1/ingestion/jobs/{response.json()['job_id']}/report")

    assert response.status_code == 201
    assert response.json()["status"] == "failed"
    assert report.json()["status"] == "failed"
    assert report.json()["errors"][0]["code"] == "AUTHZ_DENIED"


def test_cancel_queued_job(tmp_path: Path) -> None:
    source = tmp_path / "queued.txt"
    source.write_text("Queued content does not run when inline processing is disabled.", encoding="utf-8")

    with make_client(tmp_path, {"AKL_INGESTION_PROCESS_JOBS_INLINE": "false"}) as client:
        created = client.post(
            "/api/v1/ingestion/jobs",
            json={
                "document_id": "doc_queue",
                "document_version_id": "ver_queue",
                "source_file_uri": str(source),
            },
        )
        cancelled = client.post(f"/api/v1/ingestion/jobs/{created.json()['job_id']}/cancel")
        report = client.get(f"/api/v1/ingestion/jobs/{created.json()['job_id']}/report")

    assert created.json()["status"] == "queued"
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert report.status_code == 404
    assert report.json()["error"]["code"] == "REPORT_NOT_READY"
