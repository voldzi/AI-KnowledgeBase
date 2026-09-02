from __future__ import annotations

import hashlib
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import stat
import subprocess
import sys
import tempfile
import threading
from time import perf_counter
from typing import Any, Callable

from app.config import Settings
from app.object_storage import SourceObject
from parsers.base import DocumentParser, ParsedBlock, ParserError, ParserResult, ParserUnavailable
from parsers.text import _detect_heading, _detect_paragraph_number, _detect_structured_heading


DOCLING_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/csv",
    "text/html",
    "text/markdown",
    "text/x-markdown",
    "image/bmp",
    "image/jpeg",
    "image/png",
    "image/tiff",
    "image/webp",
}
DOCLING_SUFFIXES = {
    ".bmp",
    ".csv",
    ".docx",
    ".htm",
    ".html",
    ".jpeg",
    ".jpg",
    ".md",
    ".pdf",
    ".png",
    ".pptx",
    ".tif",
    ".tiff",
    ".webp",
    ".xlsx",
}
HEADING_LABELS = {"title", "section_header"}
TABLE_LABEL = "table"
GRANITE_MODEL_ID = "ibm-granite/granite-docling-258M"
WORKER_REQUEST_SCHEMA = "akb-docling-worker-request-1"
WORKER_RESPONSE_SCHEMA = "akb-docling-worker-response-1"
WORKER_ERROR_PATTERN = re.compile(r"^DOCLING_[A-Z0-9_]{1,80}$")
TESSERACT_LANGUAGE_PATTERN = re.compile(r"^[a-z0-9_-]{2,16}$")
TESSERACT_COMMAND_PATTERN = re.compile(r"^(?:/[A-Za-z0-9._/-]+|[A-Za-z0-9._-]+)$")


def _tesseract_languages(value: str) -> list[str]:
    languages = [item.strip().lower() for item in value.split("+") if item.strip()]
    if (
        not languages
        or len(languages) > 8
        or any(not TESSERACT_LANGUAGE_PATTERN.fullmatch(item) for item in languages)
    ):
        raise ParserError(
            "DOCLING_OCR_CONFIGURATION_INVALID",
            "Docling OCR languages are not valid Tesseract language codes",
        )
    return languages


def _validate_tesseract_command(value: str) -> str:
    if len(value) > 256 or not TESSERACT_COMMAND_PATTERN.fullmatch(value):
        raise ParserError(
            "DOCLING_OCR_CONFIGURATION_INVALID",
            "Docling OCR command is invalid",
        )
    return value


