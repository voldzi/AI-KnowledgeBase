from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).parents[1]
SPEC = importlib.util.spec_from_file_location(
    "rag_v2_release",
    ROOT / "scripts" / "check_rag_v2_release.py",
)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
DATASET = json.loads(
    (ROOT / "quality" / "datasets" / "professional_czech_knowledge_v2.json").read_text()
)
AUTH_CONTRACT = json.loads(
    (ROOT / "quality" / "datasets" / "rag_v2_authorization_v1.json").read_text()
)


def _evaluation() -> dict[str, object]:
    return {
        "run_id": "eval_run_release",
        "dataset_id": "professional_czech_knowledge_v2",
        "status": "completed",
        "summary": {
            "retrieval_recall_at_50": 1.0,
            "retrieval_recall_at_8": 1.0,
            "retrieval_ndcg": 1.0,
            "supported_claim_rate": 1.0,
            "false_answer_rate": 0.0,
            "router_accuracy": 1.0,
            "authorization_leak_rate": 0.0,
            "recall_at_50_evaluated_cases": 10,
            "claim_evaluated_cases": 1,
            "no_answer_evaluated_cases": 1,
            "router_evaluated_cases": len(DATASET["cases"]),
        },
        "promotion_diagnostics": {
            "reranker_fallback_count": 0,
            "exact_document_citation_purity": 1.0,
            "latency_regression_ratio": 0.2,
        },
    }


def _authorization_report() -> dict[str, object]:
    return {
        "cases": [
            {
                "case_id": case["case_id"],
                "outcome": case["expected_outcome"],
                "authorization_leak": False,
            }
            for case in AUTH_CONTRACT["cases"]
        ]
    }


def test_release_gate_accepts_complete_promotion_evidence() -> None:
    result = MODULE.validate_rag_v2_release(
        DATASET,
        _evaluation(),
        AUTH_CONTRACT,
        _authorization_report(),
    )

    assert result["release_gate"] == "passed"
    assert result["authorization_cases"] == 10


@pytest.mark.parametrize(
    ("metric", "value"),
    [
        ("retrieval_recall_at_50", 0.97),
        ("supported_claim_rate", 0.97),
        ("false_answer_rate", 0.03),
        ("router_accuracy", 0.94),
        ("authorization_leak_rate", 0.01),
    ],
)
def test_release_gate_rejects_failed_metric(metric: str, value: float) -> None:
    evaluation = _evaluation()
    evaluation["summary"][metric] = value  # type: ignore[index]

    with pytest.raises(MODULE.RagV2ReleaseError):
        MODULE.validate_rag_v2_release(
            DATASET,
            evaluation,
            AUTH_CONTRACT,
            _authorization_report(),
        )


def test_release_gate_requires_every_live_authorization_mutation() -> None:
    report = _authorization_report()
    report["cases"] = report["cases"][:-1]  # type: ignore[index]

    with pytest.raises(MODULE.RagV2ReleaseError):
        MODULE.validate_rag_v2_release(DATASET, _evaluation(), AUTH_CONTRACT, report)
