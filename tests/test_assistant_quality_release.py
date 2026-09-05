from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


SCRIPT = Path(__file__).parents[1] / "scripts" / "check_assistant_quality_release.py"
SPEC = importlib.util.spec_from_file_location("assistant_quality_release", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def _report() -> dict[str, object]:
    return {
        "run_id": "eval_run_1",
        "dataset_id": "professional_czech_knowledge_v1",
        "status": "completed",
        "summary": {"gold_cases": 8, "total_cases": 8, "passed_cases": 8,
                    "failed_cases": 0, "error_cases": 0},
        "quality_gate": {
            "status": "passed",
            "eligible_cases": 8,
            "checks": [
                {
                    "key": key,
                    "eligible": True,
                    "passed": True,
                    "operator": operator,
                    "actual": 1.0 if operator == ">=" else 0.0,
                    "threshold": 1.0 if operator == ">=" else 0.0,
                }
                for key, operator in MODULE.REQUIRED_CHECKS.items()
            ],
        },
        "comparison": {
            "baseline_run_id": "eval_run_0",
            "regressions": [],
        },
    }


def test_release_gate_accepts_reviewed_non_regressing_report() -> None:
    evidence = MODULE.validate_quality_report(
        _report(),
        expected_dataset_id="professional_czech_knowledge_v1",
        min_gold_cases=7,
    )
    assert evidence["quality_gate"] == "passed"
    assert evidence["gold_cases"] == 8


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("status",), "completed_with_errors"),
        (("summary", "gold_cases"), 2),
        (("quality_gate", "status"), "failed"),
        (("summary", "error_cases"), 1),
        (("summary", "total_cases"), 9),
        (("comparison", "regressions"), ["retrieval_recall"]),
    ],
)
def test_release_gate_fails_closed(path: tuple[str, ...], value: object) -> None:
    report = _report()
    target = report
    for key in path[:-1]:
        target = target[key]  # type: ignore[assignment,index]
    target[path[-1]] = value
    with pytest.raises(MODULE.QualityReleaseError):
        MODULE.validate_quality_report(
            report,
            expected_dataset_id="professional_czech_knowledge_v1",
            min_gold_cases=7,
        )


@pytest.mark.parametrize("mutation", [
    lambda checks: checks.pop(),
    lambda checks: checks.append(dict(checks[0])),
    lambda checks: checks.append("malformed"),
    lambda checks: checks[0].update(eligible=False),
    lambda checks: checks[0].update(passed=False),
    lambda checks: checks[0].update(actual=float("nan")),
    lambda checks: checks[0].update(actual=float("inf")),
    lambda checks: checks[0].update(actual=True),
    lambda checks: checks[0].update(actual=0),
    lambda checks: checks[0].update(key="unknown"),
    lambda checks: checks[0].update(operator="<="),
    lambda checks: checks[0].update(extra=True),
    lambda checks: checks[3].update(threshold=0.1),
])
def test_release_gate_requires_measured_complete_coverage(mutation):
    report = _report()
    mutation(report["quality_gate"]["checks"])
    with pytest.raises(MODULE.QualityReleaseError):
        MODULE.validate_quality_report(report, expected_dataset_id=None, min_gold_cases=7)