class DoclingParser(DocumentParser):
    """Feature-gated structured parser with an optional GraniteDocling PDF path."""

    name = "docling"

    def __init__(
        self,
        settings: Settings,
        *,
        converter_factory: Callable[..., Any] | None = None,
    ) -> None:
        self.settings = settings
        self._converter_factory = converter_factory
        self._converter_cache: dict[tuple[str, bool], Any] = {}
        self._artifact_digest: str | None = None
        self._readiness_error: str | None = None
        self._capacity = threading.BoundedSemaphore(settings.docling_max_concurrency)

    def supports(self, source: SourceObject) -> bool:
        suffix = Path(source.filename).suffix.lower()
        return source.mime_type.lower() in DOCLING_MIME_TYPES or suffix in DOCLING_SUFFIXES

    def readiness(self) -> str:
        if self.settings.docling_mode == "off":
            return "disabled"
        if self._readiness_error is not None:
            return "not_ready"
        if self._converter_factory is None and importlib.util.find_spec("docling") is None:
            self._readiness_error = "DOCLING_PACKAGE_UNAVAILABLE"
            return "not_ready"
        if self._converter_factory is None and self.settings.docling_artifacts_path is None:
            self._readiness_error = "DOCLING_ARTIFACTS_REQUIRED"
            return "not_ready"
        try:
            self._validate_artifacts()
        except ParserError as exc:
            self._readiness_error = exc.code
            return "not_ready"
        return "ready"

    def parse(
        self,
        source: SourceObject,
        *,
        parser_profile: str,
        ocr_enabled: bool = False,
    ) -> ParserResult:
        if not self.supports(source):
            raise ParserError("DOCLING_UNSUPPORTED_FILE_TYPE", "Docling does not support the source type")
        if self.readiness() != "ready":
            raise ParserUnavailable(
                self._readiness_error or "DOCLING_UNAVAILABLE",
                "The configured Docling parser is not ready",
            )

        acquired = self._capacity.acquire(timeout=self.settings.docling_queue_timeout_seconds)
        if not acquired:
            raise ParserUnavailable(
                "DOCLING_CAPACITY_EXHAUSTED",
                "Docling parsing capacity is temporarily exhausted",
            )
        try:
            return self._parse_with_capacity(
                source,
                parser_profile=parser_profile,
                ocr_enabled=ocr_enabled,
            )
        finally:
            self._capacity.release()

    def _parse_with_capacity(
        self,
        source: SourceObject,
        *,
        parser_profile: str,
        ocr_enabled: bool,
    ) -> ParserResult:
        effective_pipeline = self._effective_pipeline(source)
        if self._converter_factory is None:
            return self._parse_in_worker(
                source,
                pipeline=effective_pipeline,
                parser_profile=parser_profile,
                ocr_enabled=ocr_enabled,
            )

        started = perf_counter()
        try:
            with tempfile.TemporaryDirectory(prefix="akb-docling-") as temporary_dir:
                input_path = Path(temporary_dir) / f"source{_safe_suffix(source)}"
                _write_private_bytes(input_path, source.content)
                converter = self._converter(effective_pipeline, ocr_enabled=ocr_enabled)
                conversion = converter.convert(
                    input_path,
                    raises_on_error=False,
                    max_num_pages=self.settings.docling_max_pages,
                    max_file_size=self.settings.max_file_bytes,
                )
        except ParserError:
            raise
        except Exception as exc:
            raise ParserError(
                "DOCLING_CONVERSION_FAILED",
                f"Docling conversion failed safely ({exc.__class__.__name__})",
            ) from exc

        status = _enum_value(getattr(conversion, "status", None))
        if status not in {"success", "partial_success"}:
            raise ParserError(
                "DOCLING_CONVERSION_FAILED",
                "Docling did not return a usable conversion",
            )

        result = _document_to_result(
            conversion,
            pipeline=effective_pipeline,
            requested_pipeline=self.settings.docling_pipeline,
            device=self.settings.docling_device,
            parser_profile=parser_profile,
            artifact_digest=self._artifact_digest,
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

    def _parse_in_worker(
        self,
        source: SourceObject,
        *,
        pipeline: str,
        parser_profile: str,
        ocr_enabled: bool,
    ) -> ParserResult:
        artifacts_path = self.settings.docling_artifacts_path
        if artifacts_path is None or self._artifact_digest is None:
            raise ParserUnavailable(
                "DOCLING_ARTIFACTS_REQUIRED",
                "Docling requires an immutable local model bundle",
            )

        try:
            with tempfile.TemporaryDirectory(prefix="akb-docling-worker-") as temporary_dir:
                root = Path(temporary_dir)
                root.chmod(0o700)
                input_path = root / f"source{_safe_suffix(source)}"
                request_path = root / "request.json"
                response_path = root / "response.json"
                _write_private_bytes(input_path, source.content)
                _write_private_json(
                    request_path,
                    {
                        "schema": WORKER_REQUEST_SCHEMA,
                        "input_path": str(input_path),
                        "artifacts_path": str(artifacts_path.resolve()),
                        "artifacts_sha256": self._artifact_digest,
                        "pipeline": pipeline,
                        "requested_pipeline": self.settings.docling_pipeline,
                        "device": self.settings.docling_device,
                        "parser_profile": parser_profile,
                        "ocr_enabled": ocr_enabled,
                        "ocr_languages": _tesseract_languages(self.settings.ocr_language),
                        "tesseract_command": _validate_tesseract_command(
                            self.settings.tesseract_command
                        ),
                        "max_pages": self.settings.docling_max_pages,
                        "max_file_bytes": self.settings.max_file_bytes,
                        "document_timeout_seconds": self.settings.docling_document_timeout_seconds,
                    },
                )
                command = [
                    sys.executable,
                    "-m",
                    "parsers.docling_worker",
                    "--request",
                    str(request_path),
                    "--response",
                    str(response_path),
                ]
                try:
                    completed = subprocess.run(
                        command,
                        cwd=_service_root(),
                        env=_worker_environment(root, self.settings.docling_device),
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        check=False,
                        close_fds=True,
                        start_new_session=True,
                        timeout=self.settings.docling_worker_timeout_seconds,
                    )
                except subprocess.TimeoutExpired as exc:
                    raise ParserError(
                        "DOCLING_WORKER_TIMEOUT",
                        "Docling exceeded the isolated worker time limit",
                    ) from exc
                if completed.returncode != 0 and not response_path.is_file():
                    raise ParserError(
                        "DOCLING_WORKER_FAILED",
                        "The isolated Docling worker failed safely",
                    )
                payload = _read_private_worker_response(
                    response_path,
                    max_bytes=self.settings.docling_max_output_bytes,
                )
        except ParserError:
            raise
        except OSError as exc:
            raise ParserError(
                "DOCLING_WORKER_FAILED",
                "The isolated Docling worker failed safely",
            ) from exc
        return _parser_result_from_worker_payload(payload)

    def _effective_pipeline(self, source: SourceObject) -> str:
        if self.settings.docling_pipeline == "granite" and _is_pdf(source):
            return "granite"
        return "standard"

    def _converter(self, pipeline: str, *, ocr_enabled: bool) -> Any:
        key = (pipeline, bool(ocr_enabled))
        if key not in self._converter_cache:
            factory = self._converter_factory or self._build_converter
            self._converter_cache[key] = factory(
                pipeline=pipeline,
                ocr_enabled=ocr_enabled,
            )
        return self._converter_cache[key]

    def _build_converter(self, *, pipeline: str, ocr_enabled: bool) -> Any:
        return build_converter(
            artifacts_path=self.settings.docling_artifacts_path,
            document_timeout_seconds=self.settings.docling_document_timeout_seconds,
            device_name=self.settings.docling_device,
            pipeline=pipeline,
            ocr_enabled=ocr_enabled,
            ocr_languages=_tesseract_languages(self.settings.ocr_language),
            tesseract_command=_validate_tesseract_command(
                self.settings.tesseract_command
            ),
        )

    def _validate_artifacts(self) -> None:
        if self._artifact_digest is not None:
            return
        path = self.settings.docling_artifacts_path
        if path is None:
            raise ParserUnavailable(
                "DOCLING_ARTIFACTS_REQUIRED",
                "Docling model artifacts are not configured",
            )
        actual = directory_sha256(path)
        expected = self.settings.docling_artifacts_sha256
        if expected is not None and actual != expected:
            raise ParserUnavailable(
                "DOCLING_ARTIFACT_DIGEST_MISMATCH",
                "Docling model artifacts do not match the configured digest",
            )
        self._artifact_digest = actual


def build_converter(
    *,
    artifacts_path: Path,
    document_timeout_seconds: float,
    device_name: str,
    pipeline: str,
    ocr_enabled: bool,
    ocr_languages: list[str],
    tesseract_command: str,
) -> Any:
    from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (
        PdfPipelineOptions,
        TesseractCliOcrOptions,
        VlmConvertOptions,
        VlmPipelineOptions,
    )
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.pipeline.vlm_pipeline import VlmPipeline

    accelerator_device = AcceleratorDevice("cpu" if device_name == "mlx" else device_name)
    accelerator_options = AcceleratorOptions(device=accelerator_device)
    if device_name == "cpu" and platform.system() == "Darwin":
        # A headless macOS worker can lack Metal even when MLX is installed.
        from transformers.utils import generic as transformers_generic

        transformers_generic._is_mlx_available = False
    if pipeline == "granite":
        engine_options = None
        if device_name == "mlx":
            from docling.models.inference_engines.vlm.mlx_engine import MlxVlmEngineOptions

            engine_options = MlxVlmEngineOptions()
        elif device_name in {"cpu", "cuda", "mps"}:
            from docling.models.inference_engines.vlm.transformers_engine import (
                TransformersVlmEngineOptions,
            )

            engine_options = TransformersVlmEngineOptions(
                device=accelerator_device,
                load_in_8bit=False,
            )
        options = VlmPipelineOptions(
            artifacts_path=artifacts_path,
            document_timeout=document_timeout_seconds,
            accelerator_options=accelerator_options,
            enable_remote_services=False,
            allow_external_plugins=False,
            vlm_options=VlmConvertOptions.from_preset(
                "granite_docling",
                engine_options=engine_options,
            ),
        )
        return DocumentConverter(
            format_options={
                InputFormat.PDF: PdfFormatOption(
                    pipeline_cls=VlmPipeline,
                    pipeline_options=options,
                )
            }
        )

    options = PdfPipelineOptions(
        artifacts_path=artifacts_path,
        document_timeout=document_timeout_seconds,
        accelerator_options=accelerator_options,
        enable_remote_services=False,
        allow_external_plugins=False,
        do_ocr=ocr_enabled,
        ocr_options=TesseractCliOcrOptions(
            lang=ocr_languages,
            tesseract_cmd=_validate_tesseract_command(tesseract_command),
        ),
        do_table_structure=True,
    )
    return DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)}
    )


