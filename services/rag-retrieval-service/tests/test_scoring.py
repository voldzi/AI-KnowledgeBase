from __future__ import annotations

from app.schemas import RagQueryFilters
from retrievers.scoring import payload_matches_filters, sparse_score


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
    other_version = {**matching, "document_version_id": "ver_contract_2"}
    other_document = {**matching, "document_id": "doc_other"}

    assert payload_matches_filters(matching, filters) is True
    assert payload_matches_filters(other_version, filters) is False
    assert payload_matches_filters(other_document, filters) is False
