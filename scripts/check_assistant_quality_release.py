#!/usr/bin/env python3
"""Fail closed unless an AKB evaluation report is release-ready."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


class QualityReleaseError(ValueError):
    """The supplied evaluation report is not safe to use as release evidence."""


def validate_quality_report(
    report: dict[str, Any],
    *,
    expected_dataset_id: str | None,
    min_gold_cases: int,
) -> dict[str, Any]:
    if report.get("status") != "completed":
        raise QualityReleaseError("evaluation run must be completed without errors")
    dataset_id = _required_string(report, "dataset_id")
    if expected_dataset_id and dataset_id != expected_dataset_id:
        raise QualityReleaseError("evaluation dataset does not match the release contract")

    summary = _required_mapping(report, "summary")
    gold_cases = _required_non_negative_int(summary, "gold_cases")
    if gold_cases < min_gold_cases:
        raise QualityReleaseError(
            f"evaluation report has {gold_cases} gold cases; at least {min_gold_cases} are required"
        )

    gate = _required_mapping(report, "quality_gate")
    if gate.get("status") != "passed":
        raise QualityReleaseError("quality gate did not pass")
    eligible_cases = _required_non_negative_int(gate, "eligible_cases")
    if eligible_cases < min_gold_cases:
        raise QualityReleaseError(
            "quality gate does not contain enough eligible reviewed cases"
        )
    checks = gate.get("checks")
    if not isinstance(checks, list) or not checks:
        raise QualityReleaseError("quality gate checks are missing")
    failed_checks = [
        str(check.get("key", "unknown"))
        for check in checks
        if isinstance(check, dict)
        and check.get("eligible") is True
        and check.get("passed") is not True
    ]
    if failed_checks:
        raise QualityReleaseError(
            f"quality gate contains failed checks: {', '.join(failed_checks)}"
        )

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
