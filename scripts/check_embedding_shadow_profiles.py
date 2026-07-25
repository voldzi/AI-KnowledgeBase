#!/usr/bin/env python3
"""Validate the static embedding shadow manifest without network access."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROFILE_PATH = (
    ROOT
    / "contracts"
    / "embedding-shadow"
    / "v1"
    / "czech_embedding_shadow_profiles.json"
)
EXPECTED_SCHEMA = "akb-embedding-shadow-profile-set-1"


def fail(message: str) -> None:
    raise SystemExit(f"embedding shadow profile check failed: {message}")


def main() -> None:
    data = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
    if data.get("schema_version") != EXPECTED_SCHEMA:
        fail("unsupported schema_version")
    profiles = data.get("profiles")
    if not isinstance(profiles, list) or len(profiles) < 2:
        fail("at least one baseline and one candidate are required")
    profile_ids = [profile.get("profile_id") for profile in profiles]
    model_ids = [profile.get("model_id") for profile in profiles]
    collections = [profile.get("collection_name") for profile in profiles]
    if len(set(profile_ids)) != len(profile_ids):
        fail("profile_id values must be unique")
    if len(set(model_ids)) != len(model_ids):
        fail("model_id values must be unique")
    if len(set(collections)) != len(collections):
        fail("every model must use a separate collection")
    baselines = [profile for profile in profiles if profile.get("role") == "baseline"]
    if len(baselines) != 1 or baselines[0].get("enabled_for_answers") is not True:
        fail("exactly one enabled baseline is required")
    for profile in profiles:
        if profile.get("role") not in {"baseline", "candidate"}:
            fail("unknown role")
        if profile.get("role") == "candidate" and profile.get("enabled_for_answers") is not False:
            fail("candidates must remain disabled for answers")
        if not isinstance(profile.get("dimensions"), int) or profile["dimensions"] < 64:
            fail("invalid dimensions")
        if not isinstance(profile.get("max_input_tokens"), int) or profile["max_input_tokens"] < 128:
            fail("invalid max_input_tokens")
        forbidden_keys = {
            "endpoint",
            "base_url",
            "secret",
            "credential",
            "access_token",
            "api_key",
        }
        if forbidden_keys.intersection(profile):
            fail("profiles must not contain endpoint or credential fields")
        serialized_values = json.dumps(list(profile.values())).lower()
        if "http://" in serialized_values or "https://" in serialized_values:
            fail("profiles must not contain endpoints or credential fields")
    expected_models = {
        "BAAI/bge-m3",
        "Qwen/Qwen3-Embedding-0.6B",
        "Seznam/simcse-retromae-small-cs",
    }
    if set(model_ids) != expected_models:
        fail("the approved comparison model set is incomplete")
    gates = data.get("promotion_gates")
    if not isinstance(gates, dict):
        fail("promotion_gates are missing")
    if gates.get("false_answer_rate_max") != 0:
        fail("false answers must not be permitted")
    if gates.get("citation_traceability_min") != 1:
        fail("citation traceability must remain complete")
    print(f"OK embedding shadow profiles={len(profiles)} baseline={baselines[0]['profile_id']}")


if __name__ == "__main__":
    main()
