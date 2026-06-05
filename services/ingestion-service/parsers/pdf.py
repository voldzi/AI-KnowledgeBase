from __future__ import annotations

from io import BytesIO

from app.object_storage import SourceObject
from parsers.base import DocumentParser, ParsedBlock, ParserResult, ParserUnavailable
from parsers.text import blocks_from_text


class PdfParser(DocumentParser):
    name = "pypdf"

    def supports(self, source: SourceObject) -> bool:
        return source.mime_type == "application/pdf" or source.filename.lower().endswith(".pdf")

    def parse(self, source: SourceObject, *, parser_profile: str) -> ParserResult:
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise ParserUnavailable("PDF_PARSER_UNAVAILABLE", "pypdf is not installed") from exc

        reader = PdfReader(BytesIO(source.content))
        blocks: list[ParsedBlock] = []
        cursor = 0
        warnings: list[tuple[str, str]] = []

        for page_index, page in enumerate(reader.pages, start=1):
            page_text = page.extract_text() or ""
            if not page_text.strip():
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
                        metadata=block.metadata,
                    )
                )
            cursor += len(page_text) + 1

        if not blocks:
            warnings.append(("NO_TEXT_EXTRACTED", "PDF parser did not extract readable text."))

        return ParserResult(
            parser_name=self.name,
            blocks=blocks,
            pages_processed=max(1, len(reader.pages)),
            warnings=warnings,
        )
