from __future__ import annotations

from io import BytesIO
import re

from app.object_storage import SourceObject
from parsers.base import DocumentParser, ParsedBlock, ParserError, ParserResult, ParserUnavailable
from parsers.text import _detect_heading, _detect_paragraph_number, _detect_structured_heading


class DocxParser(DocumentParser):
    name = "python_docx"

    def supports(self, source: SourceObject) -> bool:
        return (
            source.mime_type
            == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            or source.filename.lower().endswith(".docx")
        )

    def parse(self, source: SourceObject, *, parser_profile: str) -> ParserResult:
        try:
            import docx
            from docx.table import Table
        except ImportError as exc:
            raise ParserUnavailable("DOCX_PARSER_UNAVAILABLE", "python-docx is not installed") from exc

        try:
            document = docx.Document(BytesIO(source.content))
        except Exception as exc:
            raise ParserError("DOCX_PARSE_FAILED", f"Document could not be opened: {exc.__class__.__name__}") from exc
        blocks: list[ParsedBlock] = []
        headings: list[tuple[int, str]] = []
        article_number: str | None = None
        paragraph_number: str | None = None
        offset = 0
        tables_detected = 0
        for item in document.iter_inner_content():
            metadata: dict[str, object] = {"source_format": "docx", "offset_basis": "extracted_text"}
            if isinstance(item, Table):
                rows = [" | ".join(cell.text.strip().replace("\n", " / ") for cell in row.cells) for row in item.rows]
                text = "\n".join(rows)
                if not any(cell.text.strip() for row in item.rows for cell in row.cells):
                    continue
                block_type = "table"
                tables_detected += 1
                metadata.update({"table_header": rows[0], "table_header_line_count": 1})
            else:
                text = item.text.strip()
                if not text:
                    continue
                style_heading = re.fullmatch(r"Heading\s*([1-9])", item.style.name if item.style else "", flags=re.I)
                structured = _detect_heading(text)
                if style_heading or structured:
                    level = int(style_heading.group(1)) if style_heading else (2 if structured["level"] == "paragraph" else 1)
                    headings = [(depth, label) for depth, label in headings if depth < level]
                    headings.append((level, text))
                    article_number, paragraph_number = None, None
                    for _, label in headings:
                        part = _detect_structured_heading(label)
                        if part and part["level"] == "article":
                            article_number, paragraph_number = part["article_number"], None
                        elif part and part["level"] == "paragraph":
                            paragraph_number = part["paragraph_number"]
                    block_type = "heading"
                else:
                    paragraph_number = _detect_paragraph_number(text) or paragraph_number
                    block_type = "paragraph"
            blocks.append(ParsedBlock(
                text=text,
                # Word pagination depends on rendering. Never invent page 1.
                page_number=None,
                section_path=[label for _, label in headings],
                section_title=headings[-1][1] if headings else None,
                article_number=article_number,
                paragraph_number=paragraph_number,
                char_start=offset,
                char_end=offset + len(text),
                block_type=block_type,
                metadata=metadata,
            ))
            offset += len(text) + 2

        warnings = []
        if not blocks:
            warnings.append(("NO_TEXT_EXTRACTED", "Document contains no readable body text."))
        if document.element.xpath(".//w:drawing | .//w:txbxContent"):
            warnings.append(("DOCX_VISUAL_CONTENT_REQUIRES_REVIEW", "Image and text-box content requires rendered-source review."))
        if document.element.xpath(".//w:ins | .//w:del"):
            warnings.append(("DOCX_TRACKED_CHANGES_REQUIRE_REVIEW", "Tracked changes require review of the intended source version."))
        if document.element.xpath(".//w:tbl//w:tbl"):
            warnings.append(("DOCX_NESTED_TABLE_REQUIRES_REVIEW", "Nested tables require rendered-source review."))
        return ParserResult(
            parser_name=self.name,
            blocks=blocks,
            pages_processed=0,
            tables_detected=tables_detected,
            warnings=warnings,
            metadata={
                "requires_review": bool(warnings), "page_mapping": "unavailable",
                "capabilities": ["non_paginated_text", "section_citations"],
            },
        )
