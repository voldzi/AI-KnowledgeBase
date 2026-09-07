"""Bounded native Office extraction; limit failures never return partial content."""

from __future__ import annotations

import io
import time
import zipfile
from dataclasses import dataclass

from app.document_formats import CATALOG
from parsers.base import ParserError

_LIMITS = CATALOG["limits"]["office"]


@dataclass(frozen=True)
class OfficeLimits:
    zip_entries: int = _LIMITS["zip_entries"]
    zip_expanded_bytes: int = _LIMITS["zip_total_bytes"]
    zip_entry_bytes: int = _LIMITS["zip_entry_bytes"]
    rows: int = _LIMITS["visited_rows"]
    columns: int = _LIMITS["columns"]
    cells: int = _LIMITS["cells"]
    text_chars: int = _LIMITS["extracted_chars"]
    slides: int = _LIMITS["slides"]
    seconds: float = _LIMITS["seconds"]


class OfficeBudget:
    def __init__(self, limits: OfficeLimits, kind: str) -> None:
        self.limits = limits
        self.kind = kind
        self.started = time.monotonic()
        self.rows = self.cells = self.text_chars = 0

    def fail(self, reason: str) -> None:
        raise ParserError(f"{self.kind}_PROCESSING_LIMIT", f"Office extraction exceeded its {reason} limit; no partial result was accepted.")

    def check_time(self) -> None:
        if time.monotonic() - self.started > self.limits.seconds:
            self.fail("processing time")

    def check_archive(self, content: bytes) -> None:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            entries = archive.infolist()
            if len(entries) > self.limits.zip_entries:
                self.fail("archive entry count")
            if sum(item.file_size for item in entries) > self.limits.zip_expanded_bytes:
                self.fail("expanded archive size")
            if any(item.file_size > self.limits.zip_entry_bytes for item in entries):
                self.fail("expanded archive member size")
            if any(item.flag_bits & 1 for item in entries):
                raise ParserError(f"{self.kind}_ENCRYPTED_ARCHIVE", "Encrypted Office archives are not supported.")
        self.check_time()

    def visit_row(self, columns: int) -> None:
        self.check_time()
        self.rows += 1
        self.cells += columns
        if self.rows > self.limits.rows:
            self.fail("visited row count")
        if columns > self.limits.columns:
            self.fail("column count")
        if self.cells > self.limits.cells:
            self.fail("visited cell count")

    def add_text(self, text: str) -> None:
        self.check_time()
        self.text_chars += len(text)
        if self.text_chars > self.limits.text_chars:
            self.fail("extracted text size")
