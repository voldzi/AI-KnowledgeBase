"""Real PDF page extraction with only the external OCR process substituted."""

import hashlib
import subprocess
import asyncio
from dataclasses import replace
from io import BytesIO
from pathlib import Path

import fitz
import pytest
from pypdf import PdfReader

from app.config import load_settings
from app.object_storage import SourceObject
from app.pipeline import _quality_report
from app.registry_client import RegistryClient
from chunkers.logical import LogicalStructureChunker
from parsers.base import ParsedBlock, ParserResult
from parsers.router import ParserRouter
from tests.conftest import actor_proof_headers, make_client, web_transport_headers


NATIVE_TEXT = "Original native text stays readable and is never duplicated by the OCR merge. " * 8
OCR_TEXT = "Recognized scanned page contains the missing source evidence and citable information. " * 8


def pdf_source(tmp_path, *, scanned_pages=(2, 4)):
    document = fitz.open()
    for number in range(1, 6):
        page = document.new_page()
        if number in scanned_pages:
            image_document = fitz.open()
            image_page = image_document.new_page()
            image_page.insert_textbox(fitz.Rect(50, 50, 545, 790), f"SCAN PAGE {number}\n{OCR_TEXT}", fontsize=11)
            image = image_page.get_pixmap().tobytes("png")
            page.insert_image(page.rect, stream=image)
            image_document.close()
        else:
            page.insert_textbox(fitz.Rect(50, 50, 545, 790), f"NATIVE PAGE {number}\n{NATIVE_TEXT}", fontsize=11)
    content = document.tobytes()
    document.close()
    path = tmp_path / "mixed.pdf"
    path.write_bytes(content)
    return SourceObject(
        uri=str(path), filename=path.name, mime_type="application/pdf", content=content,
        sha256="sha256:" + hashlib.sha256(content).hexdigest(), local_path=path,
    )


def router(*, provider="ocrmypdf", engine="pymupdf"):
    return ParserRouter(load_settings({
        "AKL_ENV": "test", "AKL_AUTH_MODE": "disabled",
        "AKL_INGESTION_OCR_PROVIDER": provider, "AKL_INGESTION_PDF_ENGINE": engine,
        "AKL_INGESTION_DOCLING_MODE": "off",
        "AKL_INGESTION_REGISTRY_CLIENT_MODE": "mock",
    }))


def install_ocr(monkeypatch, *, text=None, failure=None):
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        subset = PdfReader(BytesIO(Path(command[-2]).read_bytes()))
        assert len(subset.pages) == 2
        assert all(not page.extract_text().strip() for page in subset.pages)
        assert all(len(page.images) == 1 for page in subset.pages)
        assert "--force-ocr" in command
        assert kwargs["timeout"] > 0
        if failure == "unavailable":
            raise FileNotFoundError("OCR binary unavailable")
        if failure == "timeout":
            raise subprocess.TimeoutExpired(command, kwargs["timeout"])
        if failure == "failed":
            raise subprocess.CalledProcessError(1, command)
        if failure != "missing_sidecar":
            Path(command[command.index("--sidecar") + 1]).write_text(
                text if text is not None else f"SCAN PAGE 2\n{OCR_TEXT}\fSCAN PAGE 4\n{OCR_TEXT}",
                encoding="utf-8",
            )
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(subprocess, "run", run)
    return calls