def worker_success_payload(result: ParserResult) -> dict[str, Any]:
    return {
        "schema": WORKER_RESPONSE_SCHEMA,
        "status": "success",
        "result": {
            "parser_name": result.parser_name,
            "blocks": [
                {
                    "text": block.text,
                    "page_number": block.page_number,
                    "section_path": block.section_path,
                    "section_title": block.section_title,
                    "article_number": block.article_number,
                    "paragraph_number": block.paragraph_number,
                    "char_start": block.char_start,
                    "char_end": block.char_end,
                    "block_type": block.block_type,
                    "metadata": block.metadata,
                }
                for block in result.blocks
            ],
            "pages_processed": result.pages_processed,
            "tables_detected": result.tables_detected,
            "ocr_used": result.ocr_used,
            "warnings": [list(item) for item in result.warnings],
            "metadata": result.metadata,
        },
    }


def worker_error_payload(code: str) -> dict[str, str]:
    safe_code = code if WORKER_ERROR_PATTERN.fullmatch(code) else "DOCLING_WORKER_FAILED"
    return {
        "schema": WORKER_RESPONSE_SCHEMA,
        "status": "error",
        "error_code": safe_code,
    }


def _parser_result_from_worker_payload(payload: object) -> ParserResult:
    if not isinstance(payload, dict) or payload.get("schema") != WORKER_RESPONSE_SCHEMA:
        raise _worker_protocol_error()
    status_value = payload.get("status")
    if status_value == "error":
        if set(payload) != {"schema", "status", "error_code"}:
            raise _worker_protocol_error()
        error_code = payload.get("error_code")
        if not isinstance(error_code, str) or not WORKER_ERROR_PATTERN.fullmatch(error_code):
            raise _worker_protocol_error()
        raise ParserError(error_code, "The isolated Docling worker failed safely")
    if status_value != "success" or set(payload) != {"schema", "status", "result"}:
        raise _worker_protocol_error()

    result = payload.get("result")
    required_result_keys = {
        "parser_name",
        "blocks",
        "pages_processed",
        "tables_detected",
        "ocr_used",
        "warnings",
        "metadata",
    }
    if not isinstance(result, dict) or set(result) != required_result_keys:
        raise _worker_protocol_error()
    parser_name = result.get("parser_name")
    pages_processed = result.get("pages_processed")
    tables_detected = result.get("tables_detected")
    ocr_used = result.get("ocr_used")
    metadata = result.get("metadata")
    raw_blocks = result.get("blocks")
    raw_warnings = result.get("warnings")
    if (
        not isinstance(parser_name, str)
        or type(pages_processed) is not int
        or pages_processed < 0
        or type(tables_detected) is not int
        or tables_detected < 0
        or type(ocr_used) is not bool
        or not isinstance(metadata, dict)
        or not isinstance(raw_blocks, list)
        or not isinstance(raw_warnings, list)
    ):
        raise _worker_protocol_error()

    block_keys = {
        "text",
        "page_number",
        "section_path",
        "section_title",
        "article_number",
        "paragraph_number",
        "char_start",
        "char_end",
        "block_type",
        "metadata",
    }
    blocks: list[ParsedBlock] = []
    for raw_block in raw_blocks:
        if not isinstance(raw_block, dict) or set(raw_block) != block_keys:
            raise _worker_protocol_error()
        page_number = raw_block.get("page_number")
        section_path = raw_block.get("section_path")
        if (
            not isinstance(raw_block.get("text"), str)
            or (page_number is not None and (type(page_number) is not int or page_number <= 0))
            or not isinstance(section_path, list)
            or not all(isinstance(item, str) for item in section_path)
            or not _optional_string(raw_block.get("section_title"))
            or not _optional_string(raw_block.get("article_number"))
            or not _optional_string(raw_block.get("paragraph_number"))
            or type(raw_block.get("char_start")) is not int
            or type(raw_block.get("char_end")) is not int
            or not isinstance(raw_block.get("block_type"), str)
            or not isinstance(raw_block.get("metadata"), dict)
        ):
            raise _worker_protocol_error()
        if raw_block["char_start"] < 0 or raw_block["char_end"] < raw_block["char_start"]:
            raise _worker_protocol_error()
        blocks.append(ParsedBlock(**raw_block))

    warnings: list[tuple[str, str]] = []
    for item in raw_warnings:
        if (
            not isinstance(item, list)
            or len(item) != 2
            or not all(isinstance(value, str) for value in item)
        ):
            raise _worker_protocol_error()
        warnings.append((item[0], item[1]))
    return ParserResult(
        parser_name=parser_name,
        blocks=blocks,
        pages_processed=pages_processed,
        tables_detected=tables_detected,
        ocr_used=ocr_used,
        warnings=warnings,
        metadata=metadata,
    )


