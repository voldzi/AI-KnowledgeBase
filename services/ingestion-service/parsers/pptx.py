from __future__ import annotations

import io
import re

from app.object_storage import SourceObject
from parsers.base import DocumentParser, ParsedBlock, ParserError, ParserResult, ParserUnavailable
from parsers.office_limits import OfficeBudget, OfficeLimits

PPTX_MIME_TYPES = {"application/vnd.openxmlformats-officedocument.presentationml.presentation"}


class PptxParser(DocumentParser):
    name = "pptx"

    def __init__(self, limits: OfficeLimits | None = None) -> None:
        self.limits = limits or OfficeLimits()

    def supports(self, source: SourceObject) -> bool:
        return source.mime_type in PPTX_MIME_TYPES or source.filename.lower().endswith(".pptx")

    def parse(self, source: SourceObject, *, parser_profile: str) -> ParserResult:
        try:
            from pptx import Presentation
            from pptx.enum.shapes import MSO_SHAPE_TYPE
        except ImportError as exc:  # pragma: no cover
            raise ParserUnavailable("PPTX_PARSER_UNAVAILABLE", "python-pptx is not installed") from exc

        blocks: list[ParsedBlock] = []
        warnings: list[tuple[str, str]] = []
        tables_detected = 0
        offset = 0
        budget = OfficeBudget(self.limits, "PPTX")

        def append(text: str, block_type: str, title: str, locator: dict, metadata: dict | None = None) -> None:
            nonlocal offset
            budget.add_text(text)
            blocks.append(ParsedBlock(
                text=text, page_number=None, section_path=[f"Snímek {locator['slide_number']}", title],
                section_title=title, article_number=None, paragraph_number=None,
                char_start=offset, char_end=offset + len(text), block_type=block_type,
                metadata={**(metadata or {}), "source_locator": locator},
            ))
            offset += len(text) + 2

        try:
            budget.check_archive(source.content)
            presentation = Presentation(io.BytesIO(source.content))
            if len(presentation.slides) > self.limits.slides:
                budget.fail("slide count")
            for slide_number, slide in enumerate(presentation.slides, start=1):
                budget.check_time()
                title = _slide_title(slide) or f"Snímek {slide_number}"
                for shape in slide.shapes:
                    budget.check_time()
                    locator = {"kind": "slide", "slide_number": slide_number, "shape_id": int(shape.shape_id)}
                    if getattr(shape, "has_table", False):
                        rows: list[str] = []
                        merged = False
                        for row in shape.table.rows:
                            budget.visit_row(len(row.cells))
                            cells = [_clean(cell.text).replace("|", "\\|") for cell in row.cells]
                            # Empty cells preserve column identity, including the
                            # trailing columns and entirely empty interior rows.
                            rows.append(" | ".join(cells))
                            merged = merged or any(cell.is_merge_origin or cell.is_spanned for cell in row.cells)
                        if any(cell.text.strip() for row in shape.table.rows for cell in row.cells):
                            tables_detected += 1
                            locator.update({"row_numbers": list(range(1, len(rows) + 1)), "table_id": int(shape.shape_id)})
                            append("\n".join(rows), "table", title, locator,
                                   {"table_header": rows[0], "table_header_line_count": 1})
                        if merged:
                            warnings.append(("PPTX_MERGED_CELLS_REQUIRE_REVIEW", "Merged table cells require review of their source associations."))
                        continue
                    if getattr(shape, "has_chart", False) or shape.shape_type in {MSO_SHAPE_TYPE.PICTURE, MSO_SHAPE_TYPE.GROUP}:
                        warnings.append(("PPTX_VISUAL_CONTENT_REQUIRES_REVIEW", "Charts, images or grouped shapes require rendered-source review."))
                    if getattr(shape, "has_text_frame", False):
                        text = _clean(shape.text_frame.text)
                        if text:
                            append(text, "heading" if text == title else "paragraph", title, locator)
                notes = _speaker_notes(slide)
                if notes:
                    append(f"Poznámky: {notes}", "paragraph", title,
                           {"kind": "slide", "slide_number": slide_number, "part": "notes"})
        except ParserError:
            raise
        except Exception as exc:
            raise ParserError("PPTX_PARSE_FAILED", f"Presentation could not be read: {exc.__class__.__name__}") from exc

        if not blocks:
            warnings.append(("NO_TEXT_EXTRACTED", "Presentation contains no readable text."))
        return ParserResult(
            parser_name=self.name, blocks=blocks, pages_processed=0, tables_detected=tables_detected,
            warnings=list(dict.fromkeys(warnings)), metadata={
                "page_mapping": "unavailable", "slides_processed": len(presentation.slides),
                "requires_review": bool(warnings), "capabilities": ["non_paginated_text", "slide_citations", "table_rows"],
            },
        )


def _slide_title(slide: object) -> str | None:
    shapes = getattr(slide, "shapes", None)
    title = getattr(shapes, "title", None) if shapes is not None else None
    if title is not None and getattr(title, "has_text_frame", False):
        return _clean(title.text) or None
    return None


def _speaker_notes(slide: object) -> str:
    if not getattr(slide, "has_notes_slide", False):
        return ""
    frame = getattr(slide.notes_slide, "notes_text_frame", None)
    return _clean(frame.text) if frame is not None else ""


def _clean(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()
