from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import threading
from typing import Callable, Mapping

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from parsers.base import ParserError
from parsers.docling import (
    DOCLING_SUFFIXES,
    PARSER_PROFILE_PATTERN,
    WORKER_HTTP_REQUEST_SCHEMA,
    WORKER_READINESS_SCHEMA,
    WORKER_REQUEST_SCHEMA,
    _read_private_worker_response,
    _tesseract_languages,
    _validate_tesseract_command,
    _worker_environment,
    _write_private_json,
    directory_sha256,
    worker_error_payload,
)


SHA256_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
ALLOWED_MODES = {"off", "shadow", "prefer", "enforce"}
ALLOWED_PIPELINES = {"standard", "granite"}
ALLOWED_DEVICES = {"auto", "cpu", "cuda", "mps", "mlx"}
REQUEST_HEADER_KEYS = {
    "x-akb-docling-schema",
    "x-akb-docling-source-suffix",
    "x-akb-docling-pipeline",
    "x-akb-docling-requested-pipeline",
    "x-akb-docling-parser-profile",
    "x-akb-docling-ocr-enabled",
    "x-akb-docling-max-pages",
}


class WorkerConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class WorkerSettings:
    mode: str
    pipeline: str
    device: str
    socket_path: Path
    artifacts_path: Path | None
    artifacts_sha256: str | None
    max_file_bytes: int
    max_pages: int
    max_output_bytes: int
    document_timeout_seconds: float
    worker_timeout_seconds: float
    queue_timeout_seconds: float
    ocr_language: str
    tesseract_command: str


Runner = Callable[[dict[str, object], Path, Path], object]


