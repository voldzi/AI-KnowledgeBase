from __future__ import annotations

from contextlib import redirect_stdout
from io import BytesIO, StringIO
from typing import Any

from app.object_storage import SourceObject
from parsers.base import DocumentParser, ParsedBlock, ParserError, ParserResult, ParserUnavailable
from parsers.text import blocks_from_text


class PdfParser(DocumentParser):
    name = "pdf"

    def __init__(self, *, pdf_engine: str = "auto") -> None:
        self.pdf_engine = pdf_engine

    def supports(self, source: SourceObject) -> bool:
        return source.mime_type == "application/pdf" or source.filename.lower().endswith(".pdf")

    def parse(self, source: SourceObject, *, parser_profile: str) -> ParserResult:
        if self.pdf_engine in {"auto", "pymupdf"}:
            try:
                return self._parse_pymupdf(source, parser_profile=parser_profile)
            except ParserUnavailable as exc:
                if self.pdf_engine == "pymupdf":
                    raise
                fallback = self._parse_pypdf(source, parser_profile=parser_profile)
                return _with_warning(fallback, "PDF_LAYOUT_ENGINE_UNAVAILABLE", exc.message)
            except ParserError:
                if self.pdf_engine == "pymupdf":
                    raise
                fallback = self._parse_pypdf(source, parser_profile=parser_profile)
                return _with_warning(
                    fallback,
                    "PDF_LAYOUT_ENGINE_FAILED",
                    "PyMuPDF layout extraction failed; pypdf fallback was used.",
                )

        return self._parse_pypdf(source, parser_profile=parser_profile)

    def _parse_pymupdf(self, source: SourceObject, *, parser_profile: str) -> ParserResult:
        try:
            import fitz  # PyMuPDF
        except ImportError as exc:
            raise ParserUnavailable("PDF_LAYOUT_ENGINE_UNAVAILABLE", "PyMuPDF is not installed") from exc

        try:
            document = fitz.open(stream=source.content, filetype="pdf")
        except Exception as exc:
            raise ParserError("PDF_LAYOUT_PARSE_FAILED", "PyMuPDF could not open the PDF") from exc

        blocks: list[ParsedBlock] = []
        warnings: list[tuple[str, str]] = []
        empty_pages: list[int] = []
        cursor = 0
        tables_detected = 0
        layout_blocks = 0
        page_count = len(document)

        try:
            for page_index, page in enumerate(document, start=1):
                page_blocks: list[str] = []
                for raw_block in _page_text_blocks(page):
                    text = str(raw_block.get("text") or "").strip()
                    if not text:
                        continue
                    page_blocks.append(text)
                    layout_blocks += 1
                    for block in blocks_from_text(text):
                        parsed = _parsed_block(
                            block,
                            cursor=cursor,
                            page_number=page_index,
                            metadata={
                                "parser_engine": "pymupdf",
                                "bbox": raw_block.get("bbox"),
                                "layout_block_index": raw_block.get("block_index"),
                            },
                        )
                        blocks.append(parsed)
                    cursor += len(text) + 1

                extracted_tables = _page_tables(page)
                tables_detected += len(extracted_tables)
                page_text = "\n".join(page_blocks)
                for table_index, table_text in enumerate(extracted_tables, start=1):
                    if not table_text.strip() or _compact(table_text) in _compact(page_text):
                        continue
                    for block in blocks_from_text(table_text):
                        parsed = _parsed_block(
                            block,
                            cursor=cursor,
                            page_number=page_index,
                            block_type="table",
                            metadata={
                                "parser_engine": "pymupdf",
                                "table_index": table_index,
                            },
                        )
                        blocks.append(parsed)
                    cursor += len(table_text) + 1

                if page_blocks or extracted_tables:
                    continue
                empty_pages.append(page_index)
        finally:
            document.close()

        if not blocks:
            warnings.append(("NO_TEXT_EXTRACTED", "PDF parser did not extract readable text."))

        return ParserResult(
            parser_name="pymupdf",
            blocks=blocks,
            pages_processed=max(1, page_count),
            tables_detected=tables_detected,
            warnings=warnings,
            metadata={
                "parser_engine": "pymupdf",
                "pages_with_text": len({block.page_number for block in blocks if block.page_number}),
                "empty_pages": empty_pages,
                "text_chars_extracted": sum(len(block.text) for block in blocks),
                "layout_blocks": layout_blocks,
                "capabilities": ["text_blocks", "bounding_boxes", "table_detection"],
            },
        )

    def _parse_pypdf(self, source: SourceObject, *, parser_profile: str) -> ParserResult:
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise ParserUnavailable("PDF_PARSER_UNAVAILABLE", "pypdf is not installed") from exc

        reader = PdfReader(BytesIO(source.content))
        blocks: list[ParsedBlock] = []
        cursor = 0
        warnings: list[tuple[str, str]] = []
        empty_pages: list[int] = []

        for page_index, page in enumerate(reader.pages, start=1):
            page_text = page.extract_text() or ""
            if not page_text.strip():
                empty_pages.append(page_index)
                continue
            for block in blocks_from_text(page_text):
                text_length = block.char_end - block.char_start
                blocks.append(
                    ParsedBlock(
                        text=block.text,
                        page_number=page_index,
                        section_path=block.section_path,
                        section_title=block.section_title,
                        article_number=block.article_number,
                        paragraph_number=block.paragraph_number,
                        char_start=cursor + block.char_start,
                        char_end=cursor + block.char_start + text_length,
                        block_type=block.block_type,
                        metadata={**block.metadata, "parser_engine": "pypdf"},
                    )
                )
            cursor += len(page_text) + 1

        if not blocks:
            warnings.append(("NO_TEXT_EXTRACTED", "PDF parser did not extract readable text."))

        return ParserResult(
            parser_name="pypdf",
            blocks=blocks,
            pages_processed=max(1, len(reader.pages)),
            warnings=warnings,
            metadata={
                "parser_engine": "pypdf",
                "pages_with_text": len({block.page_number for block in blocks if block.page_number}),
                "empty_pages": empty_pages,
                "text_chars_extracted": sum(len(block.text) for block in blocks),
                "capabilities": ["text"],
            },
        )


