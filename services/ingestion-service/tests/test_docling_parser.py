from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import stat
import subprocess
from types import SimpleNamespace

import pytest

from app.config import ConfigError, load_settings
from app.object_storage import SourceObject
from parsers.base import ParserError
from parsers.docling import DoclingParser, directory_sha256
from parsers.router import ParserRouter


def _settings(
    tmp_path: Path,
    *,
    mode: str = "prefer",
    pipeline: str = "standard",
    **overrides: str,
):
    artifacts = tmp_path / "models"
    artifacts.mkdir(exist_ok=True)
    (artifacts / "model.bin").write_bytes(b"test-model")
    return load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "disabled",
            "AKL_INGESTION_REGISTRY_CLIENT_MODE": "mock",
            "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
            "AKL_OBJECT_STORAGE_ROOT": str(tmp_path),
            "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "mock",
            "AKL_INGESTION_INDEXER_MODE": "mock",
            "AKL_INGESTION_DOCLING_MODE": mode,
            "AKL_INGESTION_DOCLING_PIPELINE": pipeline,
            "AKL_INGESTION_DOCLING_ARTIFACTS_PATH": str(artifacts),
            "AKL_INGESTION_DOCLING_ARTIFACTS_SHA256": directory_sha256(artifacts),
            **overrides,
        }
    )


def _source(filename: str, mime_type: str, content: bytes = b"source") -> SourceObject:
    return SourceObject(
        uri=f"s3://test/{filename}",
        filename=filename,
        mime_type=mime_type,
        content=content,
        sha256=f"sha256:{hashlib.sha256(content).hexdigest()}",
    )


def _isolated_settings(tmp_path: Path, **overrides: str):
    artifacts = tmp_path / "isolated-models"
    artifacts.mkdir()
    (artifacts / "model.bin").write_bytes(b"immutable-model")
    values = {
        "AKL_ENV": "test",
        "AKL_AUTH_MODE": "disabled",
        "AKL_INGESTION_REGISTRY_CLIENT_MODE": "mock",
        "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
        "AKL_OBJECT_STORAGE_ROOT": str(tmp_path),
        "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "mock",
        "AKL_INGESTION_INDEXER_MODE": "mock",
        "AKL_INGESTION_DOCLING_MODE": "enforce",
        "AKL_INGESTION_DOCLING_ARTIFACTS_PATH": str(artifacts),
        "AKL_INGESTION_DOCLING_ARTIFACTS_SHA256": directory_sha256(artifacts),
        **overrides,
    }
    return load_settings(values)


@dataclass
class _FakeProvenance:
    page_no: int
    bbox: object | None = None
    charspan: tuple[int, int] | None = None


class _FakeBoundingBox:
    def model_dump(self, *, mode: str) -> dict[str, int]:
        assert mode == "json"
        return {"l": 1, "t": 2, "r": 3, "b": 4}


class _FakeItem:
    def __init__(self, label: str, text: str | None, *, page: int | None = None) -> None:
        self.label = SimpleNamespace(value=label)
        self.text = text
        self.self_ref = f"#/items/{label}"
        self.prov = [
            _FakeProvenance(page, bbox=_FakeBoundingBox(), charspan=(0, len(text or "")))
        ] if page else []


class _FakeTable(_FakeItem):
    def __init__(self, markdown: str, *, page: int | None = None) -> None:
        super().__init__("table", None, page=page)
        self.markdown = markdown

    def export_to_markdown(self, *, doc) -> str:  # type: ignore[no-untyped-def]
        return self.markdown


class _FakeDocument:
    def __init__(self) -> None:
        self.pages = {1: object()}
        self.items = [
            (_FakeItem("title", "Infrastructure", page=1), 1),
            (_FakeItem("text", "Internal network only.", page=1), 2),
            (_FakeTable("| Component | RAM |\n|---|---|\n| AKB | 16 GB |", page=1), 2),
        ]

    def iterate_items(self):  # type: ignore[no-untyped-def]
        return iter(self.items)

    def export_to_dict(self) -> dict:
        return {"schema_name": "DoclingDocument", "version": "1.0.0", "item_count": 3}


class _FakeConverter:
    def __init__(self, *, status: str = "success", error: Exception | None = None) -> None:
        self.status = status
        self.error = error
        self.calls: list[dict] = []

    def convert(self, path: Path, **kwargs):  # type: ignore[no-untyped-def]
        self.calls.append({"path": path, **kwargs})
        if self.error is not None:
            raise self.error
        return SimpleNamespace(
            status=SimpleNamespace(value=self.status),
            document=_FakeDocument(),
            pages=[],
        )


