from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any


SCRIPT_PATH = Path(__file__).resolve().parents[3] / "scripts" / "backfill_qdrant_entities.py"
SPEC = importlib.util.spec_from_file_location("backfill_qdrant_entities", SCRIPT_PATH)
assert SPEC is not None
backfill = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = backfill
SPEC.loader.exec_module(backfill)


def test_build_qdrant_payload_update_adds_entity_fields_and_keeps_metadata() -> None:
    update = backfill.build_qdrant_payload_update(
        {
            "text": "RMO 12/2024 assigned ops@example.cz on 15. 6. 2026.",
            "metadata": {"source_profile": "unit-test"},
        }
    )

    assert update is not None
    assert update["metadata"]["source_profile"] == "unit-test"
    assert update["metadata"]["intelligence"]["entity_extraction_profile"] == "rule_based_v1"
    assert "document_number" in update["entity_types"]
    assert "email" in update["entity_types"]
    assert "date" in update["entity_types"]
    assert "document_number:RMO12/2024" in update["entity_pairs"]
    assert "email:ops@example.cz" in update["entity_pairs"]


def test_build_qdrant_payload_update_uses_normalized_text_fallback() -> None:
    update = backfill.build_qdrant_payload_update(
        {
            "normalized_text": "Kontakt: fallback@example.cz",
            "metadata": {},
        }
    )

    assert update is not None
    assert update["entity_pairs"] == ["email:fallback@example.cz"]


def test_payload_has_entity_profile() -> None:
    assert backfill.payload_has_entity_profile(
        {"metadata": {"intelligence": {"entity_extraction_profile": "rule_based_v1"}}}
    )
    assert not backfill.payload_has_entity_profile({"metadata": {}})


def test_set_point_payload_sends_qdrant_payload_request() -> None:
    client = _FakeClient({"status": "ok"})
    args = backfill.parse_args(["--qdrant-url", "http://qdrant:6333", "--collection", "chunks"])

    assert backfill.set_point_payload(client, args, "point-1", {"entity_pairs": ["email:a@example.cz"]})
    assert client.calls == [
        {
            "method": "POST",
            "url": "http://qdrant:6333/collections/chunks/points/payload",
            "params": {"wait": "true"},
            "json": {"payload": {"entity_pairs": ["email:a@example.cz"]}, "points": ["point-1"]},
            "headers": {},
        }
    ]


class _FakeClient:
    def __init__(self, body: dict[str, Any]) -> None:
        self.body = body
        self.calls: list[dict[str, Any]] = []

    def request(
        self,
        method: str,
        url: str,
        *,
        params: dict[str, str] | None = None,
        json: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> "_FakeResponse":
        self.calls.append(
            {
                "method": method,
                "url": url,
                "params": params,
                "json": json,
                "headers": headers,
            }
        )
        return _FakeResponse(self.body)


class _FakeResponse:
    text = "{}"

    def __init__(self, body: dict[str, Any]) -> None:
        self.body = body

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return self.body
