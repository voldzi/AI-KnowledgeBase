from __future__ import annotations

from tests.conftest import make_client


def test_validation_error_uses_standard_envelope() -> None:
    with make_client() as client:
        response = client.post(
            "/api/v1/chat/completions",
            json={"model": "mock-chat", "messages": []},
            headers={"X-Correlation-ID": "corr-validation"},
        )

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["error"]["trace_id"] == "corr-validation"
    assert "input" not in body["error"]["details"]["errors"][0]


def test_validation_error_does_not_echo_prompt_text() -> None:
    with make_client() as client:
        response = client.post(
            "/api/v1/chat/completions",
            json={
                "model": "mock-chat",
                "messages": [
                    {
                        "role": "user",
                        "content": "visible content",
                        "unexpected": "sensitive prompt",
                    }
                ],
            },
        )

    assert response.status_code == 422
    assert "sensitive prompt" not in response.text


def test_bearer_auth_requires_token() -> None:
    with make_client({"AKL_AUTH_MODE": "bearer", "AKL_SERVICE_TOKEN": "expected"}) as client:
        response = client.get("/api/v1/models")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


def test_bearer_auth_accepts_configured_token() -> None:
    with make_client({"AKL_AUTH_MODE": "bearer", "AKL_SERVICE_TOKEN": "expected"}) as client:
        response = client.get("/api/v1/models", headers={"Authorization": "Bearer expected"})

    assert response.status_code == 200


def test_bearer_auth_accepts_matching_service_identity_contract() -> None:
    env = {
        "AKL_AUTH_MODE": "bearer",
        "AKL_SERVICE_TOKEN": "expected",
        "AKL_LLM_REQUIRE_CALLER_IDENTITY": "true",
        "AKL_LLM_GATEWAY_AUDIENCE": "llm-gateway-service",
        "AKL_LLM_GATEWAY_ALLOWED_CALLER_ROLES": "service_ingestion,service_rag",
    }
    headers = {
        "Authorization": "Bearer expected",
        "X-AKL-Subject": "svc-ingestion",
        "X-AKL-Audience": "llm-gateway-service",
        "X-AKL-Roles": "service_ingestion,document_manager",
    }

    with make_client(env) as client:
        response = client.get("/api/v1/models", headers=headers)

    assert response.status_code == 200


def test_bearer_auth_rejects_wrong_service_audience() -> None:
    env = {
        "AKL_AUTH_MODE": "bearer",
        "AKL_SERVICE_TOKEN": "expected",
        "AKL_LLM_REQUIRE_CALLER_IDENTITY": "true",
        "AKL_LLM_GATEWAY_AUDIENCE": "llm-gateway-service",
    }
    headers = {
        "Authorization": "Bearer expected",
        "X-AKL-Subject": "svc-ingestion",
        "X-AKL-Audience": "akl-api",
        "X-AKL-Roles": "service_ingestion",
    }

    with make_client(env) as client:
        response = client.get("/api/v1/models", headers=headers)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "AUTH_AUDIENCE_FORBIDDEN"


def test_bearer_auth_rejects_service_without_allowed_role() -> None:
    env = {
        "AKL_AUTH_MODE": "bearer",
        "AKL_SERVICE_TOKEN": "expected",
        "AKL_LLM_REQUIRE_CALLER_IDENTITY": "true",
        "AKL_LLM_GATEWAY_AUDIENCE": "llm-gateway-service",
        "AKL_LLM_GATEWAY_ALLOWED_CALLER_ROLES": "service_ingestion,service_rag",
    }
    headers = {
        "Authorization": "Bearer expected",
        "X-AKL-Subject": "aiip-service",
        "X-AKL-Audience": "llm-gateway-service",
        "X-AKL-Roles": "stratos_service",
    }

    with make_client(env) as client:
        response = client.get("/api/v1/models", headers=headers)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "AUTH_ROLE_FORBIDDEN"
