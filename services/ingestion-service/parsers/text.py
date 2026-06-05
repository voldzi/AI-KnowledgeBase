from __future__ import annotations

import re

from app.object_storage import SourceObject
from parsers.base import DocumentParser, ParsedBlock, ParserResult

TEXT_MIME_TYPES = {
    "text/plain",
    "text/markdown",
    "text/x-markdown",
    "application/markdown",
}


class TextParser(DocumentParser):
    name = "plain_text"

    def supports(self, source: SourceObject) -> bool:
        filename = source.filename.lower()
        return source.mime_type in TEXT_MIME_TYPES or filename.endswith((".txt", ".md", ".markdown"))

    def parse(self, source: SourceObject, *, parser_profile: str) -> ParserResult:
        return parse_text(source.content, parser_name=self.name, parser_profile=parser_profile)


def parse_text(content: bytes, *, parser_name: str, parser_profile: str) -> ParserResult:
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1", errors="replace")

    blocks = blocks_from_text(text)
    pages = max(1, text.count("\f") + 1)
    warnings = []
    if not blocks:
        warnings.append(("NO_TEXT_EXTRACTED", "Parser did not extract readable text."))

    return ParserResult(
        parser_name=parser_name,
        blocks=blocks,
        pages_processed=pages,
        tables_detected=_estimate_tables(text),
        warnings=warnings,
    )


def blocks_from_text(text: str) -> list[ParsedBlock]:
    blocks: list[ParsedBlock] = []
    section_path: list[str] = []
    section_title: str | None = None
    article_number: str | None = None
    paragraph_number: str | None = None
    current_page = 1

    for match in re.finditer(r"\S(?:.*?)(?=\n\s*\n|\Z)", text, flags=re.DOTALL):
        raw = match.group(0)
        normalized = _clean_block(raw)
        if not normalized:
            continue

        page_number = current_page
        current_page += raw.count("\f")

        heading = _detect_heading(normalized)
        if heading is not None:
            section_title = heading["title"]
            article_number = heading.get("article_number")
            paragraph_number = heading.get("paragraph_number")
            if heading["level"] == "article":
                section_path = [heading["label"]]
            elif heading["level"] == "paragraph":
                section_path = [*section_path[:1], heading["label"]]
            else:
                section_path = [heading["label"]]
            block_type = "heading"
        else:
            paragraph = _detect_paragraph_number(normalized)
            if paragraph:
                paragraph_number = paragraph
                label = f"Odst. {paragraph}"
                section_path = [*section_path[:1], label] if section_path else [label]
            block_type = "paragraph"

        blocks.append(
            ParsedBlock(
                text=normalized,
                page_number=page_number,
                section_path=list(section_path),
                section_title=section_title,
                article_number=article_number,
                paragraph_number=paragraph_number,
                char_start=match.start(),
                char_end=match.end(),
                block_type=block_type,
            )
        )

    return blocks


def _clean_block(value: str) -> str:
    return re.sub(r"[ \t]+", " ", value.replace("\f", "\n")).strip()


def _detect_heading(text: str) -> dict[str, str] | None:
    markdown = re.match(r"^(#{1,6})\s+(.+)$", text)
    if markdown:
        title = markdown.group(2).strip()
        structured = _detect_structured_heading(title)
        if structured is not None:
            return structured
        return {"level": "section", "label": title, "title": title}

    structured = _detect_structured_heading(text)
    if structured is not None:
        return structured

    numbered = re.match(r"^([0-9]+(?:\.[0-9]+)*)[.)]\s+(.{3,160})$", text)
    if numbered:
        label = numbered.group(1)
        title = numbered.group(2).strip()
        return {"level": "section", "label": f"{label} {title}", "title": title}

    return None


def _detect_structured_heading(text: str) -> dict[str, str] | None:
    article = re.match(
        r"^(?:Čl\.|Cl\.|Article|Článek|Clanek)\s+([0-9IVXLCDM]+)\b[.:]?\s*(?:[-–—]\s*)?(.*)$",
        text,
        flags=re.I,
    )
    if article:
        number = article.group(1)
        suffix = article.group(2).strip()
        label = f"Čl. {number}"
        title = suffix or label
        return {
            "level": "article",
            "label": label,
            "title": title,
            "article_number": number,
        }

    paragraph = re.match(r"^(?:Odst\.|Paragraph)\s+([0-9]+)\b[.:]?\s*(.*)$", text, flags=re.I)
    if paragraph:
        number = paragraph.group(1)
        suffix = paragraph.group(2).strip()
        label = f"Odst. {number}"
        return {
            "level": "paragraph",
            "label": label,
            "title": suffix or label,
            "paragraph_number": number,
        }

    return None


def _detect_paragraph_number(text: str) -> str | None:
    match = re.match(r"^\(?([0-9]{1,3})\)?\s+", text)
    return match.group(1) if match else None


def _estimate_tables(text: str) -> int:
    table_like_lines = 0
    for line in text.splitlines():
        if line.count("|") >= 2 or line.count("\t") >= 2:
            table_like_lines += 1
    return table_like_lines // 2
