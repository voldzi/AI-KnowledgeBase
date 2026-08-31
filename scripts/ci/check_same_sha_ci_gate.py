#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
from collections.abc import Mapping


REQUIRED_RESULTS = {
    "TRUSTED_CANDIDATE": "trusted-candidate",
    "IMPACT": "impact",
    "STANDARDS": "standards",
    "CLEAN_PILOT_PHASE_A": "clean-pilot-phase-a",
}

OPTIONAL_RESULTS = {
    "IMMUTABLE_RELEASE": ("immutable_release", "immutable-release"),
    "WEB": ("web", "web"),
    "REGISTRY_API": ("registry_api", "registry-api"),
    "INGESTION_SERVICE": ("ingestion_service", "ingestion-service"),
    "RAG_RETRIEVAL_SERVICE": ("rag_retrieval_service", "rag-retrieval-service"),
    "LLM_GATEWAY_SERVICE": ("llm_gateway_service", "llm-gateway-service"),
    "EVALUATION_SERVICE": ("evaluation_service", "evaluation-service"),
    "GOVERNANCE_SERVICE": ("governance_service", "governance-service"),
    "COMPOSE": ("compose", "compose"),
}


def validate_gate(environment: Mapping[str, str]) -> None:
    for key, job in REQUIRED_RESULTS.items():
        result = environment.get(f"AKB_CI_{key}_RESULT", "")
        if result != "success":
            raise ValueError(f"required job {job} must be success, got {result or 'missing'}")

    for key, (impact_output, job) in OPTIONAL_RESULTS.items():
        selected = environment.get(f"AKB_CI_SELECT_{key}", "")
        result = environment.get(f"AKB_CI_{key}_RESULT", "")
        if selected not in {"true", "false"}:
            raise ValueError(f"impact output {impact_output} must be true or false, got {selected or 'missing'}")
        expected = "success" if selected == "true" else "skipped"
        if result != expected:
            raise ValueError(
                f"job {job} must be {expected} when {impact_output}={selected}, got {result or 'missing'}"
            )


def main() -> int:
    try:
        validate_gate(os.environ)
    except ValueError as exc:
        print(f"same-SHA CI gate rejected the run: {exc}", file=sys.stderr)
        return 1
    print("same-SHA CI gate passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
