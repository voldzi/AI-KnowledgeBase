from __future__ import annotations

from retrievers.scoring import sparse_score


def test_sparse_score_maps_project_risk_query_to_failure_scenarios() -> None:
    text = (
        "Chybové scénáře: systém musí reagovat, když LLM Gateway není dostupná, "
        "Qdrant není dostupný, OCR selže nebo dokument nelze parsovat."
    )

    assert sparse_score("Jaká jsou největší rizika projektu?", text) >= 0.35


def test_sparse_score_keeps_unrelated_query_low() -> None:
    text = "Chybové scénáře popisují selhání služeb a nedostupnost závislostí."

    assert sparse_score("xyzzy plugh abrakadabra", text) == 0.0
