from __future__ import annotations

import importlib.util
from pathlib import Path
import sys


SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "backfill_qdrant_v2.py"
SPEC = importlib.util.spec_from_file_location("backfill_qdrant_v2", SCRIPT)
assert SPEC and SPEC.loader
backfill = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = backfill
SPEC.loader.exec_module(backfill)


def test_build_v2_point_is_deterministic_and_preserves_governance_payload() -> None:
    point = {
        "id": "legacy-id",
        "vector": [0.1, 0.2],
        "payload": {
            "chunk_id": "chunk_a",
            "document_id": "doc_a",
            "document_version_id": "ver_a",
            "text_hash": "sha256:" + "a" * 64,
            "policy_hash": "sha256:" + "b" * 64,
        },
    }

    first = backfill.build_v2_point(point, dense_size=2)
    second = backfill.build_v2_point(point, dense_size=2)

    assert first == second
    assert first["vector"] == {"dense_bge_m3": [0.1, 0.2]}
    assert first["payload"]["policy_hash"] == "sha256:" + "b" * 64
    assert first["payload"]["colbert_status"] == "pending_backfill"


def test_build_v2_point_rejects_missing_hash_or_wrong_vector_size() -> None:
    base = {
        "vector": [0.1, 0.2],
        "payload": {
            "chunk_id": "chunk_a",
            "document_id": "doc_a",
            "document_version_id": "ver_a",
        },
    }
    assert backfill.build_v2_point(base, dense_size=2) is None
    base["payload"]["text_hash"] = "sha256:" + "a" * 64
    assert backfill.build_v2_point(base, dense_size=3) is None
