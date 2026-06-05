from __future__ import annotations

from tests.conftest import make_client


def test_models_lists_mock_models() -> None:
    with make_client() as client:
        response = client.get("/api/v1/models")

    assert response.status_code == 200
    models = response.json()["models"]
    assert {"model_id": "mock-chat", "provider": "mock", "capabilities": ["chat"], "context_window": 8192} in models


def test_chat_completion_uses_mock_provider() -> None:
    with make_client() as client:
        response = client.post(
            "/api/v1/chat/completions",
            json={
                "model": "mock-chat",
                "messages": [{"role": "user", "content": "Secret prompt text must not be logged."}],
                "temperature": 0.1,
                "metadata": {"purpose": "test"},
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "mock"
    assert body["content"] == "Mock answer."
    assert body["usage"]["total_tokens"] > 0


def test_streaming_chat_completion_returns_sse() -> None:
    with make_client() as client:
        with client.stream(
            "POST",
            "/api/v1/chat/completions",
            json={
                "model": "mock-chat",
                "messages": [{"role": "user", "content": "Hello"}],
                "stream": True,
            },
        ) as response:
            body = response.read().decode("utf-8")

    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]
    assert "data:" in body
    assert "Mock" in body
    assert body.strip().endswith("data: [DONE]")


def test_embeddings_uses_mock_provider() -> None:
    with make_client() as client:
        response = client.post(
            "/api/v1/embeddings",
            json={"model": "mock-embedding", "input": ["first", "second"]},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "mock"
    assert body["model"] == "mock-embedding"
    assert len(body["data"]) == 2
    assert len(body["data"][0]["embedding"]) == 8


def test_oidc_auth_mode_requires_bearer_token() -> None:
    with make_client({"AKL_AUTH_MODE": "oidc"}) as client:
        response = client.post(
            "/api/v1/embeddings",
            json={"model": "mock-embedding", "input": ["first"]},
        )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"