def _optional_string(value: object) -> bool:
    return value is None or isinstance(value, str)


def _worker_protocol_error() -> ParserError:
    return ParserError(
        "DOCLING_WORKER_RESPONSE_INVALID",
        "The isolated Docling worker returned an invalid response",
    )


def _read_private_worker_response(path: Path, *, max_bytes: int) -> object:
    try:
        file_stat = path.lstat()
    except OSError as exc:
        raise _worker_protocol_error() from exc
    if (
        not stat.S_ISREG(file_stat.st_mode)
        or stat.S_IMODE(file_stat.st_mode) != 0o600
        or file_stat.st_size <= 0
        or file_stat.st_size > max_bytes
    ):
        raise _worker_protocol_error()
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise _worker_protocol_error() from exc


def _write_private_bytes(path: Path, value: bytes) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(value)


def _write_private_json(path: Path, value: object) -> None:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    _write_private_bytes(path, payload)


def _service_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _worker_environment(temporary_root: Path, device: str) -> dict[str, str]:
    environment = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "PYTHONPATH": str(_service_root()),
        "PYTHONNOUSERSITE": "1",
        "HOME": str(temporary_root),
        "TMPDIR": str(temporary_root),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "HF_HUB_OFFLINE": "1",
        "HF_DATASETS_OFFLINE": "1",
        "TRANSFORMERS_OFFLINE": "1",
        "TOKENIZERS_PARALLELISM": "false",
        "OMP_NUM_THREADS": "1",
        "MKL_NUM_THREADS": "1",
    }
    if device == "cpu":
        environment["CUDA_VISIBLE_DEVICES"] = ""
    return environment