@pytest.mark.parametrize("engine", ["pymupdf", "pypdf"])
def test_mixed_pdf_ocr_processes_only_missing_pages_and_preserves_exact_citations(tmp_path, monkeypatch, engine):
    calls = install_ocr(monkeypatch)
    result = router(engine=engine).parse(pdf_source(tmp_path), parser_profile="default", ocr_enabled=True)
    assert len(calls) == 1
    assert result.pages_processed == 5
    assert result.metadata["ocr_pages_requested"] == [2, 4]
    assert result.metadata["ocr_pages_completed"] == [2, 4]
    assert result.metadata["empty_pages"] == []
    assert result.ocr_used is True
    for number in range(1, 6):
        text = "\n".join(block.text for block in result.blocks if block.page_number == number)
        label = f"{'SCAN' if number in (2, 4) else 'NATIVE'} PAGE {number}"
        assert text.count(label) == 1
        assert all(f"PAGE {other}" not in text for other in range(1, 6) if other != number)
    assert all(a.char_end < b.char_start for a, b in zip(result.blocks, result.blocks[1:]))
    quality = _quality_report(result, extraction_profile="default")
    assert quality.pages_with_text == quality.pages_processed == 5
    assert quality.quality_tier == "good"
    assert quality.requires_review is False


@pytest.mark.parametrize("failure", ["unavailable", "timeout", "failed", "missing_sidecar", "mapping_mismatch"])
def test_missing_or_failed_ocr_cannot_claim_complete_quality(tmp_path, monkeypatch, failure):
    install_ocr(monkeypatch, failure=failure, text="Unmapped combined OCR transcript" if failure == "mapping_mismatch" else None)
    result = router().parse(pdf_source(tmp_path), parser_profile="default", ocr_enabled=True)
    assert result.metadata["empty_pages"] == [2, 4]
    assert result.metadata["ocr_pages_completed"] == []
    assert {block.page_number for block in result.blocks} == {1, 3, 5}
    quality = _quality_report(result, extraction_profile="default")
    assert quality.pages_processed == 5
    assert quality.pages_with_text == 3
    assert quality.quality_tier == "review"
    assert quality.requires_review is True
    assert "PDF_PAGES_REQUIRE_REVIEW" in {code for code, _ in result.warnings}


@pytest.mark.parametrize("provider,enabled", [("disabled", True), ("ocrmypdf", False)])
def test_disabled_ocr_preserves_native_pages_and_reports_pending_pages(tmp_path, monkeypatch, provider, enabled):
    calls = install_ocr(monkeypatch)
    result = router(provider=provider).parse(pdf_source(tmp_path), parser_profile="default", ocr_enabled=enabled)
    assert calls == []
    assert result.metadata["empty_pages"] == [2, 4]
    assert _quality_report(result, extraction_profile="default").requires_review is True


def test_partial_ocr_keeps_original_page_number_and_requires_review_for_remaining_page(tmp_path, monkeypatch):
    install_ocr(monkeypatch, text=f"SCAN PAGE 2\n{OCR_TEXT}\f")
    result = router().parse(pdf_source(tmp_path), parser_profile="default", ocr_enabled=True)
    assert result.metadata["ocr_pages_completed"] == [2]
    assert result.metadata["empty_pages"] == [4]
    quality = _quality_report(result, extraction_profile="default")
    assert quality.pages_with_text == 4
    assert quality.requires_review is True
    assert quality.quality_tier == "review"


@pytest.mark.parametrize("valid_mapping", [True, False])
def test_sidecar_requires_full_document_page_boundaries_before_hybrid_merge(tmp_path, valid_mapping):
    source = pdf_source(tmp_path)
    source.local_path.with_suffix(".pdf.ocr.txt").write_text(
        "\f".join(["Do not duplicate native one", f"SCAN PAGE 2\n{OCR_TEXT}", "Do not duplicate native three", f"SCAN PAGE 4\n{OCR_TEXT}", "Do not duplicate native five"])
        if valid_mapping else f"SCAN PAGE 2\n{OCR_TEXT}\nSCAN PAGE 4\n{OCR_TEXT}", encoding="utf-8",
    )
    result = router(provider="sidecar").parse(source, parser_profile="default", ocr_enabled=True)
    assert all("Do not duplicate" not in block.text for block in result.blocks)
    assert result.metadata["empty_pages"] == ([] if valid_mapping else [2, 4])
    assert result.metadata["requires_review"] is not valid_mapping


