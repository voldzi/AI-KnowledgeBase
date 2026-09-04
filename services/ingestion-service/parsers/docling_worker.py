from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import stat
from time import perf_counter

from parsers.base import ParserError
from parsers.docling import (
    WORKER_REQUEST_SCHEMA,
    _document_to_result,
    _enum_value,
    _with_warning,
    _write_private_json,
    build_converter,
    directory_sha256,
    worker_error_payload,
    worker_success_payload,
)


SHA256_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
REQUEST_KEYS = {
    "schema",
    "input_path",
    "artifacts_path",
    "artifacts_sha256",
    "pipeline",
    "requested_pipeline",
    "device",
    "parser_profile",
    "ocr_enabled",
    "ocr_languages",
    "tesseract_command",
    "max_pages",
    "max_file_bytes",
    "document_timeout_seconds",
}


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--response", required=True, type=Path)
    args = parser.parse_args()
    try:
        request = _read_request(args.request, args.response)
        result = _convert(request)
        payload = worker_success_payload(result)
    except ParserError as exc:
        payload = worker_error_payload(exc.code)
    except Exception:
        payload = worker_error_payload("DOCLING_WORKER_FAILED")
    try:
        _write_private_json(args.response, payload)
    except OSError:
        return 2
    return 0


def _read_request(request_path: Path, response_path: Path) -> dict[str, object]:
    try:
        request_root = request_path.parent.resolve(strict=True)
        if response_path.parent.resolve(strict=True) != request_root or response_path.exists():
            raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid worker paths")
        file_stat = request_path.lstat()
        if (
            not stat.S_ISREG(file_stat.st_mode)
            or stat.S_IMODE(file_stat.st_mode) != 0o600
            or not 0 < file_stat.st_size <= 64 * 1024
        ):
            raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid worker request")
        value = json.loads(request_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid worker request") from exc
    if not isinstance(value, dict) or set(value) != REQUEST_KEYS:
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid worker request")
    if value.get("schema") != WORKER_REQUEST_SCHEMA:
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid worker request")

    input_path = Path(_required_string(value, "input_path"))
    artifacts_path = Path(_required_string(value, "artifacts_path"))
    try:
        resolved_input = input_path.resolve(strict=True)
    except OSError as exc:
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid worker input") from exc
    input_stat = input_path.lstat()
    if (
        resolved_input.parent != request_root
        or not input_path.name.startswith("source.")
        or not stat.S_ISREG(input_stat.st_mode)
        or stat.S_IMODE(input_stat.st_mode) != 0o600
    ):
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid worker input")

    max_file_bytes = _positive_int(value, "max_file_bytes")
    if input_stat.st_size > max_file_bytes:
        raise ParserError("DOCLING_FILE_TOO_LARGE", "Docling input exceeds the configured limit")
    artifact_digest = _required_string(value, "artifacts_sha256")
    if not SHA256_PATTERN.fullmatch(artifact_digest):
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid artifact digest")
    if directory_sha256(artifacts_path) != artifact_digest:
        raise ParserError("DOCLING_ARTIFACT_DIGEST_MISMATCH", "Artifact digest mismatch")

    pipeline = _required_string(value, "pipeline")
    requested_pipeline = _required_string(value, "requested_pipeline")
    device = _required_string(value, "device")
    if pipeline not in {"standard", "granite"} or requested_pipeline not in {
        "standard",
        "granite",
    }:
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid pipeline")
    if device not in {"auto", "cpu", "cuda", "mps", "mlx"}:
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid device")
    if type(value.get("ocr_enabled")) is not bool:
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid OCR flag")
    ocr_languages = value.get("ocr_languages")
    if (
        not isinstance(ocr_languages, list)
        or not ocr_languages
        or len(ocr_languages) > 8
        or any(
            not isinstance(item, str)
            or not re.fullmatch(r"[a-z0-9_-]{2,16}", item)
            for item in ocr_languages
        )
    ):
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid OCR languages")
    command = _required_string(value, "tesseract_command")
    if len(command) > 256 or not re.fullmatch(
        r"(?:/[A-Za-z0-9._/-]+|[A-Za-z0-9._-]+)", command
    ):
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid OCR command")
    timeout = value.get("document_timeout_seconds")
    if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or timeout <= 0:
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid document timeout")
    _positive_int(value, "max_pages")
    _required_string(value, "parser_profile")
    return value


def _convert(request: dict[str, object]):  # type: ignore[no-untyped-def]
    started = perf_counter()
    pipeline = str(request["pipeline"])
    converter = build_converter(
        artifacts_path=Path(str(request["artifacts_path"])),
        document_timeout_seconds=float(request["document_timeout_seconds"]),
        device_name=str(request["device"]),
        pipeline=pipeline,
        ocr_enabled=bool(request["ocr_enabled"]),
        ocr_languages=[str(item) for item in request["ocr_languages"]],
        tesseract_command=str(request["tesseract_command"]),
    )
    conversion = converter.convert(
        Path(str(request["input_path"])),
        raises_on_error=False,
        max_num_pages=int(request["max_pages"]),
        max_file_size=int(request["max_file_bytes"]),
    )
    status = _enum_value(getattr(conversion, "status", None))
    if status not in {"success", "partial_success"}:
        raise ParserError("DOCLING_CONVERSION_FAILED", "Docling conversion failed")
    result = _document_to_result(
        conversion,
        pipeline=pipeline,
        requested_pipeline=str(request["requested_pipeline"]),
        device=str(request["device"]),
        parser_profile=str(request["parser_profile"]),
        artifact_digest=str(request["artifacts_sha256"]),
        elapsed_ms=round((perf_counter() - started) * 1000),
    )
    if status == "partial_success":
        return _with_warning(
            result,
            "DOCLING_PARTIAL_SUCCESS",
            "Docling completed with recoverable conversion warnings; review is required.",
            metadata={"requires_review": True},
        )
    return result


def _required_string(value: dict[str, object], key: str) -> str:
    item = value.get(key)
    if not isinstance(item, str) or not item:
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid worker request")
    return item


def _positive_int(value: dict[str, object], key: str) -> int:
    item = value.get(key)
    if type(item) is not int or item <= 0:
        raise ParserError("DOCLING_WORKER_REQUEST_INVALID", "Invalid worker request")
    return item


if __name__ == "__main__":
    raise SystemExit(main())
