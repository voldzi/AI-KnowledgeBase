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