def test_fully_native_pdf_needs_no_ocr_process(tmp_path, monkeypatch):
    calls = install_ocr(monkeypatch)
    result = router().parse(pdf_source(tmp_path, scanned_pages=()), parser_profile="default", ocr_enabled=True)
    assert calls == []
    assert result.ocr_used is False
    assert _quality_report(result, extraction_profile="default").quality_tier == "good"


def test_mixed_pdf_indexed_chunks_cite_only_their_original_page(tmp_path, monkeypatch):
    source = pdf_source(tmp_path)
    install_ocr(monkeypatch)
    with make_client(tmp_path, {
        "AKL_INGESTION_OCR_PROVIDER": "ocrmypdf",
        # All five pages fit the size limit: only page boundaries may split them.
        "AKL_INGESTION_CHUNK_TARGET_CHARS": "10000",
        "AKL_INGESTION_MAX_CHUNK_CHARS": "12000",
    }) as client:
        response = client.post("/api/v1/ingestion/jobs", headers=web_transport_headers(
            actor_subject_id="user_dev", authorization_proof=True,
        ), json={
            "idempotency_key": "mixed-pdf-exact-page-citations", "document_id": "doc_mixed_pdf",
            "document_version_id": "ver_mixed_pdf", "source_file_uri": source.uri,
            "parser_profile": "controlled_document", "ocr_enabled": True,
            "expected_current_ingestion_job_id": None,
        })
        assert response.status_code == 201, response.text
        report = client.get(f"/api/v1/ingestion/jobs/{response.json()['job_id']}/report", headers=actor_proof_headers())
        assert report.json()["quality"]["pages_with_text"] == 5
        points = client.app.state.indexer.mock_points
        assert len(points) == 5
        for point in points:
            payload = point["payload"]
            page = payload["page_number"]
            assert f"PAGE {page}" in payload["text"]
            assert all(f"PAGE {other}" not in payload["text"] for other in range(1, 6) if other != page)
            assert payload["source_file_uri"] == source.uri
            assert payload["metadata"]["parser_quality"]["requires_review"] is False


@pytest.mark.parametrize("large", [False, True])
def test_chunk_page_boundary_preserves_same_page_grouping_and_overlap(tmp_path, large):
    settings = replace(router().settings, chunk_target_chars=100 if large else 1000,
                       max_chunk_chars=120 if large else 1200, chunk_overlap_chars=20)
    metadata = asyncio.run(RegistryClient(settings).get_document_metadata("doc_pages", "ver_pages"))
    texts = [(1, "FIRST_PAGE_TEXT " * (25 if large else 2)), (1, "SAME_PAGE_PARAGRAPH"), (2, "SECOND_PAGE_TEXT " * (25 if large else 2))]
    blocks = []
    cursor = 0
    for number, text in texts:
        blocks.append(ParsedBlock(
            text=text, page_number=number, section_path=["Shared section"], section_title="Shared section",
            article_number=None, paragraph_number=None, char_start=cursor, char_end=cursor+len(text),
        ))
        cursor += len(text)+2
    chunks = LogicalStructureChunker(settings).chunk(
        ParserResult(parser_name="fixture", blocks=blocks, pages_processed=2),
        document_metadata=metadata, extraction_profile="default", parser_profile="default",
        chunking_strategy="logical", source=pdf_source(tmp_path, scanned_pages=()),
    ).chunks
    for chunk in chunks:
        assert chunk.section_path == ["Shared section"]
        if chunk.page_number == 1:
            assert "SECOND_PAGE" not in chunk.text
        else:
            assert chunk.page_number == 2
            assert "FIRST_PAGE" not in chunk.text
            assert "SAME_PAGE" not in chunk.text
    if not large:
        assert len(chunks) == 2
        assert "FIRST_PAGE_TEXT" in chunks[0].text
        assert "SAME_PAGE_PARAGRAPH" in chunks[0].text
    else:
        first_page = [chunk for chunk in chunks if chunk.page_number == 1]
        assert len(first_page) > 2
        assert first_page[1].char_start < first_page[0].char_end
