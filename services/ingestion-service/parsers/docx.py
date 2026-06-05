from __future__ import annotations

from io import BytesIO

from app.object_storage import SourceObject
from parsers.base import DocumentParser, ParserResult, ParserUnavailable
from parsers.text import parse_text


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
        except ImportError as exc:
            raise ParserUnavailable("DOCX_PARSER_UNAVAILABLE", "python-docx is not installed") from exc

        document = docx.Document(BytesIO(source.content))
        lines: list[str] = []
        tables_detected = len(document.tables)
        for paragraph in document.paragraphs:
            if paragraph.text.strip():
                lines.append(paragraph.text.strip())
        for table in document.tables:
            for row in table.rows:
                cells = [cell.text.strip() for cell in row.cells]
                if any(cells):
                    lines.append(" | ".join(cells))

        result = parse_text("\n\n".join(lines).encode("utf-8"), parser_name=self.name, parser_profile=parser_profile)
        return ParserResult(
            parser_name=result.parser_name,
            blocks=result.blocks,
            pages_processed=1,
            tables_detected=tables_detected,
            warnings=result.warnings,
        )
