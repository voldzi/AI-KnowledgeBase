from __future__ import annotations

from app.config import load_settings
from app.registry_client import RegistryClient
from app.security import AuthContext


def test_registry_audit_headers_prefer_service_account_token(tmp_path) -> None:
    settings = load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "oidc",
            "AKL_SERVICE_ACCOUNT_TOKEN": "svc-token",
            "AKL_SERVICE_ACCOUNT_SUBJECT": "svc-ingestion",
            "AKL_SERVICE_ACCOUNT_ROLES": "service_ingestion",
            "AKL_INGESTION_REGISTRY_CLIENT_MODE": "http",
            "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
            "AKL_OBJECT_STORAGE_ROOT": str(tmp_path),
            "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "mock",
            "AKL_INGESTION_INDEXER_MODE": "mock",
            "AKL_INGESTION_JOB_STORE_PATH": str(tmp_path / "jobs"),
        }
    )
    auth_context = AuthContext(
        subject_id="user_123",
        roles=("reader",),
        groups=(),
        bearer_token="user-token",
    )

    headers = RegistryClient(settings)._headers(auth_context, prefer_service_account=True)

    assert headers["Authorization"] == "Bearer svc-token"
    assert headers["X-AKL-Subject"] == "svc-ingestion"
    assert headers["X-AKL-Roles"] == "service_ingestion"
