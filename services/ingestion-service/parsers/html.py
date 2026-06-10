from __future__ import annotations

import re
from html.parser import HTMLParser as StdlibHTMLParser

from app.object_storage import SourceObject
from parsers.base import DocumentParser, ParsedBlock, ParserResult

HTML_MIME_TYPES = {
    "text/html",
    "application/xhtml+xml",
}

_HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
_BLOCK_TAGS = {"p", "li", "td", "th", "caption", "blockquote", "pre", "dd", "dt"}
_SKIP_TAGS = {"script", "style", "noscript", "template", "head"}


class HtmlParser(DocumentParser):
    name = "html"

    def supports(self, source: SourceObject) -> bool:
        filename = source.filename.lower()
        return source.mime_type in HTML_MIME_TYPES or filename.endswith((".html", ".htm", ".xhtml"))

    def parse(self, source: SourceObject, *, parser_profile: str) -> ParserResult:
        try:
            markup = source.content.decode("utf-8")
        except UnicodeDecodeError:
            markup = source.content.decode("latin-1", errors="replace")

        extractor = _BlockExtractor()
        extractor.feed(markup)
        extractor.close()

        blocks = extractor.build_blocks()
        warnings: list[tuple[str, str]] = []
        if not blocks:
            warnings.append(("NO_TEXT_EXTRACTED", "Parser did not extract readable text."))

        return ParserResult(
            parser_name=self.name,
            blocks=blocks,
            pages_processed=1,
            tables_detected=extractor.tables_detected,
            warnings=warnings,
        )


class _BlockExtractor(StdlibHTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._entries: list[tuple[str, str]] = []  # (kind, text); kind = heading level or "paragraph"
        self._buffer: list[str] = []
        self._current_kind = "paragraph"
        self._skip_depth = 0
        self.tables_detected = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIP_TAGS:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        if tag == "table":
            self.tables_detected += 1
        if tag in _HEADING_TAGS or tag in _BLOCK_TAGS:
            self._flush()
            self._current_kind = tag if tag in _HEADING_TAGS else "paragraph"
        elif tag == "br":
            self._buffer.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP_TAGS:
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if self._skip_depth:
            return
        if tag in _HEADING_TAGS or tag in _BLOCK_TAGS:
            self._flush()
            self._current_kind = "paragraph"

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        if data.strip():
            self._buffer.append(data)

    def _flush(self) -> None:
        text = re.sub(r"\s+", " ", "".join(self._buffer)).strip()
        self._buffer = []
        if text:
            self._entries.append((self._current_kind, text))

    def build_blocks(self) -> list[ParsedBlock]:
        self._flush()
        blocks: list[ParsedBlock] = []
        section_path: list[str] = []
        section_title: str | None = None
        offset = 0
        for kind, text in self._entries:
            if kind in _HEADING_TAGS:
                level = int(kind[1])
                section_title = text
                depth = min(level - 1, len(section_path))
                section_path = [*section_path[:depth], text]
                block_type = "heading"
            else:
                block_type = "paragraph"
            blocks.append(
                ParsedBlock(
                    text=text,
                    page_number=1,
                    section_path=list(section_path),
                    section_title=section_title,
                    article_number=None,
                    paragraph_number=None,
                    char_start=offset,
                    char_end=offset + len(text),
                    block_type=block_type,
                )
            )
            offset += len(text) + 2
        return blocks
