from __future__ import annotations

from app.controlled_rule_extraction import extract_controlled_rule_proposals
from app.schemas import ChunkCitation, RetrievedChunk


def _chunk(text: str) -> RetrievedChunk:
    return RetrievedChunk(
        chunk_id="chunk_procurement_1",
        score=0.95,
        retrieval_method="opensearch",
        text=text,
        citation=ChunkCitation(
            document_id="doc_directive",
            document_version_id="ver_directive_1",
            document_title="Směrnice o zadávání veřejných zakázek",
            version_label="1",
            page_number=4,
            section_path=["Článek 6", "Odstavec 2"],
        ),
    )


def test_extracts_cited_financial_limit_deadline_and_obligation() -> None:
    proposals, missing, warnings = extract_controlled_rule_proposals(
        chunks=[
            _chunk(
                "Příkazce operace musí u zakázky do 100 000 Kč bez DPH "
                "zajistit písemnou objednávku. Podklady předloží ve lhůtě "
                "10 pracovních dnů."
            )
        ]
    )

    assert missing == []
    assert warnings == []
    categories = {proposal.category for proposal in proposals}
    assert categories == {"financial_limit", "deadline"}
    financial = next(
        proposal for proposal in proposals if proposal.category == "financial_limit"
    )
    assert financial.value == 100000
    assert financial.currency == "CZK"
    assert financial.vat_basis == "excluding_vat"
    assert financial.responsible_roles == ["Příkazce operace"]
    assert financial.required_evidence == ["objednávku"]
    assert financial.citation.document_version_id == "ver_directive_1"
    assert financial.citation.quoted_text.startswith("Příkazce operace musí")


def test_deduplicates_same_rule_across_chunks() -> None:
    chunk = _chunk("Limit předpokládané hodnoty je do 20 000 Kč včetně DPH.")

    proposals, _, _ = extract_controlled_rule_proposals(chunks=[chunk, chunk])

    assert len(proposals) == 1
    assert proposals[0].value == 20000
    assert proposals[0].vat_basis == "including_vat"


def test_preserves_dot_separated_czech_financial_limits() -> None:
    proposals, missing, warnings = extract_controlled_rule_proposals(
        chunks=[
            _chunk(
                "U zakázky vyšší než 20.000 Kč s DPH se provede průzkum trhu. "
                "VZMR I. kategorie je do 200.000 Kč bez DPH včetně."
            )
        ]
    )

    assert missing == []
    assert warnings == []
    financial = sorted(
        (
            proposal.value,
            proposal.vat_basis,
        )
        for proposal in proposals
        if proposal.category == "financial_limit"
    )
    assert financial == [
        (20000, "including_vat"),
        (200000, "excluding_vat"),
    ]


def test_returns_missing_information_without_inventing_rule() -> None:
    proposals, missing, warnings = extract_controlled_rule_proposals(
        chunks=[_chunk("Tento dokument obsahuje obecný úvod a seznam kapitol.")]
    )

    assert proposals == []
    assert missing == ["NO_CITABLE_CONTROLLED_RULES_FOUND"]
    assert warnings == []
