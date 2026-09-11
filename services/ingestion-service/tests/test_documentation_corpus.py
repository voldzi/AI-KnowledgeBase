from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest

from app.config import load_settings
from app.pipeline import _quality_report
from app.schemas import DocumentMetadata
from chunkers.logical import LogicalStructureChunker
from parsers.base import ParsedBlock, ParserError, ParserResult
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


def test_review_quality_tier_always_requires_human_review() -> None:
    parsed = ParserResult(
        parser_name="fixture",
        blocks=[
            ParsedBlock(
                text="x" * 500,
                page_number=1,
                section_path=[],
                section_title=None,
                article_number=None,
                paragraph_number=None,
                char_start=0,
                char_end=500,
            )
        ],
        pages_processed=2,
        metadata={
            "pages_with_text": 1,
            "empty_pages": [2],
            "text_chars_extracted": 500,
        },
    )

    quality = _quality_report(parsed, extraction_profile="document_text_v1")

    assert quality.quality_tier == "review"
    assert quality.requires_review is True


def test_official_law_chunks_group_docling_items_by_section_across_pages() -> None:
    texts = [
        ("§ 4 Účetní období", 1, ["§ 4"], "4", None),
        ("(1) Účetním obdobím je nepřetržitě po sobě jdoucích dvanáct měsíců.", 1, ["§ 4", "Odst. 1"], "4", "1"),
        ("(2) Účetní období se může za stanovených podmínek lišit.", 2, ["§ 4", "Odst. 2"], "4", "2"),
        ("§ 5 Povinnosti účetní jednotky", 2, ["§ 5"], "5", None),
        ("(1) Účetní jednotka vede účetnictví správně a průkazně.", 2, ["§ 5", "Odst. 1"], "5", "1"),
    ]
    blocks = []
    cursor = 0
    for index, (text, page, path, article, paragraph) in enumerate(texts):
        blocks.append(ParsedBlock(
            text=text, page_number=page, section_path=path, section_title=path[0],
            article_number=article, paragraph_number=paragraph,
            char_start=cursor, char_end=cursor + len(text),
            block_type="heading" if paragraph is None else "paragraph",
            metadata={"source_locator": {"kind": "pdf_item", "item": index}},
        ))
        cursor += len(text) + 2

    result = LogicalStructureChunker(_settings()).chunk(
        ParserResult(parser_name="docling", blocks=blocks, pages_processed=2),
        document_metadata=DocumentMetadata(
            document_id="law-563-1991", document_version_id="law-563-1991-current",
            document_type="regulation", status="valid", classification="public",
            tags=["official-public-reference"], title="Zákon o účetnictví",
        ),
        extraction_profile="document_text_v1", parser_profile="controlled_document",
        chunking_strategy="legal_structured",
        source=_source("law.pdf", "application/pdf", b"%PDF-1.7 fixture"),
    )

    assert len(result.chunks) == 2
    assert result.chunks[0].section_path == ["§ 4"]
    assert result.chunks[0].page_number == 1
    assert result.chunks[0].metadata["page_end"] == 2
    assert "dvanáct měsíců" in result.chunks[0].text
    assert "stanovených podmínek" in result.chunks[0].text
    assert result.chunks[1].section_path == ["§ 5"]


def test_czech_section_marker_is_recognized_as_legal_structure() -> None:
    parsed = TextParser().parse(
        _source(
            "law.txt", "text/plain",
            "§ 4 Účetní období\n\n(1) Účetním obdobím je dvanáct měsíců.".encode(),
        ),
        parser_profile="controlled_document",
    )
    assert parsed.blocks[0].section_path == ["§ 4"]
    assert parsed.blocks[0].article_number == "4"
    assert parsed.blocks[1].section_path == ["§ 4", "Odst. 1"]
