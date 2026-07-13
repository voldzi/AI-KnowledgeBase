import pytest
from pydantic import ValidationError

from app.config import Settings


def test_health_and_ready(client):
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json() == {"status": "ok", "service": "registry-api", "version": "dev"}
    assert health.headers["X-Request-ID"]
    assert health.headers["X-Correlation-ID"]

    ready = client.get("/ready")
    assert ready.status_code == 200
    assert ready.json() == {"status": "ready", "service": "registry-api"}


def test_production_rejects_mock_auth():
    with pytest.raises(ValidationError, match="AKL_AUTH_MODE=mock"):
        Settings(AKL_ENV="production", AKL_AUTH_MODE="mock")


def _production_settings(**overrides):
    values = {
        "AKL_ENV": "production",
        "AKL_AUTH_MODE": "oidc",
        "AKL_OIDC_ISSUER": "https://login.example/realms/stratos",
        "AKL_OIDC_AUDIENCE": "akb-api",
        "AKL_OIDC_JWKS_URL": "https://login.example/realms/stratos/certs",
        "AKL_TRUSTED_SERVICE_CLIENT_IDS": "akb-rag-service,aiip-service",
        "AKL_SERVICE_CLIENT_ROUTE_GRANTS": (
            "akb-rag-service=authz|audit|idempotency,"
            "aiip-service=audit|idempotency"
        ),
        "AKL_SERVICE_CLIENT_DELEGATIONS": "akb-rag-service=aiip-service",
        "AKL_STRATOS_AUTH_ME_URL": "https://stratos.example/api/v1/auth/me",
        "AKL_STRATOS_POLICY_BINDINGS_URL": "https://stratos.example/api/v1/policy/bindings",
        "AKL_STRATOS_POLICY_DECISIONS_URL": "https://stratos.example/api/v1/policy/decisions",
        "AKL_STRATOS_INFORMATION_RESOURCES_URL": "https://stratos.example/api/v1/information/resources",
        "AKL_STRATOS_INFORMATION_PUBLICATIONS_URL": "https://stratos.example/api/v1/information/publications",
        "AKL_STRATOS_PUBLIC_DECISIONS_URL": "https://stratos.example/api/v1/policy/public-decisions",
        "AKB_POLICY_SERVICE_TOKEN": "dedicated-akb-service-token",
        "AKL_PUBLIC_DELIVERY_INTERNAL_TOKEN": "independent-public-delivery-token-0001",
    }
    values.update(overrides)
    return Settings(**values)


def test_production_requires_public_governance_endpoints_and_private_delivery_token():
    with pytest.raises(ValidationError, match="AKL_STRATOS_PUBLIC_DECISIONS_URL"):
        _production_settings(AKL_STRATOS_PUBLIC_DECISIONS_URL="")
    with pytest.raises(ValidationError, match="at least 32 characters"):
        _production_settings(AKL_PUBLIC_DELIVERY_INTERNAL_TOKEN="too-short")


def test_production_requires_explicit_service_client_and_route_allowlists():
    with pytest.raises(ValidationError, match="AKL_TRUSTED_SERVICE_CLIENT_IDS"):
        _production_settings(AKL_TRUSTED_SERVICE_CLIENT_IDS="")
    with pytest.raises(ValidationError, match="AKL_SERVICE_CLIENT_ROUTE_GRANTS"):
        _production_settings(AKL_SERVICE_CLIENT_ROUTE_GRANTS="")


def test_error_shape_uses_trace_id(client, reader_headers):
    response = client.post(
        "/api/v1/documents",
        headers=reader_headers | {"X-Correlation-ID": "corr-denied"},
        json={
            "title": "Nope",
            "document_type": "policy",
            "owner_id": "user_reader",
            "classification": "internal",
        },
    )

    assert response.status_code == 403
    body = response.json()
    assert body["error"]["code"] == "forbidden"
    assert body["error"]["trace_id"] == "corr-denied"
