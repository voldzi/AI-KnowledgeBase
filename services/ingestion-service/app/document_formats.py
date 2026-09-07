"""Binding catalog shared with upload validation and the document UI."""
import json
from pathlib import Path

from parsers.base import ParserError

CATALOG = json.loads(Path(__file__).with_name("document-formats.generated.json").read_text())


def format_for_source(filename: str, mime_type: str) -> dict | None:
    extension = Path(filename).suffix.lower()
    for entry in CATALOG["formats"]:
        if extension in entry["extensions"]:
            types = {value.lower() for value in [entry["mime_type"], *entry["mime_aliases"]]}
            if mime_type.lower().split(";", 1)[0].strip() not in types | {"application/octet-stream"}:
                raise ParserError("DOCUMENT_FORMAT_MIME_MISMATCH", "Source MIME and format catalog disagree")
            return entry
    return None


def require_source_format(filename: str, mime_type: str) -> dict:
    entry = format_for_source(filename, mime_type)
    if entry is None or entry["admission"] != "enabled":
        raise ParserError("DOCUMENT_FORMAT_UNAVAILABLE", "Source format has no admitted extraction adapter")
    return entry
