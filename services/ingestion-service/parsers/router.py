from __future__ import annotations

from app.config import Settings
from app.object_storage import SourceObject
from parsers.base import DocumentParser, ParserError, ParserResult
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

    def parse(self, source: SourceObject, *, parser_profile: str, ocr_enabled: bool) -> ParserResult:
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
        return ParserResult(
            parser_name=ocr_result.parser_name,
            blocks=ocr_result.blocks,
            pages_processed=ocr_result.pages_processed,
            tables_detected=ocr_result.tables_detected,
            ocr_used=True,
            warnings=warnings,
        )

    def _parser_for(self, source: SourceObject) -> DocumentParser:
        for parser in self.parsers:
            if parser.supports(source):
                return parser
        raise ParserError("UNSUPPORTED_FILE_TYPE", "No parser supports the source file type")
