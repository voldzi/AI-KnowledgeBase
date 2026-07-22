#!/usr/bin/env python3
"""Validate Director Copilot production acceptance evidence fail closed."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


class DirectorCopilotReleaseError(ValueError):
    """The supplied dataset or report is not release-ready."""


REQUIRED_CATEGORIES = {
    "cross_domain_positive",
    "authorization",
    "authorization_revocation",
    "temporal_authorization",
    "information_policy",
    "classification",
    "source_degradation",
    "prompt_injection",
    "scope_leakage",
    "no_answer",
}


def validate_director_report(dataset: dict[str, Any], report: dict[str, Any]) -> dict[str, Any]:
    if dataset.get("dataset_id") != "director_copilot_v1":
        raise DirectorCopilotReleaseError("unexpected Director Copilot dataset")
    cases = dataset.get("cases")
    if not isinstance(cases, list) or len(cases) < 8:
        raise DirectorCopilotReleaseError("director_copilot_v1 must contain at least eight cases")
    expected_ids = {_required_string(case, "case_id") for case in cases if isinstance(case, dict)}
    categories = {_required_string(case, "category") for case in cases if isinstance(case, dict)}
    missing_categories = REQUIRED_CATEGORIES - categories
    if missing_categories:
        raise DirectorCopilotReleaseError(
            f"dataset is missing required categories: {', '.join(sorted(missing_categories))}"
        )
    thresholds = _required_mapping(dataset, "thresholds")

    if report.get("dataset_id") != dataset["dataset_id"]:
        raise DirectorCopilotReleaseError("report dataset does not match the release contract")
    if report.get("status") != "completed":
        raise DirectorCopilotReleaseError("acceptance run must complete without errors")
    for key in ("run_id", "executed_at", "stratos_release", "akb_release", "actor_subject"):
        _required_string(report, key)
    if report.get("actor_subject") != "stratos_admin":
        raise DirectorCopilotReleaseError("production acceptance must use stratos_admin")

    results = report.get("cases")
    if not isinstance(results, list):
        raise DirectorCopilotReleaseError("case results are missing")
    result_by_id = {
        _required_string(item, "case_id"): item
        for item in results
        if isinstance(item, dict)
    }
    if set(result_by_id) != expected_ids:
        raise DirectorCopilotReleaseError("report must contain every dataset case exactly once")
    failed = [case_id for case_id, item in result_by_id.items() if item.get("passed") is not True]
    if failed:
        raise DirectorCopilotReleaseError(f"failed Director Copilot cases: {', '.join(sorted(failed))}")
    if any(item.get("authorization_leak") is not False for item in result_by_id.values()):
        raise DirectorCopilotReleaseError("authorization leakage evidence is missing or non-zero")

    metrics = _required_mapping(report, "metrics")
    minimums = (
        "case_pass_rate_min",
        "tool_selection_accuracy_min",
        "entity_resolution_precision_min",
        "evidence_coverage_min",
        "temporal_accuracy_min",
        "no_answer_precision_min",
    )
    for threshold_key in minimums:
        metric_key = threshold_key.removesuffix("_min")
        if _required_number(metrics, metric_key) < _required_number(thresholds, threshold_key):
            raise DirectorCopilotReleaseError(f"metric {metric_key} is below its release threshold")
    maximums = (
        "authorization_leak_rate_max",
        "total_latency_p95_ms_max",
        "domain_tool_latency_p95_ms_max",
    )
    for threshold_key in maximums:
        metric_key = threshold_key.removesuffix("_max")
        if _required_number(metrics, metric_key) > _required_number(thresholds, threshold_key):
            raise DirectorCopilotReleaseError(f"metric {metric_key} exceeds its release threshold")

    baseline = _required_mapping(report, "baseline")
    if baseline.get("approved") is not True or baseline.get("kind") not in {
        "initial_production_baseline",
        "comparison",
    }:
        raise DirectorCopilotReleaseError("an approved production baseline is required")
    regressions = baseline.get("regressions", [])
    if not isinstance(regressions, list) or regressions:
        raise DirectorCopilotReleaseError("the acceptance report contains regressions")

    return {
        "run_id": report["run_id"],
        "dataset_id": dataset["dataset_id"],
        "case_count": len(expected_ids),
        "release_gate": "passed",
        "authorization_leak_rate": metrics["authorization_leak_rate"],
        "total_latency_p95_ms": metrics["total_latency_p95_ms"],
    }


def _required_mapping(value: dict[str, Any], key: str) -> dict[str, Any]:
    candidate = value.get(key)
    if not isinstance(candidate, dict):
        raise DirectorCopilotReleaseError(f"{key} is missing or malformed")
    return candidate


def _required_string(value: dict[str, Any], key: str) -> str:
    candidate = value.get(key)
    if not isinstance(candidate, str) or not candidate.strip():
        raise DirectorCopilotReleaseError(f"{key} is missing or malformed")
    return candidate


def _required_number(value: dict[str, Any], key: str) -> float:
    candidate = value.get(key)
    if not isinstance(candidate, (int, float)) or isinstance(candidate, bool):
        raise DirectorCopilotReleaseError(f"{key} is missing or malformed")
    return float(candidate)


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Director Copilot production release evidence")
    parser.add_argument("dataset", type=Path)
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    try:
        dataset = json.loads(args.dataset.read_text(encoding="utf-8"))
        report = json.loads(args.report.read_text(encoding="utf-8"))
        if not isinstance(dataset, dict) or not isinstance(report, dict):
            raise DirectorCopilotReleaseError("dataset and report must be JSON objects")
        evidence = validate_director_report(dataset, report)
    except (OSError, json.JSONDecodeError, DirectorCopilotReleaseError) as exc:
        parser.exit(1, f"Director Copilot release gate failed: {exc}\n")
    print(json.dumps(evidence, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
