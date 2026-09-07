from __future__ import annotations

from dataclasses import replace

from app.config import Settings
from app.document_formats import require_source_format
from app.object_storage import SourceObject
from parsers.base import DocumentParser, ParserError, ParserResult
from parsers.docling import DoclingParser, result_with_metadata, shadow_summary
from parsers.docx import DocxParser
from parsers.html import HtmlParser
from parsers.ocr import OcrProvider, verify_ocr_image
from parsers.pdf import PdfParser
from parsers.pptx import PptxParser
from parsers.text import TextParser
from parsers.xlsx import XlsxParser


class ParserRouter:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.parsers: list[DocumentParser] = [
            HtmlParser(),
            XlsxParser(),
            PptxParser(),
            TextParser(),
            PdfParser(pdf_engine=settings.pdf_engine),
            DocxParser(),
        ]
        self.ocr_provider = OcrProvider(settings)
        self.docling_parser = DoclingParser(settings)

    def parse(self, source: SourceObject, *, parser_profile: str, ocr_enabled: bool) -> ParserResult:
        source_format = require_source_format(source.filename, source.mime_type)
        source = replace(source, mime_type=source_format["mime_type"])
        if source_format["parser"] == "image_ocr":
            verify_ocr_image(source)
        mode = self.settings.docling_mode
        if mode == "off" or not self.docling_parser.supports(source):
            return self._parse_native(
                source,
                parser_profile=parser_profile,
                ocr_enabled=ocr_enabled,
            )

        if mode == "enforce":
            return self.docling_parser.parse(
                source,
                parser_profile=parser_profile,
                ocr_enabled=ocr_enabled,
            )

        if mode == "shadow":
            authoritative = self._parse_native(
                source,
                parser_profile=parser_profile,
                ocr_enabled=ocr_enabled,
            )
            try:
                candidate = self.docling_parser.parse(
                    source,
                    parser_profile=parser_profile,
                    ocr_enabled=ocr_enabled,
                )
            except ParserError as exc:
                return result_with_metadata(
                    authoritative,
                    metadata={
                        "docling_shadow": {
                            "status": "failed",
                            "error_code": exc.code,
                        }
                    },
                )
            return result_with_metadata(
                authoritative,
                metadata={"docling_shadow": shadow_summary(authoritative, candidate)},
            )

        try:
            candidate = self.docling_parser.parse(
                source,
                parser_profile=parser_profile,
                ocr_enabled=ocr_enabled,
            )
        except ParserError as exc:
            fallback = self._parse_native(
                source,
                parser_profile=parser_profile,
                ocr_enabled=ocr_enabled,
            )
            return result_with_metadata(
                fallback,
                metadata={
                    "docling_preferred": {
                        "status": "failed",
                        "error_code": exc.code,
                    }
                },
                warning=(
                    "DOCLING_PREFERRED_FALLBACK",
                    "Docling was unavailable; the governed native parser was used.",
                ),
            )

        if candidate.text_length >= self.settings.min_extracted_chars_before_ocr:
            return candidate

        fallback = self._parse_native(
            source,
            parser_profile=parser_profile,
            ocr_enabled=ocr_enabled,
        )
        if fallback.text_length <= candidate.text_length:
            return candidate
        return result_with_metadata(
            fallback,
            metadata={"docling_preferred": shadow_summary(fallback, candidate)},
            warning=(
                "DOCLING_LOW_TEXT_FALLBACK",
                "Docling extracted less usable text; the governed native parser was used.",
            ),
        )

    def readiness(self) -> str:
        return self.docling_parser.readiness()

    def _parse_native(
        self,
        source: SourceObject,
        *,
        parser_profile: str,
        ocr_enabled: bool,
    ) -> ParserResult:
        source_format = require_source_format(source.filename, source.mime_type)
        if source_format["parser"] == "image_ocr":
            if not ocr_enabled:
                raise ParserError("OCR_DISABLED", "Image intake requires OCR or an approved alternative extraction")
            return self.ocr_provider.extract(source, parser_profile=parser_profile)
        parse_error: ParserError | None = None
        result: ParserResult | None = None

        try:
            parser = self._parser_for(source)
            result = parser.parse(source, parser_profile=parser_profile)
        except ParserError as exc:
            if exc.code.endswith(("_PROCESSING_LIMIT", "_ENCRYPTED_ARCHIVE")):
                raise
            parse_error = exc

        if result is not None and PdfParser().supports(source):
            native_pages = {block.page_number for block in result.blocks if block.text.strip()}
            missing_pages = sorted(set(range(1, result.pages_processed + 1)) - native_pages)
            if missing_pages:
                return self._complete_pdf_pages(
                    source, native=result, missing_pages=missing_pages,
                    parser_profile=parser_profile, ocr_enabled=ocr_enabled,
                )

        if result is not None and result.text_length >= self.settings.min_extracted_chars_before_ocr:
            return result

        if not ocr_enabled:
            if result is not None:
                return result
            raise parse_error or ParserError("PARSER_FAILED", "Parser failed")

        try:
            ocr_result = self.ocr_provider.extract(source, parser_profile=parser_profile)
        except ParserError as ocr_error:
            if result is not None:
                warnings = [
                    *result.warnings,
                    (ocr_error.code, ocr_error.message),
                ]
                return ParserResult(
                    parser_name=result.parser_name,
                    blocks=result.blocks,
                    pages_processed=result.pages_processed,
                    tables_detected=result.tables_detected,
                    ocr_used=False,
                    warnings=warnings,
                    metadata=result.metadata,
                )
            if parse_error is not None:
                raise ParserError(
                    parse_error.code,
                    f"{parse_error.message}; OCR fallback failed: {ocr_error.message}",
                ) from ocr_error
            raise

        warnings = []
        if result is not None:
            warnings.extend(result.warnings)
        if parse_error is not None:
            warnings.append((parse_error.code, parse_error.message))
        warnings.extend(ocr_result.warnings)
        metadata = dict(ocr_result.metadata)
        if result is not None:
            metadata["ocr_fallback_from_parser"] = result.parser_name
            metadata["ocr_fallback_native_text_chars"] = result.text_length
            metadata["ocr_fallback_native_pages"] = result.pages_processed
        return ParserResult(
            parser_name=ocr_result.parser_name,
            blocks=ocr_result.blocks,
            pages_processed=ocr_result.pages_processed,
            tables_detected=ocr_result.tables_detected,
            ocr_used=True,
            warnings=warnings,
            metadata=metadata,
        )

    def _complete_pdf_pages(
        self, source: SourceObject, *, native: ParserResult, missing_pages: list[int],
        parser_profile: str, ocr_enabled: bool,
    ) -> ParserResult:
        """Native text on one page cannot hide missing text on another page."""
        ocr_result = None
        warnings = list(native.warnings)
        try:
            if not ocr_enabled:
                raise ParserError("OCR_DISABLED", "PDF pages without native text require OCR or review")
            ocr_result = self.ocr_provider.extract_pdf_pages(
                source, parser_profile=parser_profile, page_numbers=missing_pages,
                total_pages=native.pages_processed,
            )
        except ParserError as exc:
            warnings.append((exc.code, exc.message))

        ocr_blocks = ocr_result.blocks if ocr_result is not None else []
        completed_pages = {block.page_number for block in ocr_blocks if block.text.strip()}
        pending_pages = sorted(set(missing_pages) - completed_pages)
        if pending_pages:
            warnings.append(("PDF_PAGES_REQUIRE_REVIEW", "Some PDF pages have no verified text extraction; review the source pages"))
        if ocr_result is not None:
            warnings.extend(ocr_result.warnings)

        # Page sets are disjoint. Keep native layout blocks untouched in content;
        # never append a whole-document OCR transcript to the native transcript.
        blocks = []
        cursor = 0
        for block in sorted([*native.blocks, *ocr_blocks], key=lambda item: item.page_number or 0):
            blocks.append(replace(block, char_start=cursor, char_end=cursor + len(block.text)))
            cursor += len(block.text) + 1
        has_native = bool(native.blocks)
        parser_name = native.parser_name if ocr_result is None else (
            f"{native.parser_name}+{ocr_result.parser_name}" if has_native else ocr_result.parser_name
        )
        metadata = {
            **native.metadata,
            **(ocr_result.metadata if ocr_result is not None and not has_native else {}),
            "page_mapping": "original_pdf_pages",
            "pages_with_text": len({block.page_number for block in blocks if block.text.strip()}),
            "empty_pages": pending_pages,
            "text_chars_extracted": sum(len(block.text) for block in blocks),
            "ocr_pages_requested": missing_pages,
            "ocr_pages_completed": sorted(completed_pages),
            "requires_review": bool(pending_pages) or native.metadata.get("requires_review") is True,
        }
        if ocr_result is not None:
            metadata.update({
                "ocr_engine": ocr_result.metadata.get("parser_engine"),
                "ocr_language": ocr_result.metadata.get("ocr_language"),
                "capabilities": sorted(set(native.metadata.get("capabilities", [])) | set(ocr_result.metadata.get("capabilities", []))),
            })
        return ParserResult(
            parser_name=parser_name, blocks=blocks, pages_processed=native.pages_processed,
            tables_detected=native.tables_detected + (ocr_result.tables_detected if ocr_result is not None else 0),
            ocr_used=ocr_result is not None,
            warnings=warnings, metadata=metadata,
        )

    def _parser_for(self, source: SourceObject) -> DocumentParser:
        for parser in self.parsers:
            if parser.supports(source):
                return parser
        raise ParserError("UNSUPPORTED_FILE_TYPE", "No parser supports the source file type")
