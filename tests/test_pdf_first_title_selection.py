from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_tool(name: str):
    path = ROOT / "tools" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


reset_pdf_first_corpus = load_tool("reset_pdf_first_corpus")
prepare_public_pdf_corpus = load_tool("prepare_public_pdf_corpus")


def test_reset_title_prefers_czech_catalog_title_over_slug_heading(tmp_path: Path) -> None:
    markdown = tmp_path / "prvodce-zenm-aktiv-a-rizik-dle-vyhlky-o-kybernetick-bezpenosti.md"
    markdown.write_text(
        "\n".join(
            [
                "# Prvodce zenm aktiv a rizik dle vyhlky o kybernetick bezpenosti",
                "",
                "- Typ zdroje: metodika",
                "- Klasifikace: public",
                "- Jazyk: cs",
                "",
                "## Importní metadata",
                "",
                "- Původní katalogová položka: Průvodce zněním aktiv a rizik dle vyhlášky o kybernetické bezpečnosti",
                "",
            ]
        ),
        encoding="utf-8",
    )

    metadata = reset_pdf_first_corpus.parse_markdown_metadata(markdown)

    assert metadata["title"] == "Průvodce zněním aktiv a rizik dle vyhlášky o kybernetické bezpečnosti"
    assert metadata["title_source"] == "catalog_title"


def test_reset_title_repairs_known_broken_czech_title(tmp_path: Path) -> None:
    markdown = tmp_path / "prvodce-dokldn-poadavk-pro-zpis-sluby-cloud-computingu-v-1-2-0bd82f7187.md"
    markdown.write_text(
        "\n".join(
            [
                "# Prvodce dokldn poadavk pro zpis sluby cloud computingu v.1.2",
                "",
                "- Typ zdroje: metodika",
                "- Klasifikace: public",
                "- Zdroj PDF: https://example.test/prvodce-dokldn-poadavk-pro-zpis-sluby-cloud-computingu-v-1-2.pdf",
            ]
        ),
        encoding="utf-8",
    )

    metadata = reset_pdf_first_corpus.parse_markdown_metadata(markdown)

    assert metadata["title"] == "Průvodce dokládáním požadavků pro zápis služby cloud computingu v.1.2"
    assert metadata["title_source"] == "known_title_repair"


def test_reset_title_repairs_known_broken_v1_without_matching_v12(tmp_path: Path) -> None:
    markdown = tmp_path / "prvodce-dokldn-poadavk-pro-zpis-sluby-cloud-computingu-v-1-7f1da30bbf.md"
    markdown.write_text(
        "\n".join(
            [
                "# Prvodce dokldn poadavk pro zpis sluby cloud computingu v.1",
                "",
                "- Typ zdroje: metodika",
                "- Klasifikace: public",
            ]
        ),
        encoding="utf-8",
    )

    metadata = reset_pdf_first_corpus.parse_markdown_metadata(markdown)

    assert metadata["title"] == "Průvodce dokládáním požadavků pro zápis služby cloud computingu v.1"
    assert metadata["title_source"] == "known_title_repair"


def test_reset_title_prefers_explicit_metadata_title(tmp_path: Path) -> None:
    markdown = tmp_path / "fallback-slug-title.md"
    markdown.write_text(
        "\n".join(
            [
                "# fallback slug title",
                "",
                "- Název: Metodický návod pro využívání eGovernment cloudu ve veřejné správě",
                "- Typ zdroje: metodika",
                "- Klasifikace: public",
            ]
        ),
        encoding="utf-8",
    )

    metadata = reset_pdf_first_corpus.parse_markdown_metadata(markdown)

    assert metadata["title"] == "Metodický návod pro využívání eGovernment cloudu ve veřejné správě"
    assert metadata["title_source"] == "metadata:nazev"


def test_reset_title_does_not_use_catalog_section_as_document_title(tmp_path: Path) -> None:
    markdown = tmp_path / "dia-dns-cloud-computing-a44d63ba1a.md"
    markdown.write_text(
        "\n".join(
            [
                "# DIA DNS cloud computing",
                "",
                "- Typ zdroje: metodika",
                "- Klasifikace: public",
                "",
                "## Importní metadata",
                "",
                "- Původní katalogová položka: egovernment cloud",
            ]
        ),
        encoding="utf-8",
    )

    metadata = reset_pdf_first_corpus.parse_markdown_metadata(markdown)

    assert metadata["title"] == "DIA DNS cloud computing"
    assert metadata["title_source"] == "markdown_heading"


def test_prepare_title_prefers_origin_title_over_ascii_pdf_filename() -> None:
    title = prepare_public_pdf_corpus.title_from_candidate(
        label="prvodce dokldn poadavk pro zpis sluby cloud computingu",
        pdf_url="https://example.test/prvodce-dokldn-poadavk-pro-zpis-sluby-cloud-computingu.pdf",
        origin_title="Průvodce doložením požadavků pro zápis služby cloud computingu",
    )

    assert title == "Průvodce doložením požadavků pro zápis služby cloud computingu"
