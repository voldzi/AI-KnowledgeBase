from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "check_director_copilot_release.py"
SPEC = importlib.util.spec_from_file_location("director_copilot_release", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
DATASET = json.loads((ROOT / "quality" / "datasets" / "director_copilot_v1.json").read_text())


def _report() -> dict[str, object]:
    return {
        "run_id": "director_prod_20260722_01",
        "dataset_id": "director_copilot_v1",
        "status": "completed",
        "executed_at": "2026-07-22T12:00:00Z",
        "stratos_release": "stratos-release",
        "akb_release": "akb-release",
        "actor_subject": "stratos_admin",
        "cases": [
            {"case_id": case["case_id"], "passed": True, "authorization_leak": False}
            for case in DATASET["cases"]
        ],
        "metrics": {
            "case_pass_rate": 1.0,
            "tool_selection_accuracy": 1.0,
            "entity_resolution_precision": 1.0,
            "evidence_coverage": 1.0,
            "temporal_accuracy": 1.0,
            "no_answer_precision": 1.0,
            "authorization_leak_rate": 0.0,
            "total_latency_p95_ms": 8000,
            "domain_tool_latency_p95_ms": 2500,
        },
        "baseline": {
            "kind": "initial_production_baseline",
            "approved": True,
            "regressions": [],
        },
    }


def test_director_release_gate_accepts_complete_safe_baseline() -> None:
    evidence = MODULE.validate_director_report(DATASET, _report())
    assert evidence["release_gate"] == "passed"
    assert evidence["case_count"] == 10


@pytest.mark.parametrize(
    ("mutation", "value"),
    [
        ("status", "completed_with_errors"),
        ("actor_subject", "another_user"),
        ("authorization_leak_rate", 0.01),
        ("total_latency_p95_ms", 10001),
    ],
)
def test_director_release_gate_fails_closed(mutation: str, value: object) -> None:
    report = _report()
    if mutation in {"authorization_leak_rate", "total_latency_p95_ms"}:
        report["metrics"][mutation] = value  # type: ignore[index]
    else:
        report[mutation] = value
    with pytest.raises(MODULE.DirectorCopilotReleaseError):
        MODULE.validate_director_report(DATASET, report)


def test_director_release_gate_requires_every_case() -> None:
    report = _report()
    report["cases"] = report["cases"][:-1]  # type: ignore[index]
    with pytest.raises(MODULE.DirectorCopilotReleaseError):
        MODULE.validate_director_report(DATASET, report)
