from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.object_storage import SourceObject


class ParserError(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


class ParserUnavailable(ParserError):
    pass


@dataclass(frozen=True)
class ParsedBlock:
    text: str
    page_number: int | None
    section_path: list[str]
    section_title: str | None
    article_number: str | None
    paragraph_number: str | None
    char_start: int
    char_end: int
    block_type: str = "paragraph"
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ParserResult:
    parser_name: str
    blocks: list[ParsedBlock]
    pages_processed: int
    tables_detected: int = 0
    ocr_used: bool = False
    warnings: list[tuple[str, str]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def text_length(self) -> int:
        return sum(len(block.text) for block in self.blocks)


class DocumentParser:
    name = "base"

    def supports(self, source: SourceObject) -> bool:
        raise NotImplementedError

    def parse(self, source: SourceObject, *, parser_profile: str) -> ParserResult:
        raise NotImplementedError