def directory_sha256(root: Path) -> str:
    """Return a deterministic content digest while rejecting escaping symlinks."""

    try:
        resolved_root = root.resolve(strict=True)
    except OSError as exc:
        raise ParserUnavailable(
            "DOCLING_ARTIFACTS_UNAVAILABLE",
            "Docling model artifacts directory is unavailable",
        ) from exc
    if not resolved_root.is_dir():
        raise ParserUnavailable(
            "DOCLING_ARTIFACTS_UNAVAILABLE",
            "Docling model artifacts directory is unavailable",
        )
    digest = hashlib.sha256()
    try:
        entries = list(resolved_root.rglob("*"))
    except OSError as exc:
        raise ParserUnavailable(
            "DOCLING_ARTIFACTS_UNREADABLE",
            "Docling model artifacts directory cannot be read",
        ) from exc
    files = sorted(path for path in entries if path.is_file())
    if not files:
        raise ParserUnavailable(
            "DOCLING_ARTIFACTS_EMPTY",
            "Docling model artifacts directory is empty",
        )
    for path in files:
        try:
            resolved_path = path.resolve(strict=True)
        except OSError as exc:
            raise ParserUnavailable(
                "DOCLING_ARTIFACTS_UNREADABLE",
                "A Docling model artifact cannot be read",
            ) from exc
        if resolved_root != resolved_path and resolved_root not in resolved_path.parents:
            raise ParserUnavailable(
                "DOCLING_ARTIFACTS_PATH_ESCAPE",
                "Docling model artifacts contain an escaping symlink",
            )
        relative = path.relative_to(resolved_root).as_posix().encode("utf-8")
        file_digest = hashlib.sha256()
        try:
            with resolved_path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    file_digest.update(chunk)
            file_size = resolved_path.stat().st_size
        except OSError as exc:
            raise ParserUnavailable(
                "DOCLING_ARTIFACTS_UNREADABLE",
                "A Docling model artifact cannot be read",
            ) from exc
        digest.update(relative)
        digest.update(b"\0")
        digest.update(str(file_size).encode("ascii"))
        digest.update(b"\0")
        digest.update(file_digest.digest())
        digest.update(b"\n")
    return f"sha256:{digest.hexdigest()}"


