from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from parsers.base import ParsedBlock, ParserResult
from parsers.docling import (
    WORKER_HTTP_REQUEST_SCHEMA,
    WORKER_READINESS_SCHEMA,
    directory_sha256,
    worker_success_payload,
)
from parsers.docling_service import (
    WorkerConfigError,
    WorkerSettings,
    create_app,
    load_worker_settings,
    prepare_socket,
)


def _settings(tmp_path: Path, *, mode: str = "prefer") -> WorkerSettings:
    artifacts = tmp_path / "models"
    artifacts.mkdir()
    (artifacts / "model.bin").write_bytes(b"immutable-model")
    return WorkerSettings(
        mode=mode,
        pipeline="standard",
        device="cpu",
        socket_path=tmp_path / "worker.sock",
        artifacts_path=artifacts if mode != "off" else None,
        artifacts_sha256=directory_sha256(artifacts) if mode != "off" else None,
        max_file_bytes=1024,
        max_pages=20,
        max_output_bytes=1024 * 1024,
        document_timeout_seconds=10,
        worker_timeout_seconds=15,
        queue_timeout_seconds=0.1,
        ocr_language="ces+eng",
        tesseract_command="tesseract",
    )


def _headers(**overrides: str) -> dict[str, str]:
    headers = {
        "content-type": "application/octet-stream",
        "x-akb-docling-schema": WORKER_HTTP_REQUEST_SCHEMA,
        "x-akb-docling-source-suffix": ".pdf",
        "x-akb-docling-pipeline": "standard",
        "x-akb-docling-requested-pipeline": "standard",
        "x-akb-docling-parser-profile": "controlled_document",
        "x-akb-docling-ocr-enabled": "false",
        "x-akb-docling-max-pages": "20",
    }
    headers.update(overrides)
    return headers


def _runner(request: dict[str, object], root: Path, response_path: Path) -> object:
    assert Path(str(request["input_path"])).read_bytes() == b"%PDF-test"
    assert root == response_path.parent
    return worker_success_payload(
        ParserResult(
            parser_name="docling_standard",
            blocks=[
                ParsedBlock(
                    text="synthetic",
                    page_number=1,
                    section_path=[],
                    section_title=None,
                    article_number=None,
                    paragraph_number=None,
                    char_start=0,
                    char_end=9,
                )
            ],
            pages_processed=1,
            metadata={
                "docling_artifacts_sha256": request["artifacts_sha256"],
                "docling_pipeline": request["pipeline"],
                "docling_requested_pipeline": request["requested_pipeline"],
            },
        )
    )


def test_worker_serves_closed_readiness_and_conversion(tmp_path: Path) -> None:
    app = create_app(_settings(tmp_path), runner=_runner)
    with TestClient(app) as client:
        readiness = client.get("/ready")
        response = client.post("/v1/convert", headers=_headers(), content=b"%PDF-test")

    assert readiness.status_code == 200
    assert set(readiness.json()) == {
        "schema",
        "status",
        "execution",
        "artifacts_sha256",
        "max_file_bytes",
        "max_pages",
        "max_concurrency",
    }
    assert readiness.json()["schema"] == WORKER_READINESS_SCHEMA
    assert readiness.json()["execution"] == "offline-uds"
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["status"] == "success"


def test_worker_rejects_unknown_private_header_and_oversize(tmp_path: Path) -> None:
    app = create_app(_settings(tmp_path), runner=_runner)
    with TestClient(app) as client:
        unknown = client.post(
            "/v1/convert",
            headers=_headers(**{"x-akb-docling-unknown": "value"}),
            content=b"%PDF-test",
        )
        oversized = client.post(
            "/v1/convert",
            headers=_headers(),
            content=b"x" * 1025,
        )

    assert unknown.status_code == 400
    assert unknown.json()["error_code"] == "DOCLING_WORKER_REQUEST_INVALID"
    assert oversized.status_code in {400, 413}
    assert oversized.json()["error_code"] == "DOCLING_FILE_TOO_LARGE"


def test_worker_disabled_never_converts(tmp_path: Path) -> None:
    invoked = False

    def forbidden(*args):  # type: ignore[no-untyped-def]
        nonlocal invoked
        invoked = True
        raise AssertionError("runner must not be called")

    app = create_app(_settings(tmp_path, mode="off"), runner=forbidden)
    with TestClient(app) as client:
        readiness = client.get("/ready")
        response = client.post("/v1/convert", headers=_headers(), content=b"%PDF-test")

    assert readiness.status_code == 503
    assert readiness.json()["status"] == "disabled"
    assert response.status_code == 503
    assert response.json()["error_code"] == "DOCLING_WORKER_DISABLED"
    assert invoked is False


def test_worker_startup_fails_on_model_digest_drift(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    (settings.artifacts_path / "model.bin").write_bytes(b"changed")  # type: ignore[operator]
    app = create_app(settings, runner=_runner)
    with pytest.raises(WorkerConfigError, match="digest mismatch"):
        with TestClient(app):
            pass


def test_worker_config_is_closed_and_requires_pinned_active_bundle(tmp_path: Path) -> None:
    base = {
        "AKL_INGESTION_DOCLING_MODE": "prefer",
        "AKL_INGESTION_DOCLING_PIPELINE": "standard",
        "AKL_INGESTION_DOCLING_DEVICE": "cpu",
        "AKL_INGESTION_DOCLING_SOCKET_PATH": str(tmp_path / "worker.sock"),
    }
    with pytest.raises(WorkerConfigError, match="local model bundle"):
        load_worker_settings(base)


def test_socket_preflight_refuses_non_socket_path(tmp_path: Path) -> None:
    target = tmp_path / "worker.sock"
    target.write_text("do not replace", encoding="utf-8")
    with pytest.raises(WorkerConfigError, match="non-socket"):
        prepare_socket(target)


def test_worker_responses_do_not_include_backend_details(tmp_path: Path) -> None:
    def failing(*args):  # type: ignore[no-untyped-def]
        raise RuntimeError("private backend detail")

    app = create_app(_settings(tmp_path), runner=failing)
    with TestClient(app) as client:
        response = client.post("/v1/convert", headers=_headers(), content=b"%PDF-test")
    serialized = json.dumps(response.json())
    assert response.status_code == 503
    assert "private backend detail" not in serialized
    assert set(response.json()) == {"schema", "status", "error_code"}
