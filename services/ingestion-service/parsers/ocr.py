from __future__ import annotations

import hashlib
import subprocess
import tempfile
from dataclasses import replace
from io import BytesIO
from pathlib import Path

from app.config import Settings
from app.document_formats import CATALOG
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
            if source.mime_type.lower() in {"image/png", "image/jpeg", "image/webp"}:
                # The OCRmyPDF image also supplies Tesseract for ordinary images.
                return self._tesseract(source, parser_profile=parser_profile)
            return self._ocrmypdf(source, parser_profile=parser_profile)
        raise ParserError("OCR_PROVIDER_UNSUPPORTED", "OCR provider is unsupported")

    def extract_pdf_pages(
        self, source: SourceObject, *, parser_profile: str,
        page_numbers: list[int], total_pages: int,
    ) -> ParserResult:
        """OCR only missing PDF pages, retaining their original page coordinates."""
        if self.settings.ocr_provider == "disabled":
            raise ParserError("OCR_DISABLED", "OCR fallback is disabled")
        if self.settings.ocr_provider == "sidecar":
            # A full-document sidecar must have explicit, exact page boundaries.
            return _parse_exact_pages(
                self._sidecar_text(source), page_numbers=list(range(1, total_pages + 1)),
                parser_name="ocr_sidecar", parser_engine="ocr_sidecar",
                language=self.settings.ocr_language, capabilities=["ocr_text_sidecar"],
                parser_profile=parser_profile, selected_pages=page_numbers,
            )
        if self.settings.ocr_provider != "ocrmypdf":
            raise ParserError("OCR_PAGE_MAPPING_UNAVAILABLE", "The OCR provider cannot preserve PDF page coordinates")

        try:
            from pypdf import PdfReader, PdfWriter

            reader = PdfReader(BytesIO(source.content))
            if len(reader.pages) != total_pages or not page_numbers or any(
                page < 1 or page > total_pages for page in page_numbers
            ):
                raise ValueError("PDF page coordinates differ from the native parser")
            writer = PdfWriter()
            for page in page_numbers:
                writer.add_page(reader.pages[page - 1])
            output = BytesIO()
            writer.write(output)
            content = output.getvalue()
        except Exception as exc:
            raise ParserError("OCR_PDF_PAGE_SELECTION_FAILED", "Could not prepare exact PDF pages for OCR") from exc
        subset = replace(
            source, content=content, local_path=None,
            sha256="sha256:" + hashlib.sha256(content).hexdigest(),
        )
        return self._ocrmypdf(subset, parser_profile=parser_profile, page_numbers=page_numbers)

    def _sidecar(self, source: SourceObject, *, parser_profile: str) -> ParserResult:
        text = self._sidecar_text(source)
        result = parse_text(
            text.encode("utf-8"), parser_name="ocr_sidecar", parser_profile=parser_profile,
        )
        pages_with_text, empty_pages = _text_page_stats(text, pages_processed=result.pages_processed)
        return replace(result, ocr_used=True, metadata=_ocr_metadata(
            parser_engine="ocr_sidecar", text=result.text_length,
            pages_with_text=pages_with_text, empty_pages=empty_pages,
            capabilities=["ocr_text_sidecar"], language=self.settings.ocr_language,
        ))

    def _sidecar_text(self, source: SourceObject) -> str:
        if source.local_path is None:
            raise ParserError("OCR_SIDECAR_UNAVAILABLE", "OCR sidecar requires local object storage")

        candidates = [
            source.local_path.with_suffix(source.local_path.suffix + ".ocr.txt"),
            source.local_path.with_suffix(".ocr.txt"),
        ]
        for candidate in candidates:
            if candidate.exists() and candidate.is_file():
                return candidate.read_text(encoding="utf-8")
        raise ParserError("OCR_SIDECAR_NOT_FOUND", "OCR sidecar text file was not found")

    def _ocrmypdf(self, source: SourceObject, *, parser_profile: str, page_numbers: list[int] | None = None) -> ParserResult:
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
            if page_numbers is not None:
                return _parse_exact_pages(
                    text, page_numbers=page_numbers, parser_name="ocr_ocrmypdf",
                    parser_engine="ocrmypdf", language=self.settings.ocr_language,
                    capabilities=["pdf_ocr", "ocr_text_sidecar", "deskew", "rotate_pages"],
                    parser_profile=parser_profile,
                )
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
        if source.mime_type not in {"image/png", "image/jpeg", "image/webp", "image/tiff", "image/bmp"}:
            raise ParserError("OCR_UNSUPPORTED_MEDIA_TYPE", "Tesseract OCR fallback supports image files only")

        verify_ocr_image(source)

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
            blocks=[replace(block, page_number=None) for block in result.blocks],
            pages_processed=1,
            tables_detected=result.tables_detected,
            ocr_used=True,
            warnings=result.warnings,
            metadata={**_ocr_metadata(
                parser_engine="ocr_tesseract",
                text=result.text_length,
                pages_with_text=pages_with_text,
                empty_pages=empty_pages,
                capabilities=["image_ocr"],
                language=self.settings.ocr_language,
            ), "page_mapping": "image", "requires_review": True},
        )


