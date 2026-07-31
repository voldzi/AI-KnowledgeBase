from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.errors import IngestionError
from app.main import create_app
from app.object_storage import ObjectStorageClient
from renditions.pdf import PDF_MAGIC, PdfRenditionService


def _web_transport_headers() -> dict[str, str]:
    return {
        "X-AKL-Subject": "service-account-svc-akb-web-ingestion",
        "X-AKL-Service-Client-ID": "svc-akb-web-ingestion",
        "X-AKL-Roles": "service_akb_web_ingestion",
    }


def _settings(tmp_path: Path):
    return load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "disabled",
            "AKL_INGESTION_REGISTRY_CLIENT_MODE": "mock",
            "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
            "AKL_OBJECT_STORAGE_ROOT": str(tmp_path),
            "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "mock",
            "AKL_INGESTION_INDEXER_MODE": "mock",
            "AKL_INGESTION_JOB_STORE_PATH": str(tmp_path / "jobs"),
            "AKL_INGESTION_RENDITION_ENABLED": "true",
            "AKL_INGESTION_RENDITION_COMMAND": "fake-libreoffice",
            "AKL_INGESTION_RENDITION_CACHE_ROOT": str(tmp_path / "renditions"),
            "AKL_INGESTION_RENDITION_ENGINE_REVISION": "test-engine-v1",
        }
    )


@pytest.mark.asyncio
async def test_pdf_rendition_is_cached_by_source_hash(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bucket = tmp_path / "akl-documents"
    bucket.mkdir()
    source = bucket / "directive.docx"
    source.write_bytes(b"immutable-docx-fixture")
    settings = _settings(tmp_path)
    storage = ObjectStorageClient(settings)
    source_object = await storage.read("s3://akl-documents/directive.docx")
    conversions = 0

    monkeypatch.setattr(
        "renditions.pdf.shutil.which",
        lambda command: f"/usr/bin/{command}",
    )

    def fake_run(args, **_kwargs):
        nonlocal conversions
        conversions += 1
        output_dir = Path(args[args.index("--outdir") + 1])
        (output_dir / "source.pdf").write_bytes(
            PDF_MAGIC + b"\nfaithful-render-fixture"
        )
        return subprocess.CompletedProcess(args, 0, b"", b"")

    monkeypatch.setattr("renditions.pdf.subprocess.run", fake_run)
    service = PdfRenditionService(settings, storage)

    first = await service.render(
        source_file_uri=source_object.uri,
        expected_source_sha256=source_object.sha256,
    )
    second = await service.render(
        source_file_uri=source_object.uri,
        expected_source_sha256=source_object.sha256,
    )

    assert first.cache_status == "miss"
    assert second.cache_status == "hit"
    assert first.content == second.content
    assert first.source_sha256 == source_object.sha256
    assert conversions == 1


@pytest.mark.asyncio
async def test_pdf_rendition_rejects_unsupported_source(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bucket = tmp_path / "akl-documents"
    bucket.mkdir()
    source = bucket / "payload.exe"
    source.write_bytes(b"not-an-office-document")
    settings = _settings(tmp_path)
    storage = ObjectStorageClient(settings)
    source_object = await storage.read("s3://akl-documents/payload.exe")
    monkeypatch.setattr(
        "renditions.pdf.shutil.which",
        lambda command: f"/usr/bin/{command}",
    )

    with pytest.raises(IngestionError) as captured:
        await PdfRenditionService(settings, storage).render(
            source_file_uri=source_object.uri,
            expected_source_sha256=source_object.sha256,
        )

    assert captured.value.code == "DOCUMENT_RENDITION_FORMAT_UNSUPPORTED"


def test_pdf_rendition_endpoint_uses_exact_web_transport(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bucket = tmp_path / "akl-documents"
    bucket.mkdir()
    source = bucket / "directive.docx"
    source.write_bytes(b"immutable-docx-endpoint-fixture")
    settings = _settings(tmp_path)
    source_digest = "sha256:" + hashlib.sha256(source.read_bytes()).hexdigest()

    monkeypatch.setattr(
        "renditions.pdf.shutil.which",
        lambda command: f"/usr/bin/{command}",
    )

    def fake_run(args, **_kwargs):
        output_dir = Path(args[args.index("--outdir") + 1])
        (output_dir / "source.pdf").write_bytes(PDF_MAGIC + b"\nendpoint-fixture")
        return subprocess.CompletedProcess(args, 0, b"", b"")

    monkeypatch.setattr("renditions.pdf.subprocess.run", fake_run)
    payload = {
        "document_id": "doc_test",
        "document_version_id": "ver_test",
        "source_file_uri": "s3://akl-documents/directive.docx",
        "source_sha256": source_digest,
    }

    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/api/v1/renditions/pdf",
            headers=_web_transport_headers(),
            json=payload,
        )
        delegated = client.post(
            "/api/v1/renditions/pdf",
            headers={
                **_web_transport_headers(),
                "X-AKL-On-Behalf-Of": "user:someone",
            },
            json=payload,
        )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    assert response.headers["x-akl-rendition-cache"] == "miss"
    assert response.content.startswith(PDF_MAGIC)
    assert delegated.status_code == 403
    assert delegated.json()["error"]["code"] == "DOCUMENT_RENDITION_DELEGATION_FORBIDDEN"