class _Factory:
    def __init__(self, converter: _FakeConverter) -> None:
        self.converter = converter
        self.requests: list[tuple[str, bool]] = []

    def __call__(self, *, pipeline: str, ocr_enabled: bool):
        self.requests.append((pipeline, ocr_enabled))
        return self.converter


def test_docling_preserves_structure_tables_and_page_provenance(tmp_path: Path) -> None:
    converter = _FakeConverter()
    factory = _Factory(converter)
    parser = DoclingParser(_settings(tmp_path), converter_factory=factory)

    result = parser.parse(
        _source("requirements.pdf", "application/pdf"),
        parser_profile="controlled_document",
        ocr_enabled=True,
    )

    assert result.parser_name == "docling_standard"
    assert factory.requests == [("standard", True)]
    assert result.pages_processed == 1
    assert result.tables_detected == 1
    assert result.metadata["parser_engine"] == "docling"
    assert result.metadata["docling_structural_sha256"].startswith("sha256:")
    assert result.metadata["capabilities"] == [
        "document_structure",
        "section_citations",
        "structured_tables",
        "page_citations",
        "bounding_boxes",
    ]
    assert result.blocks[1].section_path == ["Infrastructure"]
    table = result.blocks[2]
    assert table.block_type == "table"
    assert table.page_number == 1
    assert table.metadata["table_header_line_count"] == 2
    assert converter.calls[0]["raises_on_error"] is False
    assert converter.calls[0]["max_file_size"] == parser.settings.max_file_bytes


def test_granite_is_used_for_pdf_and_standard_docling_for_office(tmp_path: Path) -> None:
    converter = _FakeConverter()
    factory = _Factory(converter)
    parser = DoclingParser(
        _settings(tmp_path, pipeline="granite"),
        converter_factory=factory,
    )

    pdf = parser.parse(
        _source("manual.pdf", "application/pdf"),
        parser_profile="default",
    )
    docx = parser.parse(
        _source(
            "manual.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
        parser_profile="default",
    )

    assert factory.requests == [("granite", False), ("standard", False)]
    assert pdf.parser_name == "granite_docling"
    assert pdf.metadata["docling_model_id"] == "ibm-granite/granite-docling-258M"
    assert "granite_docling_vlm" in pdf.metadata["capabilities"]
    assert docx.parser_name == "docling_standard"
    assert docx.metadata["docling_requested_pipeline"] == "granite"


def test_shadow_keeps_native_parser_authoritative(tmp_path: Path) -> None:
    settings = _settings(tmp_path, mode="shadow")
    router = ParserRouter(settings)
    router.docling_parser = DoclingParser(
        settings,
        converter_factory=_Factory(_FakeConverter()),
    )

    result = router.parse(
        _source("manual.html", "text/html", b"<h1>Manual</h1><p>Use the portal.</p>"),
        parser_profile="default",
        ocr_enabled=False,
    )

    assert result.parser_name == "html"
    assert result.metadata["docling_shadow"]["status"] == "success"
    assert not any(code == "DOCLING_SHADOW_FAILED" for code, _ in result.warnings)


def test_shadow_failure_does_not_change_authoritative_job_semantics(tmp_path: Path) -> None:
    settings = _settings(tmp_path, mode="shadow")
    router = ParserRouter(settings)
    router.docling_parser = DoclingParser(
        settings,
        converter_factory=_Factory(_FakeConverter(error=RuntimeError("private detail"))),
    )

    result = router.parse(
        _source("manual.html", "text/html", b"<p>Authoritative native content.</p>"),
        parser_profile="default",
        ocr_enabled=False,
    )

    assert result.parser_name == "html"
    assert result.warnings == []
    assert result.metadata["docling_shadow"] == {
        "status": "failed",
        "error_code": "DOCLING_CONVERSION_FAILED",
    }


def test_prefer_falls_back_but_enforce_fails_closed(tmp_path: Path) -> None:
    failing = _Factory(_FakeConverter(error=RuntimeError("sensitive backend detail")))
    source = _source("manual.html", "text/html", b"<p>Governed fallback content.</p>")

    prefer_settings = _settings(tmp_path, mode="prefer")
    prefer_router = ParserRouter(prefer_settings)
    prefer_router.docling_parser = DoclingParser(
        prefer_settings,
        converter_factory=failing,
    )
    fallback = prefer_router.parse(source, parser_profile="default", ocr_enabled=False)
    assert fallback.parser_name == "html"
    assert fallback.metadata["docling_preferred"]["error_code"] == "DOCLING_CONVERSION_FAILED"
    assert any(code == "DOCLING_PREFERRED_FALLBACK" for code, _ in fallback.warnings)
    assert "sensitive" not in " ".join(message for _, message in fallback.warnings)

    enforce_settings = _settings(tmp_path, mode="enforce")
    enforce_router = ParserRouter(enforce_settings)
    enforce_router.docling_parser = DoclingParser(
        enforce_settings,
        converter_factory=failing,
    )
    with pytest.raises(ParserError, match="Docling conversion failed safely"):
        enforce_router.parse(source, parser_profile="default", ocr_enabled=False)


def test_artifact_digest_is_deterministic_and_enforced(tmp_path: Path) -> None:
    artifacts = tmp_path / "models"
    artifacts.mkdir()
    (artifacts / "model.bin").write_bytes(b"immutable-model")
    digest = directory_sha256(artifacts)
    assert digest == directory_sha256(artifacts)

    settings = load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "disabled",
            "AKL_INGESTION_REGISTRY_CLIENT_MODE": "mock",
            "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
            "AKL_OBJECT_STORAGE_ROOT": str(tmp_path),
            "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "mock",
            "AKL_INGESTION_INDEXER_MODE": "mock",
            "AKL_INGESTION_DOCLING_MODE": "enforce",
            "AKL_INGESTION_DOCLING_ARTIFACTS_PATH": str(artifacts),
            "AKL_INGESTION_DOCLING_ARTIFACTS_SHA256": digest,
        }
    )
    assert DoclingParser(settings, converter_factory=_Factory(_FakeConverter())).readiness() == "ready"

    (artifacts / "model.bin").write_bytes(b"changed-model")
    assert DoclingParser(settings, converter_factory=_Factory(_FakeConverter())).readiness() == "not_ready"


