from __future__ import annotations

from app.schemas import ChunkCitation, RagQueryFilters, RetrievedChunk
from rerankers.lexical import LexicalReranker
from retrievers.scoring import expand_query_text, extract_query_identifiers, payload_matches_filters, sparse_score


def test_expand_query_text_adds_controlled_document_synonyms() -> None:
    expanded = expand_query_text("RMO 12/2024 gestor")

    assert "rozkaz ministra obrany" in expanded
    assert "odpovedny" in expanded
    assert "owner" in expanded


def test_expand_query_text_adds_czech_statistics_and_itsm_synonyms() -> None:
    statistics = expand_query_text("Jaké produkty vytváří ČSÚ?")
    service_management = expand_query_text("Jak řídit IT služby?")

    assert "katalog produktu" in statistics
    assert "cesky statisticky urad" in statistics
    assert "itil" in service_management
    assert "fitsm" in service_management


def test_extract_query_identifiers_normalizes_document_and_citation_references() -> None:
    identifiers = extract_query_identifiers("Najdi RMO č. 12/2024, čl. 4 odst. 2.")

    assert identifiers == ["rmo 12/2024", "cl 4", "odst 2"]


def test_reranker_prefers_exact_source_title_over_semantic_noise() -> None:
    exact_title = RetrievedChunk(
        chunk_id="chunk_exact_title",
        score=0.82,
        retrieval_method="opensearch",
        text="Obecné povinnosti poskytovatelů a uživatelů systémů.",
        citation=ChunkCitation(
            document_id="doc_ai_act",
            document_version_id="ver_ai_act",
            document_title="Nařízení o umělé inteligenci (AI Act)",
            version_label="2024",
            section_path=[],
        ),
        metadata={"sparse_score": 0.82},
    )
    semantic_noise = RetrievedChunk(
        chunk_id="chunk_semantic_noise",
        score=0.84,
        retrieval_method="qdrant",
        text="AI Act je zmíněn v obecném přehledu digitalizace a inovací.",
        citation=ChunkCitation(
            document_id="doc_overview",
            document_version_id="ver_overview",
            document_title="Aktuality z oblasti digitalizace",
            version_label="2024",
            section_path=[],
        ),
        metadata={"sparse_score": 0.84},
    )

    reranked = LexicalReranker().rerank(
        query="AI Act",
        chunks=[semantic_noise, exact_title],
        limit=2,
    )

    assert reranked[0].chunk_id == "chunk_exact_title"
    assert reranked[0].metadata["rerank_title_score"] == 1.0
    assert reranked[0].metadata["rerank_method"] == "source_aware_lexical_overlap"


def test_sparse_score_links_acronyms_to_controlled_document_language() -> None:
    text = "Rozkaz ministra obrany popisuje odpovědný útvar a vlastníka dokumentu."

    assert sparse_score("RMO gestor", text) >= 0.2


def test_sparse_score_maps_project_risk_query_to_failure_scenarios() -> None:
    text = (
        "Chybové scénáře: systém musí reagovat, když LLM Gateway není dostupná, "
        "Qdrant není dostupný, OCR selže nebo dokument nelze parsovat."
    )

    assert sparse_score("Jaká jsou největší rizika projektu?", text) >= 0.35


def test_sparse_score_keeps_unrelated_query_low() -> None:
    text = "Chybové scénáře popisují selhání služeb a nedostupnost závislostí."

    assert sparse_score("xyzzy plugh abrakadabra", text) == 0.0


def test_sparse_score_does_not_treat_generic_api_errors_as_project_risk() -> None:
    text = "Endpointy musí být verzované a chyby musí mít jednotný formát."

    assert sparse_score("Jaká jsou největší rizika projektu?", text) < 0.35


def test_sparse_score_prefers_specific_failure_scenarios_over_generic_limits() -> None:
    specific = (
        "Chybové scénáře: systém musí reagovat, když LLM Gateway není dostupná, "
        "Qdrant není dostupný, OCR selže nebo existuje konflikt mezi dokumenty."
    )
    generic = "Každá služba má dokumentovat limity a bezpečnostní poznámky."

    assert sparse_score("Jaká jsou největší rizika projektu?", specific) > sparse_score(
        "Jaká jsou největší rizika projektu?",
        generic,
    )


def test_payload_filters_exact_document_version() -> None:
    filters = RagQueryFilters(
        document_ids=["doc_contract"],
        document_version_ids=["ver_contract_1"],
        only_valid=False,
    )
    matching = {
        "document_id": "doc_contract",
        "document_version_id": "ver_contract_1",
        "classification": "internal",
    }

    assert payload_matches_filters(matching, filters) is True
    assert payload_matches_filters({**matching, "document_version_id": "ver_contract_2"}, filters) is False
    assert payload_matches_filters({**matching, "document_id": "doc_other"}, filters) is False
