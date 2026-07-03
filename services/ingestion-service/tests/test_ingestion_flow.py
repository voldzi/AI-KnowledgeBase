from __future__ import annotations

from pathlib import Path

from tests.conftest import make_client


def test_text_ingestion_creates_report(tmp_path: Path) -> None:
    source = tmp_path / "policy.md"
    source.write_text(
        "\n\n".join(
            [
                "# Test directive",
                "Article 4 Exception approvals",
                "Paragraph 2 The document owner approves an exception after justification is provided.",
                "Another paragraph contains additional rules for a citable chunk.",
            ]
        ),
        encoding="utf-8",
    )

    with make_client(tmp_path) as client:
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
    assert {warning["code"] for warning in report.json()["warnings"]} == {"NO_TEXT_EXTRACTED"}


def test_pdf_ingestion_uses_layout_parser_metadata(tmp_path: Path) -> None:
    import fitz

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
