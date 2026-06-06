from __future__ import annotations

from tests.conftest import make_client


def test_providers_endpoint_reports_mock_active_provider() -> None:
    with make_client() as client:
        response = client.get("/api/v1/providers")

    assert response.status_code == 200
    body = response.json()
    assert body["active_provider"] == "mock"
    providers = {provider["name"]: provider for provider in body["providers"]}
    assert providers["mock"]["enabled"] is True
    assert providers["mock"]["active"] is True
    assert providers["mock"]["available"] is True
    assert providers["mock"]["supports_chat"] is True
    assert providers["mock"]["supports_embeddings"] is True


def test_recommended_models_endpoint_returns_current_local_defaults() -> None:
    with make_client() as client:
        response = client.get("/api/v1/models/recommended")

    assert response.status_code == 200
    body = response.json()
    assert body["chat_models"][0]["name"] == "gemma4:12b"
    assert any(model["name"] == "bge-m3" for model in body["embedding_models"])


def test_effective_config_does_not_expose_openai_api_key() -> None:
    with make_client({"AKL_OPENAI_COMPAT_API_KEY": "secret-key"}) as client:
        response = client.get("/api/v1/config/effective")

    assert response.status_code == 200
    body = response.json()
    assert body["active_provider"] == "mock"
    assert body["openai_api_key_configured"] is True
    assert "secret-key" not in response.text


def test_model_pull_returns_unsupported_for_mock_provider() -> None:
    with make_client() as client:
        response = client.post(
            "/api/v1/models/pull",
            json={"model": "gemma4:12b", "kind": "chat"},
        )

    assert response.status_code == 200
    assert response.json()["status"] == "unsupported"
    assert response.json()["provider"] == "mock"


def test_model_manager_chat_test_uses_default_mock_chat_model() -> None:
    with make_client({"AKL_LLM_DEFAULT_CHAT_MODEL": "mock-chat"}) as client:
        response = client.post(
            "/api/v1/models/test-chat",
            json={"prompt": "Do not log this prompt.", "think": False, "max_tokens": 256},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "mock"
    assert body["model"] == "mock-chat"
    assert body["content"] == "Mock answer."


def test_chat_completion_accepts_think_and_max_tokens() -> None:
    with make_client() as client:
        response = client.post(
            "/api/v1/chat/completions",
            json={
                "model": "mock-chat",
                "messages": [{"role": "user", "content": "Hello"}],
                "think": False,
                "max_tokens": 256,
            },
        )

    assert response.status_code == 200
    assert response.json()["provider"] == "mock"


def test_model_manager_embedding_test_uses_default_mock_embedding_model() -> None:
    with make_client({"AKL_LLM_DEFAULT_EMBEDDING_MODEL": "mock-embedding"}) as client:
        response = client.post(
            "/api/v1/models/test-embedding",
            json={"input": "Do not log this embedding input."},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "mock"
    assert body["model"] == "mock-embedding"
    assert len(body["data"][0]["embedding"]) == 8