def _page_text_blocks(page: Any) -> list[dict[str, Any]]:
    try:
        raw_blocks = page.get_text("blocks", sort=True)
    except TypeError:
        raw_blocks = page.get_text("blocks")
    except Exception as exc:
        raise ParserError("PDF_LAYOUT_TEXT_FAILED", "PyMuPDF could not extract page text blocks") from exc

    parsed: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_blocks):
        if len(raw) < 5:
            continue
        block_type = raw[6] if len(raw) > 6 else 0
        if block_type not in {0, "text"}:
            continue
        parsed.append(
            {
                "bbox": [float(raw[0]), float(raw[1]), float(raw[2]), float(raw[3])],
                "text": raw[4],
                "block_index": index,
            }
        )
    return parsed


def _page_tables(page: Any) -> list[str]:
    finder = getattr(page, "find_tables", None)
    if not callable(finder):
        return []
    try:
        with redirect_stdout(StringIO()):
            table_finder = finder()
    except Exception:
        return []
    tables = getattr(table_finder, "tables", None) or []
    extracted: list[str] = []
    for table in tables:
        try:
            rows = table.extract()
        except Exception:
            continue
        lines = []
        for row in rows or []:
            cells = [str(cell or "").strip() for cell in row]
            line = " | ".join(cell for cell in cells if cell)
            if line:
                lines.append(line)
        if lines:
            extracted.append("\n".join(lines))
    return extracted


def _parsed_block(
    block: ParsedBlock,
    *,
    cursor: int,
    page_number: int,
    metadata: dict[str, Any],
    block_type: str | None = None,
) -> ParsedBlock:
    text_length = block.char_end - block.char_start
    return ParsedBlock(
        text=block.text,
        page_number=page_number,
        section_path=block.section_path,
        section_title=block.section_title,
        article_number=block.article_number,
        paragraph_number=block.paragraph_number,
        char_start=cursor + block.char_start,
        char_end=cursor + block.char_start + text_length,
        block_type=block_type or block.block_type,
        metadata={**block.metadata, **metadata},
    )


def _with_warning(result: ParserResult, code: str, message: str) -> ParserResult:
    return ParserResult(
        parser_name=result.parser_name,
        blocks=result.blocks,
        pages_processed=result.pages_processed,
        tables_detected=result.tables_detected,
        ocr_used=result.ocr_used,
        warnings=[*result.warnings, (code, message)],
        metadata=result.metadata,
    )


def _compact(value: str) -> str:
    return " ".join(value.split()).lower()