def load_worker_settings(env: Mapping[str, str] | None = None) -> WorkerSettings:
    source = os.environ if env is None else env
    mode = source.get("AKL_INGESTION_DOCLING_MODE", "off").strip().lower()
    pipeline = source.get("AKL_INGESTION_DOCLING_PIPELINE", "standard").strip().lower()
    device = source.get("AKL_INGESTION_DOCLING_DEVICE", "cpu").strip().lower()
    socket_path = Path(
        source.get(
            "AKL_INGESTION_DOCLING_SOCKET_PATH",
            "/run/akb-docling/worker.sock",
        ).strip()
    )
    artifacts_raw = source.get("AKL_INGESTION_DOCLING_ARTIFACTS_PATH", "").strip()
    artifacts_path = Path(artifacts_raw) if artifacts_raw else None
    artifacts_sha256 = (
        source.get("AKL_INGESTION_DOCLING_ARTIFACTS_SHA256", "").strip().lower()
        or None
    )
    if mode not in ALLOWED_MODES:
        raise WorkerConfigError("Unsupported Docling mode")
    if pipeline not in ALLOWED_PIPELINES:
        raise WorkerConfigError("Unsupported Docling pipeline")
    if device not in ALLOWED_DEVICES:
        raise WorkerConfigError("Unsupported Docling device")
    if not socket_path.is_absolute() or socket_path.suffix != ".sock":
        raise WorkerConfigError("The Docling socket path must be an absolute .sock path")
    try:
        max_file_bytes = int(source.get("AKL_INGESTION_MAX_FILE_BYTES", str(100 * 1024 * 1024)))
        max_pages = int(source.get("AKL_INGESTION_DOCLING_MAX_PAGES", "1000"))
        max_output_bytes = int(
            source.get("AKL_INGESTION_DOCLING_MAX_OUTPUT_BYTES", str(128 * 1024 * 1024))
        )
        document_timeout_seconds = float(
            source.get("AKL_INGESTION_DOCLING_DOCUMENT_TIMEOUT_SECONDS", "300")
        )
        worker_timeout_seconds = float(
            source.get("AKL_INGESTION_DOCLING_WORKER_TIMEOUT_SECONDS", "330")
        )
        queue_timeout_seconds = float(
            source.get("AKL_INGESTION_DOCLING_QUEUE_TIMEOUT_SECONDS", "5")
        )
    except ValueError as exc:
        raise WorkerConfigError("Docling worker limits must be numeric") from exc
    if not 0 < max_file_bytes <= 1024 * 1024 * 1024:
        raise WorkerConfigError("Invalid Docling input limit")
    if not 0 < max_pages <= 10_000:
        raise WorkerConfigError("Invalid Docling page limit")
    if not 0 < max_output_bytes <= 512 * 1024 * 1024:
        raise WorkerConfigError("Invalid Docling output limit")
    if not 0 < document_timeout_seconds <= 3600:
        raise WorkerConfigError("Invalid Docling document timeout")
    if not document_timeout_seconds <= worker_timeout_seconds <= 3660:
        raise WorkerConfigError("Invalid Docling worker timeout")
    if not 0 <= queue_timeout_seconds <= 60:
        raise WorkerConfigError("Invalid Docling queue timeout")
    if mode != "off":
        if artifacts_path is None or not artifacts_path.is_dir():
            raise WorkerConfigError("Enabled Docling requires a local model bundle")
        if artifacts_sha256 is None or not SHA256_PATTERN.fullmatch(artifacts_sha256):
            raise WorkerConfigError("Enabled Docling requires a model-bundle SHA-256")
    _tesseract_languages(source.get("AKL_INGESTION_OCR_LANGUAGE", "ces+eng").strip().lower())
    _validate_tesseract_command(
        source.get("AKL_INGESTION_TESSERACT_COMMAND", "tesseract").strip()
    )
    return WorkerSettings(
        mode=mode,
        pipeline=pipeline,
        device=device,
        socket_path=socket_path,
        artifacts_path=artifacts_path,
        artifacts_sha256=artifacts_sha256,
        max_file_bytes=max_file_bytes,
        max_pages=max_pages,
        max_output_bytes=max_output_bytes,
        document_timeout_seconds=document_timeout_seconds,
        worker_timeout_seconds=worker_timeout_seconds,
        queue_timeout_seconds=queue_timeout_seconds,
        ocr_language=source.get("AKL_INGESTION_OCR_LANGUAGE", "ces+eng").strip().lower(),
        tesseract_command=source.get(
            "AKL_INGESTION_TESSERACT_COMMAND",
            "tesseract",
        ).strip(),
    )


