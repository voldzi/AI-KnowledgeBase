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
        if self.settings.ocr_provider == "ocrmypdf":
            return self._ocrmypdf(source, parser_profile=parser_profile)
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
                text = candidate.read_text(encoding="utf-8")
                result = parse_text(
                    text.encode("utf-8"),
                    parser_name="ocr_sidecar",
                    parser_profile=parser_profile,
                )
                pages_with_text, empty_pages = _text_page_stats(text, pages_processed=result.pages_processed)
                return ParserResult(
                    parser_name=result.parser_name,
                    blocks=result.blocks,
                    pages_processed=result.pages_processed,
                    tables_detected=result.tables_detected,
                    ocr_used=True,
                    warnings=result.warnings,
                    metadata=_ocr_metadata(
                        parser_engine="ocr_sidecar",
                        text=result.text_length,
                        pages_with_text=pages_with_text,
                        empty_pages=empty_pages,
                        capabilities=["ocr_text_sidecar"],
                        language=self.settings.ocr_language,
                    ),
                )
        raise ParserError("OCR_SIDECAR_NOT_FOUND", "OCR sidecar text file was not found")

    def _ocrmypdf(self, source: SourceObject, *, parser_profile: str) -> ParserResult:
        if not _is_pdf(source):
            raise ParserError("OCR_UNSUPPORTED_MEDIA_TYPE", "OCRmyPDF fallback supports PDF files only")

        with tempfile.TemporaryDirectory(prefix="akl-ocrmypdf-") as temp_dir:
            temp_path = Path(temp_dir)
            input_path = temp_path / "source.pdf"
            output_path = temp_path / "ocr.pdf"
            sidecar_path = temp_path / "ocr.txt"
            input_path.write_bytes(source.content)

            command = [
                self.settings.ocrmypdf_command,
                "--force-ocr",
                "--deskew",
                "--rotate-pages",
                "--sidecar",
                str(sidecar_path),
                "-l",
                self.settings.ocr_language,
                str(input_path),
                str(output_path),
            ]
            try:
                subprocess.run(
                    command,
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=self.settings.ocr_timeout_seconds,
                )
            except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired) as exc:
                raise ParserError("OCR_OCRMYPDF_FAILED", "OCRmyPDF PDF OCR failed") from exc

            if not sidecar_path.exists():
                raise ParserError("OCR_OCRMYPDF_NO_SIDECAR", "OCRmyPDF did not produce sidecar text")

            text = sidecar_path.read_text(encoding="utf-8")
            result = parse_text(
                text.encode("utf-8"),
                parser_name="ocr_ocrmypdf",
                parser_profile=parser_profile,
            )
            pages_with_text, empty_pages = _text_page_stats(text, pages_processed=result.pages_processed)
            return ParserResult(
                parser_name=result.parser_name,
                blocks=result.blocks,
                pages_processed=result.pages_processed,
                tables_detected=result.tables_detected,
                ocr_used=True,
                warnings=result.warnings,
                metadata=_ocr_metadata(
                    parser_engine="ocrmypdf",
                    text=result.text_length,
                    pages_with_text=pages_with_text,
                    empty_pages=empty_pages,
                    capabilities=["pdf_ocr", "ocr_text_sidecar", "deskew", "rotate_pages"],
                    language=self.settings.ocr_language,
                ),
            )

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
                    timeout=self.settings.ocr_timeout_seconds,
                )
            except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired) as exc:
                raise ParserError("OCR_TESSERACT_FAILED", "Tesseract OCR failed") from exc

        result = parse_text(
            completed.stdout.encode("utf-8"),
            parser_name="ocr_tesseract",
            parser_profile=parser_profile,
        )
        pages_with_text, empty_pages = _text_page_stats(completed.stdout, pages_processed=result.pages_processed)
        return ParserResult(
            parser_name=result.parser_name,
            blocks=result.blocks,
            pages_processed=result.pages_processed,
            tables_detected=result.tables_detected,
            ocr_used=True,
            warnings=result.warnings,
            metadata=_ocr_metadata(
                parser_engine="ocr_tesseract",
                text=result.text_length,
                pages_with_text=pages_with_text,
                empty_pages=empty_pages,
                capabilities=["image_ocr"],
                language=self.settings.ocr_language,
            ),
        )


def _is_pdf(source: SourceObject) -> bool:
    return source.mime_type == "application/pdf" or Path(source.filename).suffix.lower() == ".pdf"


def _text_page_stats(text: str, *, pages_processed: int) -> tuple[int, list[int]]:
    pages = text.split("\f") if text else [""]
    if len(pages) < pages_processed:
        pages.extend([""] * (pages_processed - len(pages)))
    pages_with_text = 0
    empty_pages: list[int] = []
    for index, page_text in enumerate(pages[: max(1, pages_processed)], start=1):
        if page_text.strip():
            pages_with_text += 1
        else:
            empty_pages.append(index)
    return pages_with_text, empty_pages


def _ocr_metadata(
    *,
    parser_engine: str,
    text: int,
    pages_with_text: int,
    empty_pages: list[int],
    capabilities: list[str],
    language: str,
) -> dict[str, object]:
    return {
        "parser_engine": parser_engine,
        "ocr_language": language,
        "pages_with_text": pages_with_text,
        "empty_pages": empty_pages,
        "text_chars_extracted": text,
        "capabilities": capabilities,
    }
