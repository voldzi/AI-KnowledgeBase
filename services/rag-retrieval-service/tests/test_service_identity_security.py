from __future__ import annotations

from fastapi.testclient import TestClient
import pytest

import app.security as security_module
from app.config import ConfigError, load_settings
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
            "AKL_TRUSTED_SERVICE_CLIENT_IDS": "akb-rag-service",
            "AKL_RAG_DEPENDENCY_MODE": "mock",
            "AKL_RAG_REGISTRY_CLIENT_MODE": "mock",
            "AKL_RAG_RETRIEVER_MODE": "mock",
            "AKL_RAG_LLM_CLIENT_MODE": "mock",
            "AKL_RAG_AUTHZ_MODE": "dev",
        }
    )


def _service_claims(*, audience: str = "akl-api", client_id: str = "akb-rag-service"):
    return {
        "sub": f"service-account-{client_id}",
        "preferred_username": f"service-account-{client_id}",
        "azp": client_id,
        "aud": audience,
        "realm_access": {"roles": ["service_rag"]},
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


def test_user_and_trusted_service_use_the_single_akb_audience() -> None:
    settings = _settings()

    service = _oidc_context(_service_claims(), "service-token", settings)
    user = _oidc_context(_user_claims(), "user-token", settings)

    assert service.service_identity is True
    assert service.service_client_id == "akb-rag-service"
    assert user.service_identity is False
    assert user.service_client_id is None


def test_service_rejects_foreign_audience_and_untrusted_client() -> None:
    settings = _settings()

    with pytest.raises(RetrievalError, match="audience") as wrong_audience:
        _oidc_context(_service_claims(audience="foreign-api"), "service-token", settings)
    with pytest.raises(RetrievalError) as foreign_service:
        _oidc_context(
            _service_claims(client_id="foreign-service"),
            "foreign-token",
            settings,
        )

    assert wrong_audience.value.code == "OIDC_AUDIENCE_FORBIDDEN"
    assert foreign_service.value.code == "UNTRUSTED_SERVICE_IDENTITY"


def test_service_rejects_client_and_service_account_name_mismatch() -> None:
    settings = _settings()
    claims = _service_claims()
    claims["preferred_username"] = "service-account-foreign-service"

    with pytest.raises(RetrievalError) as mismatch:
        _oidc_context(claims, "service-token", settings)

    assert mismatch.value.code == "UNTRUSTED_SERVICE_IDENTITY"


def test_generic_rag_rejects_trusted_service_for_arbitrary_restricted_subject(
    monkeypatch,
) -> None:
    settings = _settings()
    monkeypatch.setattr(
        security_module,
        "_verified_oidc_claims",
        lambda _token, _settings: _service_claims(),
    )

    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/api/v1/rag/retrieve",
            headers={"Authorization": "Bearer service-token"},
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
