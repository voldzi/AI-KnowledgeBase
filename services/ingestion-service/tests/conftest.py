from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app


def web_transport_headers(
    *,
    actor_subject_id: str | None = None,
    authorization_proof: bool = False,
) -> dict[str, str]:
    headers = {
        "X-AKL-Subject": "service-account-svc-akb-web-ingestion",
        "X-AKL-Service-Client-ID": "svc-akb-web-ingestion",
        "X-AKL-Roles": "service_akb_web_ingestion",
    }
    if actor_subject_id is not None:
        headers["X-AKL-On-Behalf-Of"] = actor_subject_id
    if authorization_proof:
        headers["X-AKL-Ingestion-Authorization"] = (
            "mock-registry-issued-ingestion-authorization-proof"
        )
    return headers


def readiness_transport_headers() -> dict[str, str]:
    return {
        "X-AKL-Subject": "service-account-svc-ingestion",
        "X-AKL-Service-Client-ID": "svc-ingestion",
        "X-AKL-Roles": "service_ingestion",
    }


def actor_proof_headers(subject_id: str = "user_dev") -> dict[str, str]:
    return {
        "X-AKL-Subject": subject_id,
        "X-AKL-Roles": "admin",
        "X-AKL-Ingestion-Authorization": (
            "mock-registry-issued-ingestion-authorization-proof"
        ),
        "X-Correlation-ID": "corr-test-read",
    }


def make_client(tmp_path: Path, env: Mapping[str, str] | None = None) -> TestClient:
    base_env = {
        "AKL_ENV": "test",
        "AKL_AUTH_MODE": "disabled",
        "AKL_INGESTION_REGISTRY_CLIENT_MODE": "mock",
        "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
        "AKL_OBJECT_STORAGE_ROOT": str(tmp_path),
        "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "mock",
        "AKL_INGESTION_INDEXER_MODE": "mock",
        "AKL_INGESTION_JOB_STORE_PATH": str(tmp_path / "jobs"),
        "AKL_INGESTION_PROCESS_JOBS_INLINE": "true",
        "AKL_INGESTION_CHUNK_TARGET_CHARS": "500",
        "AKL_INGESTION_CHUNK_OVERLAP_CHARS": "50",
        "AKL_INGESTION_MAX_CHUNK_CHARS": "1000",
    }
    if env:
        base_env.update(env)
    return TestClient(create_app(load_settings(base_env)))
