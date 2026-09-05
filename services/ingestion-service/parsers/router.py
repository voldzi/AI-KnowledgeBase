from __future__ import annotations

from app.config import Settings
from app.object_storage import SourceObject
from parsers.base import DocumentParser, ParserError, ParserResult
from parsers.docling import DoclingParser, result_with_metadata, shadow_summary
from parsers.docx import DocxParser
from parsers.html import HtmlParser
from parsers.ocr import OcrProvider
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
        parse_error: ParserError | None = None
        result: ParserResult | None = None

        try:
            parser = self._parser_for(source)
            result = parser.parse(source, parser_profile=parser_profile)
        except ParserError as exc:
            parse_error = exc

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

    def _parser_for(self, source: SourceObject) -> DocumentParser:
        for parser in self.parsers:
            if parser.supports(source):
                return parser
        raise ParserError("UNSUPPORTED_FILE_TYPE", "No parser supports the source file type")
