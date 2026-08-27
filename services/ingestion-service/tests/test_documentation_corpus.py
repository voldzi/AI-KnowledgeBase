from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest

from app.config import load_settings
from app.pipeline import _quality_report
from app.schemas import DocumentMetadata
from chunkers.logical import LogicalStructureChunker
from parsers.base import ParserError
from parsers.text import TextParser
from tests.test_format_parsers import _source

ROOT = Path(__file__).resolve().parents[3]
INVENTORY = json.loads((ROOT / "docs/handover/akb-stratos-dokumentacni-sada.json").read_text(encoding="utf-8"))


def _settings():
    return load_settings({"AKL_ENV": "test", "AKL_AUTH_MODE": "disabled", "AKL_INGESTION_DEPENDENCY_MODE": "mock"})


@pytest.mark.parametrize("item", INVENTORY["documents"], ids=lambda item: item["external_ref"])
def test_handover_source_is_citable_and_front_matter_cannot_publish_it(item) -> None:
    path = ROOT / item["path"]
    source = _source(path.name, "text/markdown", path.read_bytes())
    parsed = TextParser().parse(source, parser_profile="default")
    quality = _quality_report(parsed, extraction_profile="document_text_v1")
    assert quality.quality_tier == "good"
    assert quality.requires_review is False
    assert quality.pages_processed == quality.pages_with_text == 0
    settings = _settings()
    result = LogicalStructureChunker(settings).chunk(
        parsed,
        document_metadata=DocumentMetadata(
            document_id="fixture-manual", document_version_id="fixture-v1", status="draft",
            classification="internal", access_scope=["test:recipient"], title="Fixture source",
        ),
        extraction_profile="document_text_v1", parser_profile="default", chunking_strategy="logical", source=source,
    )
    assert result.chunks
    assert result.warnings == []
    assert all(chunk.document_version_id == "fixture-v1" for chunk in result.chunks)
    assert all(chunk.status == "draft" and chunk.access_scope == ["test:recipient"] for chunk in result.chunks)
    assert all(chunk.page_number is None for chunk in result.chunks)
    assert all(chunk.source_sha256 == source.sha256 for chunk in result.chunks)
    assert all(0 <= chunk.char_start < chunk.char_end <= len(path.read_text(encoding="utf-8")) for chunk in result.chunks)
    assert all(len(chunk.text) <= settings.max_chunk_chars for chunk in result.chunks)
    assert all("publication_status:" not in chunk.text for chunk in result.chunks)
    assert any(chunk.section_path for chunk in result.chunks)


def test_long_markdown_table_keeps_headers_and_each_complete_row() -> None:
    text = "# Sizing\n\n| Service | Minimum | Proposed |\n| --- | --- | --- |\n" + "".join(
        f"| service-{index:02d} | not measured | {index + 1} GB |\n" for index in range(30)
    )
    parsed = TextParser().parse(_source("table.md", "text/markdown", text.encode()), parser_profile="default")
    table = next(block for block in parsed.blocks if block.block_type == "table")
    chunker = LogicalStructureChunker(replace(_settings(), chunk_target_chars=200, max_chunk_chars=300, chunk_overlap_chars=20))
    pieces = chunker._split_large_block(table)
    assert len(pieces) > 1
    for piece in pieces:
        assert piece.text.startswith("| Service | Minimum | Proposed |\n| --- | --- | --- |\n")
        assert piece.section_path == ["Sizing"]
        assert len(piece.text) <= 300
        assert piece.char_end <= len(text)
    rows = [line for piece in pieces for line in piece.text.splitlines()[2:]]
    assert rows == text.splitlines()[4:]


def test_table_row_is_not_silently_truncated_to_fit_a_chunk() -> None:
    text = "| Name | Description |\n| --- | --- |\n| A | " + "x" * 400 + " |\n"
    parsed = TextParser().parse(_source("wide.md", "text/markdown", text.encode()), parser_profile="default")
    chunker = LogicalStructureChunker(replace(_settings(), chunk_target_chars=200, max_chunk_chars=300))
    with pytest.raises(ParserError) as failure:
        chunker._split_large_block(parsed.blocks[0])
    assert failure.value.code == "TABLE_ROW_EXCEEDS_CHUNK_LIMIT"


def test_empty_non_paginated_document_is_not_rated_as_good() -> None:
    parsed = TextParser().parse(_source("empty.md", "text/markdown", b"---\nstatus: valid\n---\n"), parser_profile="default")
    quality = _quality_report(parsed, extraction_profile="document_text_v1")
    assert quality.quality_tier == "poor"
    assert quality.requires_review is True