def create_app(
    settings: WorkerSettings | None = None,
    *,
    runner: Runner | None = None,
) -> FastAPI:
    resolved = settings or load_worker_settings()
    capacity = threading.BoundedSemaphore(1)
    if runner is None:

        def execute(
            request: dict[str, object],
            root: Path,
            response_path: Path,
        ) -> object:
            return _run_child(
                request,
                root,
                response_path,
                timeout=resolved.worker_timeout_seconds,
                max_output_bytes=resolved.max_output_bytes,
            )
    else:
        execute = runner

    @asynccontextmanager
    async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
        app.state.artifact_digest = None
        if resolved.mode != "off":
            assert resolved.artifacts_path is not None
            actual_digest = directory_sha256(resolved.artifacts_path)
            if actual_digest != resolved.artifacts_sha256:
                raise WorkerConfigError("Docling model-bundle digest mismatch")
            app.state.artifact_digest = actual_digest
        yield

    app = FastAPI(
        title="AKB isolated Docling worker",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    @app.get("/health")
    async def health() -> JSONResponse:
        return _json_response(
            200,
            {
                "schema": WORKER_READINESS_SCHEMA,
                "status": "ok",
                "execution": "offline-uds",
            },
        )

    @app.get("/ready")
    async def ready(request: Request) -> JSONResponse:
        if resolved.mode == "off":
            return _json_response(
                503,
                {
                    "schema": WORKER_READINESS_SCHEMA,
                    "status": "disabled",
                    "execution": "offline-uds",
                    "artifacts_sha256": None,
                    "max_file_bytes": resolved.max_file_bytes,
                    "max_pages": resolved.max_pages,
                    "max_concurrency": 1,
                },
            )
        return _json_response(
            200,
            {
                "schema": WORKER_READINESS_SCHEMA,
                "status": "ready",
                "execution": "offline-uds",
                "artifacts_sha256": request.app.state.artifact_digest,
                "max_file_bytes": resolved.max_file_bytes,
                "max_pages": resolved.max_pages,
                "max_concurrency": 1,
            },
        )

    @app.post("/v1/convert")
    async def convert(request: Request) -> JSONResponse:
        if resolved.mode == "off":
            return _error_response(503, "DOCLING_WORKER_DISABLED")
        try:
            request_values = _validate_request_headers(request, resolved)
        except ParserError as exc:
            return _error_response(400, exc.code)
        acquired = await asyncio.to_thread(
            capacity.acquire,
            True,
            resolved.queue_timeout_seconds,
        )
        if not acquired:
            return _error_response(429, "DOCLING_CAPACITY_EXHAUSTED")
        try:
            with tempfile.TemporaryDirectory(prefix="akb-docling-service-") as temporary_dir:
                root = Path(temporary_dir)
                root.chmod(0o700)
                input_path = root / f"source{request_values['source_suffix']}"
                response_path = root / "response.json"
                try:
                    await _write_request_body(request, input_path, resolved.max_file_bytes)
                except ParserError as exc:
                    return _error_response(413, exc.code)
                worker_request = _worker_request(
                    request_values,
                    resolved,
                    input_path,
                )
                try:
                    payload = await asyncio.to_thread(
                        execute,
                        worker_request,
                        root,
                        response_path,
                    )
                except ParserError as exc:
                    return _error_response(422, exc.code)
                except Exception:
                    return _error_response(503, "DOCLING_WORKER_FAILED")
        finally:
            capacity.release()
        return _json_response(200, payload)

    return app


def _validate_request_headers(
    request: Request,
    settings: WorkerSettings,
) -> dict[str, object]:
    received_private_headers = {
        key.lower() for key in request.headers if key.lower().startswith("x-akb-docling-")
    }
    if received_private_headers != REQUEST_HEADER_KEYS:
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid request metadata")
    values = {key: request.headers.get(key) for key in REQUEST_HEADER_KEYS}
    if any(value is None for value in values.values()):
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Missing request metadata")
    if values["x-akb-docling-schema"] != WORKER_HTTP_REQUEST_SCHEMA:
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid request schema")
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/octet-stream":
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid content type")
    content_length = request.headers.get("content-length")
    if content_length is None:
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Missing content length")
    try:
        declared_length = int(content_length)
    except ValueError as exc:
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid content length") from exc
    if declared_length <= 0:
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid content length")
    if declared_length > settings.max_file_bytes:
        raise ParserError("DOCLING_FILE_TOO_LARGE", "Docling input exceeds the limit")
    source_suffix = str(values["x-akb-docling-source-suffix"]).lower()
    pipeline = str(values["x-akb-docling-pipeline"]).lower()
    requested_pipeline = str(values["x-akb-docling-requested-pipeline"]).lower()
    parser_profile = str(values["x-akb-docling-parser-profile"])
    ocr_value = values["x-akb-docling-ocr-enabled"]
    try:
        max_pages = int(str(values["x-akb-docling-max-pages"]))
    except ValueError as exc:
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid page limit") from exc
    if source_suffix not in DOCLING_SUFFIXES:
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Unsupported source suffix")
    if pipeline not in ALLOWED_PIPELINES or requested_pipeline != settings.pipeline:
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid pipeline")
    if pipeline == "granite" and settings.pipeline != "granite":
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Granite is not enabled")
    if not PARSER_PROFILE_PATTERN.fullmatch(parser_profile):
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid parser profile")
    if ocr_value not in {"true", "false"}:
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid OCR flag")
    if max_pages <= 0 or max_pages > settings.max_pages:
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid page limit")
    return {
        "source_suffix": source_suffix,
        "pipeline": pipeline,
        "requested_pipeline": requested_pipeline,
        "parser_profile": parser_profile,
        "ocr_enabled": ocr_value == "true",
        "max_pages": max_pages,
    }


async def _write_request_body(request: Request, target: Path, limit: int) -> None:
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    size = 0
    try:
        with os.fdopen(descriptor, "wb") as handle:
            async for chunk in request.stream():
                size += len(chunk)
                if size > limit:
                    raise ParserError(
                        "DOCLING_FILE_TOO_LARGE",
                        "Docling input exceeds the configured limit",
                    )
                handle.write(chunk)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    if size <= 0:
        target.unlink(missing_ok=True)
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Empty Docling input")


def _worker_request(
    values: dict[str, object],
    settings: WorkerSettings,
    input_path: Path,
) -> dict[str, object]:
    assert settings.artifacts_path is not None
    assert settings.artifacts_sha256 is not None
    return {
        "schema": WORKER_REQUEST_SCHEMA,
        "input_path": str(input_path),
        "artifacts_path": str(settings.artifacts_path.resolve()),
        "artifacts_sha256": settings.artifacts_sha256,
        "pipeline": values["pipeline"],
        "requested_pipeline": values["requested_pipeline"],
        "device": settings.device,
        "parser_profile": values["parser_profile"],
        "ocr_enabled": values["ocr_enabled"],
        "ocr_languages": _tesseract_languages(settings.ocr_language),
        "tesseract_command": _validate_tesseract_command(settings.tesseract_command),
        "max_pages": values["max_pages"],
        "max_file_bytes": settings.max_file_bytes,
        "document_timeout_seconds": settings.document_timeout_seconds,
    }


def _run_child(
    request: dict[str, object],
    root: Path,
    response_path: Path,
    *,
    timeout: float,
    max_output_bytes: int,
) -> object:
    request_path = root / "request.json"
    _write_private_json(request_path, request)
    command = [
        sys.executable,
        "-m",
        "parsers.docling_worker",
        "--request",
        str(request_path),
        "--response",
        str(response_path),
    ]
    process = subprocess.Popen(
        command,
        cwd=Path(__file__).resolve().parents[1],
        env=_worker_environment(root, str(request["device"])),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        start_new_session=True,
    )
    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        raise ParserError(
            "DOCLING_WORKER_TIMEOUT",
            "Docling exceeded the isolated worker time limit",
        ) from exc
    if process.returncode != 0 and not response_path.is_file():
        raise ParserError("DOCLING_WORKER_FAILED", "Docling worker failed safely")
    return _read_private_worker_response(
        response_path,
        max_bytes=max_output_bytes,
    )


def _error_response(status_code: int, code: str) -> JSONResponse:
    return _json_response(status_code, worker_error_payload(code))


def _json_response(status_code: int, payload: object) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=payload,
        headers={"Cache-Control": "no-store"},
    )


def prepare_socket(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o770)
    parent_stat = path.parent.lstat()
    if not stat.S_ISDIR(parent_stat.st_mode):
        raise WorkerConfigError("Docling socket parent is not a directory")
    if path.exists() or path.is_symlink():
        existing = path.lstat()
        if not stat.S_ISSOCK(existing.st_mode):
            raise WorkerConfigError("Refusing to replace a non-socket worker endpoint")
        path.unlink()


def main() -> int:
    import uvicorn

    settings = load_worker_settings()
    os.umask(0o007)
    prepare_socket(settings.socket_path)
    uvicorn.run(
        create_app(settings),
        uds=str(settings.socket_path),
        access_log=False,
        server_header=False,
        date_header=False,
        workers=1,
        log_level="warning",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