def test_artifact_digest_rejects_symlink_outside_bundle(tmp_path: Path) -> None:
    artifacts = tmp_path / "models"
    artifacts.mkdir()
    outside = tmp_path / "outside.bin"
    outside.write_bytes(b"outside")
    (artifacts / "model.bin").write_bytes(b"model")
    (artifacts / "escape.bin").symlink_to(outside)

    with pytest.raises(ParserError, match="escaping symlink"):
        directory_sha256(artifacts)


def test_docling_configuration_is_closed_and_production_is_offline(tmp_path: Path) -> None:
    base = {
        "AKL_ENV": "test",
        "AKL_AUTH_MODE": "disabled",
        "AKL_INGESTION_REGISTRY_CLIENT_MODE": "mock",
        "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
        "AKL_OBJECT_STORAGE_ROOT": str(tmp_path),
        "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "mock",
        "AKL_INGESTION_INDEXER_MODE": "mock",
    }
    with pytest.raises(ConfigError, match="DOCLING_MODE"):
        load_settings({**base, "AKL_INGESTION_DOCLING_MODE": "automatic"})
    with pytest.raises(ConfigError, match="DOCLING_PIPELINE"):
        load_settings({**base, "AKL_INGESTION_DOCLING_PIPELINE": "unknown"})
    with pytest.raises(ConfigError, match="DOCLING_DEVICE"):
        load_settings({**base, "AKL_INGESTION_DOCLING_DEVICE": "metal"})
    with pytest.raises(ConfigError, match="local artifacts path"):
        load_settings({**base, "AKL_INGESTION_DOCLING_MODE": "prefer"})
    with pytest.raises(ConfigError, match="sha256"):
        load_settings(
            {
                **base,
                "AKL_INGESTION_DOCLING_ARTIFACTS_SHA256": "latest",
            }
        )
    with pytest.raises(ConfigError, match="WORKER_TIMEOUT"):
        load_settings(
            {
                **base,
                "AKL_INGESTION_DOCLING_DOCUMENT_TIMEOUT_SECONDS": "30",
                "AKL_INGESTION_DOCLING_WORKER_TIMEOUT_SECONDS": "29",
            }
        )
    with pytest.raises(ConfigError, match="MAX_CONCURRENCY"):
        load_settings(
            {
                **base,
                "AKL_INGESTION_DOCLING_MAX_CONCURRENCY": "9",
            }
        )


def test_isolated_worker_timeout_is_killed_without_inheriting_service_secrets(
    tmp_path: Path,
    monkeypatch,
) -> None:
    settings = _isolated_settings(tmp_path)
    parser = DoclingParser(settings)
    monkeypatch.setattr("parsers.docling.importlib.util.find_spec", lambda _: object())
    monkeypatch.setenv("AKL_REGISTRY_SERVICE_CLIENT_SECRET", "must-not-cross-boundary")

    def timeout(command, **kwargs):  # type: ignore[no-untyped-def]
        request_path = Path(command[command.index("--request") + 1])
        request = json.loads(request_path.read_text(encoding="utf-8"))
        input_path = Path(request["input_path"])
        assert stat.S_IMODE(request_path.stat().st_mode) == 0o600
        assert stat.S_IMODE(input_path.stat().st_mode) == 0o600
        assert kwargs["start_new_session"] is True
        assert kwargs["close_fds"] is True
        assert kwargs["env"]["HF_HUB_OFFLINE"] == "1"
        assert "AKL_REGISTRY_SERVICE_CLIENT_SECRET" not in kwargs["env"]
        assert request["ocr_languages"] == ["ces", "eng"]
        assert request["tesseract_command"] == "tesseract"
        raise subprocess.TimeoutExpired(command, kwargs["timeout"])

    monkeypatch.setattr("parsers.docling.subprocess.run", timeout)
    with pytest.raises(ParserError) as error:
        parser.parse(_source("manual.pdf", "application/pdf"), parser_profile="default")
    assert error.value.code == "DOCLING_WORKER_TIMEOUT"


