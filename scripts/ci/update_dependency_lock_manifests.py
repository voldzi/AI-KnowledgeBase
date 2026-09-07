#!/usr/bin/env python3
"""Bind Python dependency inputs to the exact locks used by local and CI checks."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICES = {
    "evaluation_service": ("services/evaluation-service/requirements.txt", "services/evaluation-service/requirements.c4.lock"),
    "governance_service": ("services/governance-service/requirements.txt", "infra/ci/local-fast-check/locks/governance-service.test.lock"),
    "ingestion_service": ("services/ingestion-service/requirements.txt", "services/ingestion-service/requirements.c4.lock"),
    "llm_gateway_service": ("services/llm-gateway-service/requirements.txt", "infra/ci/local-fast-check/locks/llm-gateway-service.test.lock"),
    "rag_retrieval_service": ("services/rag-retrieval-service/requirements.txt", "services/rag-retrieval-service/requirements.c4.lock"),
    "registry_api": ("services/registry-api/pyproject.toml", "infra/ci/local-fast-check/locks/registry-api.test.lock"),
}


def digest(relative: str) -> str:
    return hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()


def manifest(schema: str) -> dict[str, object]:
    return {
        "python": "3.12",
        "schema": schema,
        "services": {
            name: {
                "input": dependency_input,
                "input_sha256": digest(dependency_input),
                "lock": lock,
                "lock_sha256": digest(lock),
            }
            for name, (dependency_input, lock) in SERVICES.items()
        },
    }


outputs = (
    ("infra/ci/local-fast-check/dependency-locks.json", "akb-local-fast-check-dependency-locks-1"),
    ("scripts/ci/gitea-python-test-locks.json", "akb-gitea-python-test-locks-1"),
)
for relative, schema in outputs:
    (ROOT / relative).write_text(json.dumps(manifest(schema), indent=2) + "\n", encoding="utf-8")