def _document_to_result(
    conversion: Any,
    *,
    pipeline: str,
    requested_pipeline: str,
    device: str,
    parser_profile: str,
    artifact_digest: str | None,
    elapsed_ms: int,
) -> ParserResult:
    document = conversion.document
    blocks: list[ParsedBlock] = []
    headings: list[tuple[int, str]] = []
    article_number: str | None = None
    paragraph_number: str | None = None
    offset = 0
    tables_detected = 0
    label_counts: dict[str, int] = {}

    for item, raw_level in document.iterate_items():
        level = max(1, int(raw_level or 1))
        label = _enum_value(getattr(item, "label", None)) or "unknown"
        text = _item_text(item, document=document, label=label)
        if not text:
            continue
        label_counts[label] = label_counts.get(label, 0) + 1
        metadata = _item_metadata(item, label=label, level=level)

        if label in HEADING_LABELS:
            headings = [(depth, heading) for depth, heading in headings if depth < level]
            headings.append((level, text))
            article_number, paragraph_number = None, None
            for _, heading in headings:
                structured = _detect_structured_heading(heading)
                if structured and structured["level"] == "article":
                    article_number = structured["article_number"]
                    paragraph_number = None
                elif structured and structured["level"] == "paragraph":
                    paragraph_number = structured["paragraph_number"]
            block_type = "heading"
        elif label == TABLE_LABEL:
            block_type = "table"
            tables_detected += 1
            lines = text.splitlines()
            header_lines = min(2, len(lines))
            if header_lines:
                metadata.update(
                    {
                        "table_header": "\n".join(lines[:header_lines]),
                        "table_header_line_count": header_lines,
                    }
                )
        else:
            detected_heading = _detect_heading(text)
            if detected_heading is not None and label in {"text", "paragraph"}:
                block_type = "heading"
                headings = [(1, text)]
                article_number = detected_heading.get("article_number")
                paragraph_number = detected_heading.get("paragraph_number")
            else:
                block_type = "paragraph"
                paragraph_number = _detect_paragraph_number(text) or paragraph_number

        page_number = _page_number(item)
        blocks.append(
            ParsedBlock(
                text=text,
                page_number=page_number,
                section_path=[heading for _, heading in headings],
                section_title=headings[-1][1] if headings else None,
                article_number=article_number,
                paragraph_number=paragraph_number,
                char_start=offset,
                char_end=offset + len(text),
                block_type=block_type,
                metadata=metadata,
            )
        )
        offset += len(text) + 2

    pages_processed = len(getattr(document, "pages", {}) or {})
    pages_with_text = len(
        {block.page_number for block in blocks if block.page_number is not None and block.text.strip()}
    )
    empty_pages = [
        page for page in range(1, pages_processed + 1)
        if page not in {block.page_number for block in blocks if block.text.strip()}
    ]
    structural_payload = document.export_to_dict()
    structural_hash = hashlib.sha256(
        json.dumps(
            structural_payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    ocr_used = any(
        bool(getattr(cell, "from_ocr", False))
        for page in getattr(conversion, "pages", [])
        for cell in getattr(page, "cells", [])
    )
    warnings: list[tuple[str, str]] = []
    if not blocks:
        warnings.append(("NO_TEXT_EXTRACTED", "Docling did not extract readable content."))

    capabilities = ["document_structure", "section_citations", "structured_tables"]
    if any(block.page_number is not None for block in blocks):
        capabilities.append("page_citations")
    if any("bounding_box" in block.metadata for block in blocks):
        capabilities.append("bounding_boxes")
    if pipeline == "granite":
        capabilities.append("granite_docling_vlm")
    return ParserResult(
        parser_name="granite_docling" if pipeline == "granite" else "docling_standard",
        blocks=blocks,
        pages_processed=pages_processed,
        tables_detected=tables_detected,
        ocr_used=ocr_used,
        warnings=warnings,
        metadata={
            "parser_engine": "granite_docling" if pipeline == "granite" else "docling",
            "parser_version": _package_version("docling-slim"),
            "docling_pipeline": pipeline,
            "docling_requested_pipeline": requested_pipeline,
            "docling_device": device,
            "docling_model_id": GRANITE_MODEL_ID if pipeline == "granite" else None,
            "docling_artifacts_sha256": artifact_digest,
            "docling_structural_sha256": f"sha256:{structural_hash}",
            "docling_conversion_status": _enum_value(getattr(conversion, "status", None)),
            "docling_elapsed_ms": elapsed_ms,
            "docling_platform": f"{platform.system().lower()}-{platform.machine().lower()}",
            "parser_profile": parser_profile,
            "page_mapping": "docling_provenance" if pages_processed else "unavailable",
            "pages_with_text": pages_with_text,
            "empty_pages": empty_pages[:100],
            "text_chars_extracted": sum(len(block.text) for block in blocks),
            "label_counts": label_counts,
            "capabilities": capabilities,
            "requires_review": bool(warnings),
        },
    )


def _item_text(item: Any, *, document: Any, label: str) -> str:
    if label == TABLE_LABEL and hasattr(item, "export_to_markdown"):
        value = item.export_to_markdown(doc=document)
    else:
        value = getattr(item, "text", None)
        if not value and label == "code":
            value = getattr(item, "code_text", None)
    return str(value or "").strip()


def _item_metadata(item: Any, *, label: str, level: int) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "source_format": "docling",
        "offset_basis": "extracted_text",
        "docling_label": label,
        "docling_level": level,
    }
    self_ref = getattr(item, "self_ref", None)
    if isinstance(self_ref, str):
        metadata["docling_self_ref"] = self_ref
    provenance = getattr(item, "prov", None) or []
    if provenance:
        first = provenance[0]
        bbox = getattr(first, "bbox", None)
        charspan = getattr(first, "charspan", None)
        if bbox is not None and hasattr(bbox, "model_dump"):
            metadata["bounding_box"] = bbox.model_dump(mode="json")
        if charspan is not None:
            metadata["source_charspan"] = list(charspan)
    return metadata


def _page_number(item: Any) -> int | None:
    provenance = getattr(item, "prov", None) or []
    if not provenance:
        return None
    page_number = getattr(provenance[0], "page_no", None)
    return int(page_number) if isinstance(page_number, int) and page_number > 0 else None


def _enum_value(value: Any) -> str:
    enum_value = getattr(value, "value", value)
    return str(enum_value or "").strip().lower()


def _package_version(package: str) -> str:
    try:
        return importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


def _is_pdf(source: SourceObject) -> bool:
    return source.mime_type.lower() == "application/pdf" or source.filename.lower().endswith(".pdf")


def _safe_suffix(source: SourceObject) -> str:
    suffix = Path(source.filename).suffix.lower()
    if suffix in DOCLING_SUFFIXES:
        return suffix
    mime_suffixes = {
        "application/pdf": ".pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
        "text/html": ".html",
        "text/csv": ".csv",
        "text/markdown": ".md",
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/tiff": ".tiff",
    }
    return mime_suffixes.get(source.mime_type.lower(), ".bin")


def _with_warning(
    result: ParserResult,
    code: str,
    message: str,
    *,
    metadata: dict[str, Any] | None = None,
) -> ParserResult:
    return ParserResult(
        parser_name=result.parser_name,
        blocks=result.blocks,
        pages_processed=result.pages_processed,
        tables_detected=result.tables_detected,
        ocr_used=result.ocr_used,
        warnings=[*result.warnings, (code, message)],
        metadata={**result.metadata, **(metadata or {})},
    )


def shadow_summary(authoritative: ParserResult, candidate: ParserResult) -> dict[str, Any]:
    authoritative_chars = authoritative.text_length
    candidate_chars = candidate.text_length
    return {
        "status": "success",
        "parser": candidate.parser_name,
        "parser_version": candidate.metadata.get("parser_version"),
        "pipeline": candidate.metadata.get("docling_pipeline"),
        "artifacts_sha256": candidate.metadata.get("docling_artifacts_sha256"),
        "blocks": len(candidate.blocks),
        "pages": candidate.pages_processed,
        "tables": candidate.tables_detected,
        "text_chars": candidate_chars,
        "text_coverage_ratio": round(
            candidate_chars / authoritative_chars,
            4,
        ) if authoritative_chars else (1.0 if candidate_chars else 0.0),
        "table_delta": candidate.tables_detected - authoritative.tables_detected,
        "page_delta": candidate.pages_processed - authoritative.pages_processed,
        "elapsed_ms": candidate.metadata.get("docling_elapsed_ms"),
    }


def result_with_metadata(
    result: ParserResult,
    *,
    metadata: dict[str, Any],
    warning: tuple[str, str] | None = None,
) -> ParserResult:
    return ParserResult(
        parser_name=result.parser_name,
        blocks=result.blocks,
        pages_processed=result.pages_processed,
        tables_detected=result.tables_detected,
        ocr_used=result.ocr_used,
        warnings=[*result.warnings, *([warning] if warning else [])],
        metadata={**result.metadata, **metadata},
    )
