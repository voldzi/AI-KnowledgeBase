from __future__ import annotations

from pathlib import Path

from parsers.text import TextParser
from tests.test_format_parsers import _source


def _parse(text: str):
    return TextParser().parse(_source("manual.md", "text/markdown", text.encode("utf-8")), parser_profile="default")

def test_markdown_preserves_nested_headings_without_blank_lines_and_table_coordinates() -> None:
    text = "# AKB\nOverview.\n## Installation\nInternal network.\n### Capacity\n\n| Service | RAM |\n| --- | --- |\n| Web | 4 GB |\n\n## Recovery\nRestore from backup.\n"
    result = _parse(text)
    capacity = next(block for block in result.blocks if block.block_type == "table")
    assert capacity.section_path == ["AKB", "Installation", "Capacity"]
    assert capacity.text == text[capacity.char_start:capacity.char_end].strip()
    assert "| Service | RAM |" in capacity.text
    assert "| Web | 4 GB |" in capacity.text
    assert capacity.page_number is None
    recovery = next(block for block in result.blocks if "Restore from backup." in block.text)
    assert recovery.section_path == ["AKB", "Recovery"]
    assert result.tables_detected == 1


def test_front_matter_is_not_evidence_or_authorization_and_fences_are_data() -> None:
    result = _parse("---\nstatus: published\nclassification: public\n---\n# Guide\nUse the documented procedure.\n\n```yaml\nstatus: published\n```\n")
    assert all("classification: public" not in block.text for block in result.blocks)
    assert all("status" not in block.metadata for block in result.blocks)
    code = next(block for block in result.blocks if block.block_type == "code")
    assert "status: published" in code.text
    assert code.section_path == ["Guide"]


def test_setext_heading_and_crlf_keep_source_offsets() -> None:
    text = "Manual\r\n======\r\n\r\n## Network\r\nOnly internal HTTPS.\r\n"
    result = _parse(text)
    paragraph = next(block for block in result.blocks if "Only internal" in block.text)
    assert paragraph.section_path == ["Manual", "Network"]
    assert paragraph.text == text[paragraph.char_start:paragraph.char_end].strip()


def test_structured_article_and_paragraph_citations_survive_markdown_parsing() -> None:
    result = _parse("# Pravidla\n## Čl. 1 Provoz\n### Odst. 2\nPovinnost správce.\n## Čl. 2 Obnova\n(1) Obnovte zálohu.\n## Přílohy\nSeznam příloh.\n")
    obligation = next(block for block in result.blocks if "Povinnost" in block.text)
    assert obligation.article_number == "1"
    assert obligation.paragraph_number == "2"
    recovery = next(block for block in result.blocks if "Obnovte" in block.text)
    assert recovery.article_number == "2"
    assert recovery.paragraph_number == "1"
    attachment = next(block for block in result.blocks if "Seznam" in block.text)
    assert attachment.article_number is None
    assert attachment.paragraph_number is None


def test_real_handover_infrastructure_document_retains_tables_and_caveats() -> None:
    path = Path(__file__).resolve().parents[3] / "docs/deployment/akb-stratos-instalace-infrastruktura-pilotu-csu-cs.md"
    result = _parse(path.read_text(encoding="utf-8"))
    assert result.tables_detected >= 1
    assert all(not block.text.startswith("document_id:") for block in result.blocks)
    text = "\n".join(block.text for block in result.blocks)
    assert "32" in text and "443" in text
    assert "návrh" in text.lower()
    assert any(len(block.section_path) > 1 for block in result.blocks)


def test_plain_legal_headings_in_markdown_remain_citable() -> None:
    result = _parse("Article 4 Operation\n\nOdst. 2\n\nThe operator follows the approved procedure.\n")
    paragraph = next(block for block in result.blocks if "operator" in block.text)
    assert paragraph.article_number == "4"
    assert paragraph.paragraph_number == "2"