def test_isolated_worker_rejects_unsafe_ocr_configuration(
    tmp_path: Path,
    monkeypatch,
) -> None:
    parser = DoclingParser(
        _isolated_settings(
            tmp_path,
            AKL_INGESTION_OCR_LANGUAGE="ces;curl",
        )
    )
    monkeypatch.setattr("parsers.docling.importlib.util.find_spec", lambda _: object())

    with pytest.raises(ParserError) as error:
        parser.parse(
            _source("manual.pdf", "application/pdf"),
            parser_profile="default",
            ocr_enabled=True,
        )

    assert error.value.code == "DOCLING_OCR_CONFIGURATION_INVALID"


def test_isolated_worker_rejects_non_closed_response(tmp_path: Path, monkeypatch) -> None:
    settings = _isolated_settings(tmp_path)
    parser = DoclingParser(settings)
    monkeypatch.setattr("parsers.docling.importlib.util.find_spec", lambda _: object())

    def invalid_response(command, **kwargs):  # type: ignore[no-untyped-def]
        response_path = Path(command[command.index("--response") + 1])
        response_path.write_text(
            json.dumps(
                {
                    "schema": "akb-docling-worker-response-1",
                    "status": "error",
                    "error_code": "DOCLING_CONVERSION_FAILED",
                    "unexpected": True,
                }
            ),
            encoding="utf-8",
        )
        response_path.chmod(0o600)
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr("parsers.docling.subprocess.run", invalid_response)
    with pytest.raises(ParserError) as error:
        parser.parse(_source("manual.pdf", "application/pdf"), parser_profile="default")
    assert error.value.code == "DOCLING_WORKER_RESPONSE_INVALID"


def test_docling_capacity_is_bounded(tmp_path: Path) -> None:
    settings = _settings(
        tmp_path,
        AKL_INGESTION_DOCLING_QUEUE_TIMEOUT_SECONDS="0",
    )
    parser = DoclingParser(settings, converter_factory=_Factory(_FakeConverter()))
    assert parser._capacity.acquire(blocking=False) is True
    try:
        with pytest.raises(ParserError) as error:
            parser.parse(_source("manual.pdf", "application/pdf"), parser_profile="default")
        assert error.value.code == "DOCLING_CAPACITY_EXHAUSTED"
    finally:
        parser._capacity.release()


def test_docling_docker_build_uses_only_hash_locked_dependencies() -> None:
    dockerfile = (Path(__file__).resolve().parents[1] / "Dockerfile").read_text(
        encoding="utf-8"
    )
    lockfile = (
        Path(__file__).resolve().parents[1] / "requirements-docling.c4.lock"
    ).read_text(encoding="utf-8")
    macos_lockfile = (
        Path(__file__).resolve().parents[1] / "requirements-docling-macos.c4.lock"
    ).read_text(encoding="utf-8")
    setup_script = (
        Path(__file__).resolve().parents[3] / "scripts/setup_docling_local.sh"
    ).read_text(encoding="utf-8")

    assert "COPY requirements.c4.lock requirements-docling.c4.lock" in dockerfile
    assert "--require-hashes -r requirements-docling.c4.lock" in dockerfile
    assert "--only-binary=:all:" in dockerfile
    assert "--extra-index-url https://download.pytorch.org/whl/cpu" in dockerfile
    assert "pip install --no-cache-dir -r" not in dockerfile
    assert "docling-slim==2.124.0" in lockfile
    assert "rapidocr==" not in lockfile
    assert "omegaconf==" not in lockfile
    assert "torch==2.14.0+cpu" in lockfile
    assert "--hash=sha256:" in lockfile
    assert "docling-slim==2.124.0" in macos_lockfile
    assert "mlx==0.32.2" in macos_lockfile
    assert "docling-parse==" not in macos_lockfile
    assert "requirements-docling-macos.c4.lock" in setup_script
    assert "--only-binary=:all:" in setup_script
    assert 'MIN_FREE_GIB="${AKL_DOCLING_MIN_FREE_GIB:-20}"' in setup_script
    assert "AVAILABLE_KIB" in setup_script
