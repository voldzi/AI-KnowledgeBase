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
        "summary": {"gold_cases": 8},
        "quality_gate": {
            "status": "passed",
            "eligible_cases": 8,
            "checks": [
                {
                    "key": "retrieval_recall",
                    "eligible": True,
                    "passed": True,
                }
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
