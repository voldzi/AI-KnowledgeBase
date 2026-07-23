#!/usr/bin/env python3
"""Validate complete RAG V2 promotion evidence without reading sensitive content."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


class RagV2ReleaseError(ValueError):
    """The supplied evaluation or authorization evidence is not promotion-ready."""


THRESHOLDS = {
    "retrieval_recall_at_50": (">=", 0.98),
    "retrieval_recall_at_8": (">=", 0.92),
    "retrieval_ndcg": (">=", 0.85),
    "supported_claim_rate": (">=", 0.98),
    "false_answer_rate": ("<=", 0.02),
    "router_accuracy": (">=", 0.95),
    "authorization_leak_rate": ("<=", 0.0),
}


def validate_rag_v2_release(
    dataset: dict[str, Any],
    evaluation: dict[str, Any],
    authorization_contract: dict[str, Any],
    authorization_report: dict[str, Any],
) -> dict[str, Any]:
    if dataset.get("dataset_id") != "professional_czech_knowledge_v2":
        raise RagV2ReleaseError("unexpected retrieval dataset")
    if evaluation.get("dataset_id") != dataset["dataset_id"]:
        raise RagV2ReleaseError("evaluation dataset does not match the release contract")
    if evaluation.get("status") != "completed":
        raise RagV2ReleaseError("evaluation must complete without errors")

    summary = _mapping(evaluation, "summary")
    coverage = {
        "recall_at_50_evaluated_cases": 1,
        "claim_evaluated_cases": 1,
        "no_answer_evaluated_cases": 1,
        "router_evaluated_cases": len(dataset.get("cases", [])),
    }
    for key, minimum in coverage.items():
        if _number(summary, key) < minimum:
            raise RagV2ReleaseError(f"promotion metric coverage is incomplete: {key}")
    for key, (operator, threshold) in THRESHOLDS.items():
        actual = _number(summary, key)
        passed = actual >= threshold if operator == ">=" else actual <= threshold
        if not passed:
            raise RagV2ReleaseError(f"promotion metric failed: {key}")

    diagnostics = evaluation.get("promotion_diagnostics")
    if not isinstance(diagnostics, dict):
        raise RagV2ReleaseError("promotion diagnostics are missing")
    if diagnostics.get("reranker_fallback_count") != 0:
        raise RagV2ReleaseError("reranker fallback must be zero")
    if _number(diagnostics, "exact_document_citation_purity") < 1:
        raise RagV2ReleaseError("exact-document citation purity must be 100 percent")
    if _number(diagnostics, "latency_regression_ratio") > 0.30:
        raise RagV2ReleaseError("retrieval latency regression exceeds 30 percent")

    expected_auth = {
        _string(case, "case_id"): _string(case, "expected_outcome")
        for case in authorization_contract.get("cases", [])
        if isinstance(case, dict)
    }
    if len(expected_auth) != 10:
        raise RagV2ReleaseError("authorization contract must contain ten mutation cases")
    actual_auth = {
        _string(case, "case_id"): case
        for case in authorization_report.get("cases", [])
        if isinstance(case, dict)
    }
    if set(actual_auth) != set(expected_auth):
        raise RagV2ReleaseError("authorization report must contain every mutation exactly once")
    for case_id, expected_outcome in expected_auth.items():
        result = actual_auth[case_id]
        if result.get("outcome") != expected_outcome or result.get("authorization_leak") is not False:
            raise RagV2ReleaseError(f"authorization mutation failed: {case_id}")

    return {
        "dataset_id": dataset["dataset_id"],
        "run_id": _string(evaluation, "run_id"),
        "release_gate": "passed",
        "authorization_cases": len(actual_auth),
    }


def _mapping(value: dict[str, Any], key: str) -> dict[str, Any]:
    candidate = value.get(key)
    if not isinstance(candidate, dict):
        raise RagV2ReleaseError(f"{key} is missing or malformed")
    return candidate


def _string(value: dict[str, Any], key: str) -> str:
    candidate = value.get(key)
    if not isinstance(candidate, str) or not candidate.strip():
        raise RagV2ReleaseError(f"{key} is missing or malformed")
    return candidate


def _number(value: dict[str, Any], key: str) -> float:
    candidate = value.get(key)
    if not isinstance(candidate, (int, float)) or isinstance(candidate, bool):
        raise RagV2ReleaseError(f"{key} is missing or malformed")
    return float(candidate)


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate AKB RAG V2 promotion evidence")
    parser.add_argument("dataset", type=Path)
    parser.add_argument("evaluation", type=Path)
    parser.add_argument("authorization_contract", type=Path)
    parser.add_argument("authorization_report", type=Path)
    args = parser.parse_args()
    try:
        payloads = [
            json.loads(path.read_text(encoding="utf-8"))
            for path in (
                args.dataset,
                args.evaluation,
                args.authorization_contract,
                args.authorization_report,
            )
        ]
        if any(not isinstance(payload, dict) for payload in payloads):
            raise RagV2ReleaseError("all inputs must be JSON objects")
        evidence = validate_rag_v2_release(*payloads)
    except (OSError, json.JSONDecodeError, RagV2ReleaseError) as exc:
        parser.exit(1, f"RAG V2 release gate failed: {exc}\n")
    print(json.dumps(evidence, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