def verify_ocr_image(source: SourceObject) -> None:
    try:
        from PIL import Image
        with Image.open(BytesIO(source.content)) as image:
            if image.width * image.height > CATALOG["limits"]["image"]["pixels"]:
                raise ParserError("OCR_IMAGE_SIZE_LIMIT", "Image exceeds the OCR pixel budget")
            if getattr(image, "n_frames", 1) > CATALOG["limits"]["image"]["frames"]:
                raise ParserError("OCR_IMAGE_FRAMES_UNSUPPORTED", "Convert a multi-frame image to PDF before intake")
            image.verify()
    except ParserError:
        raise
    except Exception as exc:
        raise ParserError("OCR_IMAGE_INVALID", "Image could not be verified for OCR") from exc


def _is_pdf(source: SourceObject) -> bool:
    return source.mime_type == "application/pdf" or Path(source.filename).suffix.lower() == ".pdf"


def _parse_exact_pages(
    text: str, *, page_numbers: list[int], parser_name: str, parser_engine: str,
    language: str, capabilities: list[str], parser_profile: str,
    selected_pages: list[int] | None = None,
) -> ParserResult:
    pages = text.split("\f")
    # Some engines terminate the last page with a form feed.
    if len(pages) == len(page_numbers) + 1 and not pages[-1].strip():
        pages.pop()
    if len(pages) != len(page_numbers):
        raise ParserError("OCR_PAGE_MAPPING_MISMATCH", "OCR output does not match the requested PDF page count")
    blocks = []
    cursor = 0
    tables_detected = 0
    empty_pages = []
    for page_number, page_text in zip(page_numbers, pages, strict=True):
        if selected_pages is not None and page_number not in selected_pages:
            continue
        page_result = parse_text(page_text.encode("utf-8"), parser_name=parser_name, parser_profile=parser_profile)
        tables_detected += page_result.tables_detected
        if not page_result.blocks:
            empty_pages.append(page_number)
        for block in page_result.blocks:
            blocks.append(replace(
                block, page_number=page_number, char_start=cursor + block.char_start,
                char_end=cursor + block.char_end,
                metadata={**block.metadata, "parser_engine": parser_engine, "extraction_method": "ocr"},
            ))
        cursor += len(page_text) + 1
    pages_processed = len(selected_pages) if selected_pages is not None else len(page_numbers)
    return ParserResult(
        parser_name=parser_name, blocks=blocks, pages_processed=pages_processed,
        tables_detected=tables_detected, ocr_used=True,
        warnings=[] if blocks else [("NO_TEXT_EXTRACTED", "OCR did not extract readable text.")],
        metadata={**_ocr_metadata(
            parser_engine=parser_engine, text=sum(len(block.text) for block in blocks),
            pages_with_text=pages_processed-len(empty_pages), empty_pages=empty_pages,
            capabilities=capabilities, language=language,
        ), "page_mapping": "original_pdf_pages"},
    )


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
