from __future__ import annotations

import io
import re
import zipfile
from xml.etree.ElementTree import iterparse

from app.object_storage import SourceObject
from parsers.base import DocumentParser, ParsedBlock, ParserError, ParserResult, ParserUnavailable
from parsers.office_limits import OfficeBudget, OfficeLimits

XLSX_MIME_TYPES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel.sheet.macroEnabled.12",
}
MAX_ROWS_PER_BLOCK = 40


class XlsxParser(DocumentParser):
    name = "xlsx"

    def __init__(self, limits: OfficeLimits | None = None) -> None:
        self.limits = limits or OfficeLimits()

    def supports(self, source: SourceObject) -> bool:
        return source.mime_type in XLSX_MIME_TYPES or source.filename.lower().endswith((".xlsx", ".xlsm"))

    def parse(self, source: SourceObject, *, parser_profile: str) -> ParserResult:
        try:
            from openpyxl import load_workbook
            from openpyxl.utils import get_column_letter
        except ImportError as exc:  # pragma: no cover
            raise ParserUnavailable("XLSX_PARSER_UNAVAILABLE", "openpyxl is not installed") from exc

        budget = OfficeBudget(self.limits, "XLSX")
        workbook = None
        blocks: list[ParsedBlock] = []
        offset = 0
        tables_detected = 0
        warnings: list[tuple[str, str]] = []
        try:
            budget.check_archive(source.content)
            warnings = _review_warnings(source.content, budget)
            workbook = load_workbook(io.BytesIO(source.content), read_only=True, data_only=True, keep_links=False)
            for sheet in workbook.worksheets:
                # Dimensions in producer XML can be stale or malicious. Read the
                # actual stream; the budget, not a blank streak, bounds work.
                sheet.reset_dimensions()
                header: tuple[int, list[str]] | None = None
                pending: list[tuple[int, list[str]]] = []

                def flush() -> None:
                    nonlocal offset, pending
                    if not pending or header is None:
                        return
                    rows = pending if pending[0][0] == header[0] else [header, *pending]
                    width = max(len(cells) for _, cells in rows)
                    lines = [" | ".join([*cells, *([""] * (width - len(cells)))]) for _, cells in rows]
                    text = "\n".join(lines)
                    budget.add_text(text)
                    locator = {
                        "kind": "sheet", "sheet_name": sheet.title,
                        "row_numbers": [number for number, _ in rows],
                        "column_name": "A", "column_end": get_column_letter(width),
                    }
                    blocks.append(ParsedBlock(
                        text=text, page_number=None, section_path=[sheet.title], section_title=sheet.title,
                        article_number=None, paragraph_number=None,
                        char_start=offset, char_end=offset + len(text), block_type="table",
                        metadata={"source_locator": locator, "table_header": lines[0],
                                  "table_header_line_count": 1, "table_header_repeated": rows[0] != pending[0]},
                    ))
                    offset += len(text) + 2
                    pending = []

                for row_number, row in enumerate(sheet.iter_rows(values_only=True), start=1):
                    budget.visit_row(len(row))
                    cells = [_cell_text(value) for value in row]
                    if not any(cells):
                        continue
                    if header is None:
                        header = (row_number, cells)
                        tables_detected += 1
                    pending.append((row_number, cells))
                    if len(pending) >= MAX_ROWS_PER_BLOCK:
                        flush()
                flush()
        except ParserError:
            raise
        except Exception as exc:
            raise ParserError("XLSX_PARSE_FAILED", f"Workbook could not be read: {exc.__class__.__name__}") from exc
        finally:
            if workbook is not None:
                workbook.close()

        if not blocks:
            warnings.append(("NO_TEXT_EXTRACTED", "Workbook contains no readable cached cell values."))
        return ParserResult(
            parser_name=self.name, blocks=blocks, pages_processed=0, tables_detected=tables_detected,
            warnings=warnings, metadata={"page_mapping": "unavailable", "sheets_processed": len(workbook.worksheets),
                                        "requires_review": bool(warnings),
                                        "capabilities": ["non_paginated_text", "sheet_row_citations", "cached_cell_values"]},
        )


def _cell_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    # One source row is one rendered line, including embedded cell newlines.
    return re.sub(r"\s+", " ", str(value)).strip().replace("|", "\\|")


def _review_warnings(content: bytes, budget: OfficeBudget) -> list[tuple[str, str]]:
    """Cached values are useful evidence, never a formula recalculation claim."""
    found: set[str] = set()
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        for name in archive.namelist():
            if not name.startswith("xl/worksheets/") or not name.endswith(".xml"):
                continue
            with archive.open(name) as stream:
                for _, element in iterparse(stream, events=("end",)):
                    budget.check_time()
                    tag = element.tag.rsplit("}", 1)[-1]
                    if tag in {"f", "mergeCell", "drawing"}:
                        found.add(tag)
                    element.clear()
    messages = {
        "f": ("XLSX_FORMULAS_REQUIRE_REVIEW", "Only stored cached formula values are extracted; missing caches and recalculation require source review."),
        "mergeCell": ("XLSX_MERGED_CELLS_REQUIRE_REVIEW", "Merged cell associations require review in the original worksheet."),
        "drawing": ("XLSX_VISUAL_CONTENT_REQUIRES_REVIEW", "Worksheet images and charts require rendered-source review."),
    }
    return [messages[tag] for tag in sorted(found)]
