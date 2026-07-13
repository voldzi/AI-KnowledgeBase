from __future__ import annotations

from app.config import load_settings
from app.registry_client import RegistryClient
from app.security import AuthContext
from embeddings.client import EmbeddingClient


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
    assert "X-AKL-Subject" not in headers
    assert "X-AKL-Roles" not in headers
    assert "X-STRATOS-Capabilities" not in headers


def test_embedding_headers_use_gateway_service_identity_instead_of_caller_token(tmp_path) -> None:
    settings = load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "oidc",
            "AKL_SERVICE_ACCOUNT_SUBJECT": "svc-ingestion",
            "AKL_SERVICE_ACCOUNT_ROLES": "service_ingestion,document_manager",
            "AKL_LLM_GATEWAY_TOKEN": "gateway-token",
            "AKL_LLM_GATEWAY_AUDIENCE": "llm-gateway-service",
            "AKL_INGESTION_REGISTRY_CLIENT_MODE": "mock",
            "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
            "AKL_OBJECT_STORAGE_ROOT": str(tmp_path),
            "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "http",
            "AKL_INGESTION_INDEXER_MODE": "mock",
            "AKL_INGESTION_JOB_STORE_PATH": str(tmp_path / "jobs"),
        }
    )
    caller = AuthContext(
        subject_id="aiip-service",
        roles=("stratos_service",),
        groups=(),
        bearer_token="caller-oidc-token",
    )

    headers = EmbeddingClient(settings)._headers(caller)

    assert headers["Authorization"] == "Bearer gateway-token"
    assert headers["X-AKL-Subject"] == "svc-ingestion"
    assert headers["X-AKL-Roles"] == "service_ingestion,document_manager"
    assert headers["X-AKL-Audience"] == "llm-gateway-service"
    assert headers["X-AKL-On-Behalf-Of"] == "aiip-service"
