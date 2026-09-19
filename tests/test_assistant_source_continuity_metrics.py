from dataclasses import replace
import importlib.util
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location("source_continuity_metrics", Path(__file__).resolve().parents[1] / "scripts/evaluate_assistant_source_continuity.py")
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def test_source_continuity_requires_real_answers_and_bound_evidence():
    passing = module.ScenarioResult("test", "answer", "answer", 1, 1, True, True, True, [], 1.0)
    assert module.passes_source_continuity(passing)
    for patch in (
        {"initial_status": "no_answer"}, {"follow_up_status": "restricted"},
        {"initial_citation_count": 0}, {"follow_up_citation_count": 0},
        {"expected_law_found": False}, {"lineage_attempted": False}, {"lineage_preserved": False},
    ):
        assert not module.passes_source_continuity(replace(passing, **patch))
