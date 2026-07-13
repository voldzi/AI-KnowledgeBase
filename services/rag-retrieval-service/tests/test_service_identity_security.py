from __future__ import annotations

from fastapi.testclient import TestClient
import pytest

import app.security as security_module
from app.config import load_settings
from app.errors import RetrievalError
from app.main import create_app
from app.security import _oidc_context


def _settings():
    return load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "oidc",
            "AKL_OIDC_ISSUER": "https://login.example/realms/stratos",
            "AKL_OIDC_AUDIENCE": "akl-api",
            "AKL_OIDC_JWKS_URL": "https://login.example/realms/stratos/certs",
            "AKL_RAG_USER_OIDC_AUDIENCE": "akl-api",
            "AKL_RAG_AIIP_OIDC_AUDIENCE": "akb-api",
            "AKL_TRUSTED_SERVICE_CLIENT_IDS": "aiip-service,akb-rag-service",
            "AKL_RAG_AIIP_SERVICE_CLIENT_IDS": "aiip-service",
            "AKL_RAG_DEPENDENCY_MODE": "mock",
            "AKL_RAG_REGISTRY_CLIENT_MODE": "mock",
            "AKL_RAG_RETRIEVER_MODE": "mock",
            "AKL_RAG_LLM_CLIENT_MODE": "mock",
            "AKL_RAG_AUTHZ_MODE": "dev",
        }
    )


def _aiip_claims(*, audience: str = "akb-api", client_id: str = "aiip-service"):
    return {
        "sub": f"service-account-{client_id}",
        "preferred_username": f"service-account-{client_id}",
        "azp": client_id,
        "aud": audience,
        "realm_access": {"roles": ["service_aiip"]},
    }


def _user_claims(*, subject: str = "user-logistics", audience: str = "akl-api"):
    return {
        "sub": subject,
        "preferred_username": subject,
        "azp": "akl-web",
        "aud": audience,
        "realm_access": {"roles": ["stratos_user"]},
    }


def _retrieve_payload(subject_id: str) -> dict[str, object]:
    return {
        "subject_id": subject_id,
        "query": "restricted IT budget",
        "filters": {
            "document_types": ["contract"],
            "classification_max": "restricted",
            "document_ids": ["doc-it-restricted"],
        },
        "max_chunks": 4,
    }


def test_exact_aiip_service_and_user_audiences_are_separate() -> None:
    settings = _settings()

    aiip = _oidc_context(_aiip_claims(), "aiip-token", settings)
    user = _oidc_context(_user_claims(), "user-token", settings)

    assert aiip.service_identity is True
    assert aiip.service_client_id == "aiip-service"
    assert user.service_identity is False
    assert user.service_client_id is None


def test_aiip_service_rejects_user_or_foreign_audience() -> None:
    settings = _settings()

    with pytest.raises(RetrievalError, match="audience") as wrong_audience:
        _oidc_context(_aiip_claims(audience="akl-api"), "aiip-token", settings)
    with pytest.raises(RetrievalError) as foreign_service:
        _oidc_context(
            _aiip_claims(audience="foreign-api", client_id="foreign-service"),
            "foreign-token",
            settings,
        )

    assert wrong_audience.value.code == "OIDC_AUDIENCE_FORBIDDEN"
    assert foreign_service.value.code == "UNTRUSTED_SERVICE_IDENTITY"


def test_aiip_service_rejects_client_and_service_account_name_mismatch() -> None:
    settings = _settings()
    claims = _aiip_claims()
    claims["preferred_username"] = "service-account-akb-rag-service"

    with pytest.raises(RetrievalError) as mismatch:
        _oidc_context(claims, "aiip-token", settings)

    assert mismatch.value.code == "UNTRUSTED_SERVICE_IDENTITY"


def test_generic_rag_rejects_trusted_service_for_arbitrary_restricted_subject(
    monkeypatch,
) -> None:
    settings = _settings()
    monkeypatch.setattr(
        security_module,
        "_verified_oidc_claims",
        lambda _token, _settings: _aiip_claims(),
    )

    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/api/v1/rag/retrieve",
            headers={"Authorization": "Bearer aiip-token"},
            json=_retrieve_payload("user-it-admin"),
        )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "SERVICE_ROUTE_FORBIDDEN"


def test_generic_rag_requires_subject_bound_verified_user_bearer(monkeypatch) -> None:
    settings = _settings()
    monkeypatch.setattr(
        security_module,
        "_verified_oidc_claims",
        lambda _token, _settings: _user_claims(),
    )

    with TestClient(create_app(settings)) as client:
        allowed = client.post(
            "/api/v1/rag/retrieve",
            headers={"Authorization": "Bearer user-token"},
            json=_retrieve_payload("user-logistics"),
        )
        mismatched = client.post(
            "/api/v1/rag/retrieve",
            headers={"Authorization": "Bearer user-token"},
            json=_retrieve_payload("user-it-admin"),
        )

    assert allowed.status_code == 200, allowed.text
    assert mismatched.status_code == 403
    assert mismatched.json()["error"]["code"] == "SUBJECT_DELEGATION_MISMATCH"
