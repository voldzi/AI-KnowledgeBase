from __future__ import annotations

from markdown_it import MarkdownIt
from mdit_py_plugins.front_matter import front_matter_plugin

from parsers.base import ParsedBlock
from parsers.text import _detect_paragraph_number, _detect_structured_heading


def markdown_blocks(text: str) -> list[ParsedBlock]:
    # Parse structure only. Never execute HTML, fetch links, or promote front
    # matter into Registry publication status or Information Policy.
    parser = MarkdownIt("commonmark", {"html": False}).enable("table").use(front_matter_plugin)
    tokens = parser.parse(text)
    offsets = [0]
    for line in text.splitlines(keepends=True):
        offsets.append(offsets[-1] + len(line))
    headings: list[tuple[int, str]] = []
    article_number: str | None = None
    paragraph_number: str | None = None
    blocks: list[ParsedBlock] = []
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token.type not in {"heading_open", "paragraph_open", "table_open", "fence", "code_block"} or not token.map:
            index += 1
            continue
        start, end = token.map
        char_start, char_end = offsets[start], offsets[end]
        block_type = "paragraph"
        metadata: dict[str, object] = {"source_format": "markdown", "structure_revision": "markdown-1"}
        content = text[char_start:char_end].strip()
        plain_heading = (
            _detect_structured_heading(content)
            if token.type == "paragraph_open" and "\n" not in content
            else None
        )
        if token.type == "heading_open" or plain_heading:
            title = tokens[index + 1].content if token.type == "heading_open" else content
            level = int(token.tag[1:]) if token.type == "heading_open" else (2 if plain_heading["level"] == "paragraph" else 1)
            headings = [(depth, label) for depth, label in headings if depth < level]
            headings.append((level, title))
            content, block_type = title, "heading"
            article_number, paragraph_number = None, None
            for _, label in headings:
                structured = _detect_structured_heading(label)
                if structured and structured["level"] == "article":
                    article_number = structured["article_number"]
                    paragraph_number = None
                elif structured and structured["level"] == "paragraph":
                    paragraph_number = structured["paragraph_number"]
        elif token.type == "table_open":
            block_type = "table"
            metadata.update({"table_header": "\n".join(content.splitlines()[:2]), "table_header_line_count": 2})
            # Keep a whole table, including its column header, as one block.
            # The chunker handles bounded continuation fragments.
            while index < len(tokens) and tokens[index].type != "table_close":
                index += 1
        elif token.type in {"fence", "code_block"}:
            block_type = "code"
        elif token.type == "paragraph_open":
            paragraph_number = _detect_paragraph_number(content) or paragraph_number
        if content:
            blocks.append(ParsedBlock(
                text=content,
                page_number=None,
                section_path=[label for _, label in headings],
                section_title=headings[-1][1] if headings else None,
                article_number=article_number,
                paragraph_number=paragraph_number,
                char_start=char_start,
                char_end=char_end,
                block_type=block_type,
                metadata=metadata,
            ))
        index += 1
    return blocks
