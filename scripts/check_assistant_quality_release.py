#!/usr/bin/env python3
"""Fail closed unless an AKB evaluation report is release-ready."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


class QualityReleaseError(ValueError):
    """The supplied evaluation report is not safe to use as release evidence."""


REQUIRED_CHECKS = {
    "retrieval_recall": ">=", "retrieval_ndcg": ">=",
    "false_zero_result_rate": "<=", "authorization_leak_rate": "<=",
    "citation_traceability": ">=", "retrieval_latency_p95_ms": "<=",
    "retrieval_recall_at_50": ">=", "supported_claim_rate": ">=",
    "false_answer_rate": "<=", "router_accuracy": ">=",
}


def validate_quality_report(
    report: dict[str, Any],
    *,
    expected_dataset_id: str | None,
    min_gold_cases: int,
) -> dict[str, Any]:
    if type(min_gold_cases) is not int or min_gold_cases < 1:
        raise QualityReleaseError("minimum reviewed coverage must be positive")
    if report.get("status") != "completed":
        raise QualityReleaseError("evaluation run must be completed without errors")
    dataset_id = _required_string(report, "dataset_id")
    if expected_dataset_id and dataset_id != expected_dataset_id:
        raise QualityReleaseError("evaluation dataset does not match the release contract")

    summary = _required_mapping(report, "summary")
    total_cases = _required_non_negative_int(summary, "total_cases")
    passed_cases = _required_non_negative_int(summary, "passed_cases")
    failed_cases = _required_non_negative_int(summary, "failed_cases")
    error_cases = _required_non_negative_int(summary, "error_cases")
    if error_cases or total_cases != passed_cases + failed_cases + error_cases:
        raise QualityReleaseError("evaluation cases contain errors or inconsistent totals")
    gold_cases = _required_non_negative_int(summary, "gold_cases")
    if gold_cases < min_gold_cases:
        raise QualityReleaseError(
            f"evaluation report has {gold_cases} gold cases; at least {min_gold_cases} are required"
        )

    gate = _required_mapping(report, "quality_gate")
    if gate.get("status") != "passed":
        raise QualityReleaseError("quality gate did not pass")
    eligible_cases = _required_non_negative_int(gate, "eligible_cases")
    if not gold_cases <= eligible_cases <= total_cases:
        raise QualityReleaseError("reviewed case counts are inconsistent")
    if eligible_cases < min_gold_cases:
        raise QualityReleaseError(
            "quality gate does not contain enough eligible reviewed cases"
        )
    checks = gate.get("checks")
    if not isinstance(checks, list) or not checks:
        raise QualityReleaseError("quality gate checks are missing")
    seen: set[str] = set()
    for check in checks:
        if not isinstance(check, dict) or set(check) != {
            "key", "actual", "operator", "threshold", "passed", "eligible"
        }:
            raise QualityReleaseError("quality gate check contract is invalid")
        key = check["key"]
        if not isinstance(key, str) or key not in REQUIRED_CHECKS or key in seen:
            raise QualityReleaseError("quality gate has unknown or duplicate checks")
        seen.add(key)
        if check["eligible"] is not True or check["passed"] is not True:
            raise QualityReleaseError("required quality check was not evaluated successfully")
        if check["operator"] != REQUIRED_CHECKS[key]:
            raise QualityReleaseError("quality check comparison is invalid")
        actual, threshold = check["actual"], check["threshold"]
        if any(type(value) not in (int, float) or not math.isfinite(value) or value < 0
               for value in (actual, threshold)):
            raise QualityReleaseError("quality check values must be finite non-negative numbers")
        if key != "retrieval_latency_p95_ms" and max(actual, threshold) > 1:
            raise QualityReleaseError("quality check rates must be within 0 and 1")
        if not (actual >= threshold if check["operator"] == ">=" else actual <= threshold):
            raise QualityReleaseError("quality check result contradicts its measurements")
        if key == "authorization_leak_rate" and (actual != 0 or threshold != 0):
            raise QualityReleaseError("authorization leakage is never acceptable")
    if seen != set(REQUIRED_CHECKS):
        raise QualityReleaseError("required quality check coverage is incomplete")

    comparison = report.get("comparison")
    regressions: list[str] = []
    baseline_run_id: str | None = None
    if comparison is not None:
        if not isinstance(comparison, dict):
            raise QualityReleaseError("run comparison must be an object")
        baseline_run_id = _required_string(comparison, "baseline_run_id")
        raw_regressions = comparison.get("regressions")
        if not isinstance(raw_regressions, list) or not all(
            isinstance(item, str) for item in raw_regressions
        ):
            raise QualityReleaseError("run comparison regressions are malformed")
        regressions = raw_regressions
    if regressions:
        raise QualityReleaseError(
            f"evaluation regressed against baseline: {', '.join(regressions)}"
        )

    return {
        "run_id": _required_string(report, "run_id"),
        "dataset_id": dataset_id,
        "gold_cases": gold_cases,
        "eligible_cases": eligible_cases,
        "quality_gate": "passed",
        "baseline_run_id": baseline_run_id,
        "regressions": [],
    }


def _required_mapping(value: dict[str, Any], key: str) -> dict[str, Any]:
    candidate = value.get(key)
    if not isinstance(candidate, dict):
        raise QualityReleaseError(f"{key} is missing or malformed")
    return candidate


def _required_string(value: dict[str, Any], key: str) -> str:
    candidate = value.get(key)
    if not isinstance(candidate, str) or not candidate.strip():
        raise QualityReleaseError(f"{key} is missing or malformed")
    return candidate


def _required_non_negative_int(value: dict[str, Any], key: str) -> int:
    candidate = value.get(key)
    if not isinstance(candidate, int) or isinstance(candidate, bool) or candidate < 0:
        raise QualityReleaseError(f"{key} is missing or malformed")
    return candidate


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Validate a JSON evaluation report before an immutable AKB release."
        )
    )
    parser.add_argument("report", type=Path)
    parser.add_argument("--dataset-id")
    parser.add_argument("--min-gold-cases", type=int, default=7)
    args = parser.parse_args()
    if args.min_gold_cases < 1:
        parser.error("--min-gold-cases must be positive")

    try:
        payload = json.loads(args.report.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise QualityReleaseError("evaluation report must contain a JSON object")
        evidence = validate_quality_report(
            payload,
            expected_dataset_id=args.dataset_id,
            min_gold_cases=args.min_gold_cases,
        )
    except (OSError, json.JSONDecodeError, QualityReleaseError) as exc:
        parser.exit(1, f"assistant quality release gate failed: {exc}\n")

    print(json.dumps(evidence, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
