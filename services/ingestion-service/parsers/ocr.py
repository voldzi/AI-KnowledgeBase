from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from app.config import Settings
from app.object_storage import SourceObject
from parsers.base import ParserError, ParserResult
from parsers.text import parse_text


class OcrProvider:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def extract(self, source: SourceObject, *, parser_profile: str) -> ParserResult:
        if self.settings.ocr_provider == "disabled":
            raise ParserError("OCR_DISABLED", "OCR fallback is disabled")
        if self.settings.ocr_provider == "sidecar":
            return self._sidecar(source, parser_profile=parser_profile)
        if self.settings.ocr_provider == "tesseract":
            return self._tesseract(source, parser_profile=parser_profile)
        raise ParserError("OCR_PROVIDER_UNSUPPORTED", "OCR provider is unsupported")

    def _sidecar(self, source: SourceObject, *, parser_profile: str) -> ParserResult:
        if source.local_path is None:
            raise ParserError("OCR_SIDECAR_UNAVAILABLE", "OCR sidecar requires local object storage")

        candidates = [
            source.local_path.with_suffix(source.local_path.suffix + ".ocr.txt"),
            source.local_path.with_suffix(".ocr.txt"),
        ]
        for candidate in candidates:
            if candidate.exists() and candidate.is_file():
                result = parse_text(
                    candidate.read_bytes(),
                    parser_name="ocr_sidecar",
                    parser_profile=parser_profile,
                )
                return ParserResult(
                    parser_name=result.parser_name,
                    blocks=result.blocks,
                    pages_processed=result.pages_processed,
                    tables_detected=result.tables_detected,
                    ocr_used=True,
                    warnings=result.warnings,
                )
        raise ParserError("OCR_SIDECAR_NOT_FOUND", "OCR sidecar text file was not found")

    def _tesseract(self, source: SourceObject, *, parser_profile: str) -> ParserResult:
        if source.mime_type not in {"image/png", "image/jpeg", "image/tiff", "image/bmp"}:
            raise ParserError("OCR_UNSUPPORTED_MEDIA_TYPE", "Tesseract OCR fallback supports image files only")

        suffix = Path(source.filename).suffix or ".img"
        with tempfile.NamedTemporaryFile(suffix=suffix) as input_file:
            input_file.write(source.content)
            input_file.flush()
            command = [
                self.settings.tesseract_command,
                input_file.name,
                "stdout",
                "-l",
                self.settings.ocr_language,
            ]
            try:
                completed = subprocess.run(
                    command,
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=self.settings.request_timeout_seconds,
                )
            except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired) as exc:
                raise ParserError("OCR_TESSERACT_FAILED", "Tesseract OCR failed") from exc

        result = parse_text(
            completed.stdout.encode("utf-8"),
            parser_name="ocr_tesseract",
            parser_profile=parser_profile,
        )
        return ParserResult(
            parser_name=result.parser_name,
            blocks=result.blocks,
            pages_processed=result.pages_processed,
            tables_detected=result.tables_detected,
            ocr_used=True,
            warnings=result.warnings,
        )
