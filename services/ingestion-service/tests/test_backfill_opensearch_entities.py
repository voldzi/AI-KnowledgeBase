from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[3] / "scripts" / "backfill_opensearch_entities.py"
SPEC = importlib.util.spec_from_file_location("backfill_opensearch_entities", SCRIPT_PATH)
assert SPEC is not None
backfill = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = backfill
SPEC.loader.exec_module(backfill)


def test_build_entity_update_document_adds_entity_facets_and_keeps_metadata() -> None:
    update = backfill.build_entity_update_document(
        {
            "document_title": "Directive",
            "section_title": "Operations",
            "section_path": ["Chapter 1", "Article 2"],
            "text": "RMO 12/2024 assigned ops@example.cz on 15. 6. 2026.",
            "metadata": {"source_profile": "unit-test"},
        }
    )

    assert update is not None
    assert update["metadata"]["source_profile"] == "unit-test"
    intelligence = update["metadata"]["intelligence"]
    assert intelligence["entity_extraction_profile"] == "rule_based_v1"
    assert "document_number" in update["entity_types"]
    assert "email" in update["entity_types"]
    assert "date" in update["entity_types"]
    assert "RMO12/2024" in update["entity_values"]
    assert "ops@example.cz" in update["entity_values"]
    assert "document_number:RMO12/2024" in update["entity_pairs"]
    assert "email:ops@example.cz" in update["entity_pairs"]
    assert "Directive" in update["search_text"]
    assert "Chapter 1 / Article 2" in update["search_text"]
    assert "document_number:RMO12/2024" in update["search_text"]


def test_build_entity_update_document_skips_empty_text() -> None:
    assert backfill.build_entity_update_document({"text": "", "normalized_text": "  "}) is None


def test_build_entity_update_document_uses_normalized_text_fallback() -> None:
    update = backfill.build_entity_update_document(
        {
            "document_title": "Fallback",
            "normalized_text": "Kontakt: fallback@example.cz",
            "metadata": {},
        }
    )

    assert update is not None
    assert update["entity_pairs"] == ["email:fallback@example.cz"]
    assert "Kontakt: fallback@example.cz" in update["search_text"]


def test_bulk_errors_returns_failed_update_operations_only() -> None:
    response = {
        "items": [
            {"update": {"status": 200}},
            {"index": {"status": 400, "error": {"type": "wrong-operation"}}},
            {"update": {"status": 429, "error": {"type": "too_many_requests"}}},
        ]
    }

    assert backfill.bulk_errors(response) == [
        {"status": 429, "error": {"type": "too_many_requests"}}
    ]


def test_dry_run_does_not_ensure_mapping(monkeypatch) -> None:
    calls: list[str] = []

    monkeypatch.setattr(backfill, "ensure_entity_mapping", lambda args: calls.append("mapping"))
    monkeypatch.setattr(backfill, "backfill_entities", lambda args: backfill.BackfillStats(scanned=1))

    assert backfill.main(["--dry-run", "--limit", "1"]) == 0
    assert calls == []
