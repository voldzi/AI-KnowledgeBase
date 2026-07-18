from __future__ import annotations

import asyncio

import jwt

import app.registry_client as registry_client_module
from app.config import load_settings
from app.http_utils import outgoing_headers
from app.registry_client import HttpRegistryClient
from app.security import AuthContext


def test_outgoing_headers_prefer_upstream_token_for_audit() -> None:
    settings = load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "oidc",
            "AKL_UPSTREAM_BEARER_TOKEN": "svc-token",
            "AKL_SERVICE_ACCOUNT_SUBJECT": "svc-rag",
            "AKL_SERVICE_ACCOUNT_ROLES": "service_rag",
            "AKL_RAG_DEPENDENCY_MODE": "mock",
        }
    )
    auth_context = AuthContext(
        subject_id="user_123",
        roles=("reader",),
        groups=(),
        bearer_token="user-token",
    )

    headers = outgoing_headers(settings, auth_context, prefer_upstream_token=True)

    assert headers["Authorization"] == "Bearer svc-token"
    assert headers["X-AKL-Subject"] == "svc-rag"
    assert headers["X-AKL-Roles"] == "service_rag"


def test_outgoing_headers_use_explicit_llm_gateway_service_identity() -> None:
    settings = load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "oidc",
            "AKL_SERVICE_ACCOUNT_SUBJECT": "svc-rag",
            "AKL_SERVICE_ACCOUNT_ROLES": "service_rag",
            "AKL_RAG_DEPENDENCY_MODE": "mock",
        }
    )
    auth_context = AuthContext(
        subject_id="user_123",
        roles=("reader",),
        groups=(),
        bearer_token="user-token",
    )

    headers = outgoing_headers(
        settings,
        auth_context,
        bearer_token_override="gateway-token",
        service_identity=True,
        audience="llm-gateway-service",
    )

    assert headers["Authorization"] == "Bearer gateway-token"
    assert headers["X-AKL-Subject"] == "svc-rag"
    assert headers["X-AKL-Roles"] == "service_rag"
    assert headers["X-AKL-Audience"] == "llm-gateway-service"


def test_registry_client_uses_cached_rag_service_identity(monkeypatch) -> None:
    settings = load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "oidc",
            "AKL_RAG_DEPENDENCY_MODE": "mock",
            "AKL_REGISTRY_SERVICE_TOKEN_URL": "https://login.example/token",
            "AKL_REGISTRY_SERVICE_CLIENT_ID": "akb-rag-service",
            "AKL_REGISTRY_SERVICE_CLIENT_SECRET": "test-secret",
        }
    )
    token_calls = 0
    registry_calls: list[dict[str, object]] = []
    service_token = jwt.encode(
        {"sub": "rag-service-keycloak-uuid"},
        key="",
        algorithm="none",
    )

    class TokenResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "access_token": service_token,
                "expires_in": 300,
            }

    class TokenClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, data):
            nonlocal token_calls
            token_calls += 1
            assert data["client_id"] == "akb-rag-service"
            return TokenResponse()

    async def fake_request_json_with_retry(**kwargs):
        registry_calls.append(kwargs)
        if kwargs["url"].endswith("/authz/filter-documents"):
            return {
                "allowed_document_ids": ["doc-1"],
                "denied_document_ids": [],
                "allowed_document_version_ids": {"doc-1": ["ver-1"]},
                "denied_document_version_ids": {"doc-1": ["ver-stale"]},
            }
        return {"state": "reserved", "record_id": "idem-1"}

    monkeypatch.setattr(registry_client_module.httpx, "AsyncClient", TokenClient)
    monkeypatch.setattr(registry_client_module, "request_json_with_retry", fake_request_json_with_retry)
    client = HttpRegistryClient(settings)
    auth_context = AuthContext(
        subject_id="service-account-aiip-service",
        roles=("service_aiip",),
        groups=(),
        bearer_token="aiip-public-token",
        service_identity=True,
    )

    result = asyncio.run(
        client.filter_allowed_documents(
            subject_id=auth_context.subject_id,
            candidate_document_ids=["doc-1"],
            auth_context=auth_context,
        )
    )
    asyncio.run(
        client.reserve_idempotency(
            client_id="aiip-service",
            operation="harmonize",
            idempotency_key="idem-contract-1",
            input_hash="a" * 64,
            auth_context=auth_context,
        )
    )

    assert result.allowed_document_ids == {"doc-1"}
    assert result.allowed_document_version_ids == {"doc-1": {"ver-1"}}
    assert result.denied_document_version_ids == {"doc-1": {"ver-stale"}}
    assert token_calls == 1
    assert all(call["bearer_token_override"] == service_token for call in registry_calls)
    assert all(call["service_identity"] is True for call in registry_calls)
    assert "roles" not in registry_calls[0]["json_body"]
    assert "capabilities" not in registry_calls[0]["json_body"]
    assert registry_calls[0]["json_body"]["subject_id"] == "rag-service-keycloak-uuid"
    assert registry_calls[0]["json_body"]["subject_id"] != auth_context.subject_id
