from __future__ import annotations

import pytest

import providers.ollama as ollama_module
from app.config import load_settings
from app.errors import GatewayError
from app.schemas import ChatCompletionRequest, EmbeddingsRequest
from providers.ollama import OllamaProvider


def ollama_settings(**overrides: str):
    env = {
        "AKL_ENV": "test",
        "AKL_AUTH_MODE": "disabled",
        "AKL_LLM_DEFAULT_PROVIDER": "ollama",
        "AKL_LLM_ENABLED_PROVIDERS": "ollama",
        "AKL_LLM_MODEL_PROVIDER_MAP": '{"gemma4:12b-mlx":"ollama"}',
        "AKL_LLM_RETRY_ATTEMPTS": "0",
        "AKL_LLM_DEFAULT_MAX_TOKENS": "512",
        "AKL_OLLAMA_THINK": "false",
    }
    env.update(overrides)
    return load_settings(env)


@pytest.mark.asyncio
async def test_ollama_provider_sends_think_false_and_num_predict(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    async def fake_request_json_with_retry(**kwargs):
        captured.update(kwargs)
        if kwargs["url"].endswith("/api/tags"):
            return {"models": [{"name": "gemma4:12b-mlx"}]}
        return {
            "message": {"content": "Hotovo."},
            "done_reason": "stop",
            "prompt_eval_count": 2,
            "eval_count": 1,
        }

    monkeypatch.setattr(ollama_module, "request_json_with_retry", fake_request_json_with_retry)
    provider = OllamaProvider(ollama_settings())

    response = await provider.chat_completion(
        ChatCompletionRequest(
            model="gemma4:12b-mlx",
            messages=[{"role": "user", "content": "Test"}],
            think=False,
            max_tokens=256,
        )
    )

    payload = captured["json_body"]
    assert payload["think"] is False
    assert payload["options"]["num_predict"] == 256
    assert response.content == "Hotovo."


@pytest.mark.asyncio
async def test_ollama_provider_uses_default_max_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    async def fake_request_json_with_retry(**kwargs):
        captured.update(kwargs)
        if kwargs["url"].endswith("/api/tags"):
            return {"models": [{"name": "gemma4:12b-mlx"}]}
        return {
            "message": {"content": "Hotovo."},
            "done_reason": "stop",
            "prompt_eval_count": 2,
            "eval_count": 1,
        }

    monkeypatch.setattr(ollama_module, "request_json_with_retry", fake_request_json_with_retry)
    provider = OllamaProvider(ollama_settings(AKL_LLM_DEFAULT_MAX_TOKENS="768"))

    await provider.chat_completion(
        ChatCompletionRequest(model="gemma4:12b-mlx", messages=[{"role": "user", "content": "Test"}])
    )

    payload = captured["json_body"]
    assert payload["think"] is False
    assert payload["options"]["num_predict"] == 768


@pytest.mark.asyncio
async def test_ollama_provider_passes_embedding_dimensions(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    async def fake_request_json_with_retry(**kwargs):
        captured.update(kwargs)
        return {"embeddings": [[0.1, 0.2, 0.3]]}

    monkeypatch.setattr(ollama_module, "request_json_with_retry", fake_request_json_with_retry)
    provider = OllamaProvider(ollama_settings())

    response = await provider.embeddings(
        EmbeddingsRequest(model="qwen3-embedding:8b", input=["Test"], dimensions=1024)
    )

    payload = captured["json_body"]
    assert payload == {"model": "qwen3-embedding:8b", "input": ["Test"], "dimensions": 1024}
    assert response.provider == "ollama"


@pytest.mark.asyncio
async def test_ollama_provider_falls_back_to_next_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    probe_timeouts: list[object] = []

    async def fake_request_json_with_retry(**kwargs):
        url = kwargs["url"]
        calls.append(url)
        if url.endswith("/api/tags"):
            probe_timeouts.append(kwargs.get("timeout_seconds"))
        if url.startswith("http://unavailable-ollama:11434"):
            raise GatewayError(
                "LLM_PROVIDER_ERROR",
                "LLM provider is not reachable",
                status_code=502,
                details={"provider": "ollama"},
            )
        if url.endswith("/api/tags"):
            return {"models": [{"name": "gemma4:12b-mlx"}]}
        return {
            "message": {"content": "Hotovo."},
            "done_reason": "stop",
            "prompt_eval_count": 2,
            "eval_count": 1,
        }

    monkeypatch.setattr(ollama_module, "request_json_with_retry", fake_request_json_with_retry)
    provider = OllamaProvider(
        ollama_settings(
            AKL_OLLAMA_BASE_URL="http://unavailable-ollama:11434",
            AKL_OLLAMA_BASE_URLS="http://unavailable-ollama:11434,http://192.168.1.176:11434",
        )
    )

    response = await provider.chat_completion(
        ChatCompletionRequest(model="gemma4:12b-mlx", messages=[{"role": "user", "content": "Test"}])
    )
    second_response = await provider.chat_completion(
        ChatCompletionRequest(model="gemma4:12b-mlx", messages=[{"role": "user", "content": "Test znovu"}])
    )

    assert calls == [
        "http://unavailable-ollama:11434/api/tags",
        "http://192.168.1.176:11434/api/tags",
        "http://192.168.1.176:11434/api/chat",
        "http://192.168.1.176:11434/api/tags",
        "http://192.168.1.176:11434/api/chat",
    ]
    assert probe_timeouts == [3, 3, 3]
    assert response.content == "Hotovo."
    assert second_response.content == "Hotovo."


@pytest.mark.asyncio
async def test_ollama_provider_falls_back_model_across_three_endpoints(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, str | None]] = []

    async def fake_request_json_with_retry(**kwargs):
        url = kwargs["url"]
        payload = kwargs.get("json_body")
        calls.append((url, payload.get("model") if payload else None))
        if url.startswith(("http://primary:11434", "http://tertiary:11434")):
            raise GatewayError(
                "LLM_PROVIDER_ERROR",
                "LLM provider is not reachable",
                status_code=502,
                details={"provider": "ollama"},
            )
        if url.endswith("/api/tags"):
            return {"models": [{"name": "gemma4:12b-mlx"}, {"name": "bge-m3"}]}
        return {
            "message": {"content": "Fallback funguje."},
            "done_reason": "stop",
            "prompt_eval_count": 2,
            "eval_count": 2,
        }

    monkeypatch.setattr(ollama_module, "request_json_with_retry", fake_request_json_with_retry)
    provider = OllamaProvider(
        ollama_settings(
            AKL_OLLAMA_BASE_URL="http://primary:11434",
            AKL_OLLAMA_BASE_URLS=(
                "http://primary:11434,http://secondary:11434,http://tertiary:11434"
            ),
            AKL_LLM_CHAT_MODEL_FALLBACKS=(
                '{"gemma4:31b-mlx":["gemma4:12b-mlx"]}'
            ),
        )
    )

    response = await provider.chat_completion(
        ChatCompletionRequest(
            model="gemma4:31b-mlx",
            messages=[{"role": "user", "content": "Test"}],
        )
    )

    assert response.model == "gemma4:12b-mlx"
    assert response.content == "Fallback funguje."
    assert calls == [
        ("http://primary:11434/api/tags", None),
        ("http://secondary:11434/api/tags", None),
        ("http://tertiary:11434/api/tags", None),
        ("http://secondary:11434/api/chat", "gemma4:12b-mlx"),
    ]


@pytest.mark.asyncio
async def test_ollama_provider_reselects_after_cached_endpoint_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []
    primary_available = True

    async def fake_request_json_with_retry(**kwargs):
        url = kwargs["url"]
        calls.append(url)
        if url.startswith("http://primary-ollama:11434") and not primary_available:
            raise GatewayError(
                "LLM_PROVIDER_ERROR",
                "LLM provider is not reachable",
                status_code=502,
                details={"provider": "ollama"},
            )
        return {"models": [{"name": "gemma4:12b-mlx"}]}

    monkeypatch.setattr(ollama_module, "request_json_with_retry", fake_request_json_with_retry)
    provider = OllamaProvider(
        ollama_settings(
            AKL_OLLAMA_BASE_URL="http://primary-ollama:11434",
            AKL_OLLAMA_BASE_URLS=(
                "http://primary-ollama:11434,http://secondary-ollama:11434"
            ),
        )
    )

    assert await provider.ready() is True
    primary_available = False
    assert await provider.ready() is True
    assert await provider.ready() is True

    assert calls == [
        "http://primary-ollama:11434/api/tags",
        "http://primary-ollama:11434/api/tags",
        "http://secondary-ollama:11434/api/tags",
        "http://secondary-ollama:11434/api/tags",
    ]


@pytest.mark.asyncio
async def test_ollama_provider_env_false_overrides_request_think_true(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    async def fake_request_json_with_retry(**kwargs):
        captured.update(kwargs)
        if kwargs["url"].endswith("/api/tags"):
            return {"models": [{"name": "gemma4:12b-mlx"}]}
        return {
            "message": {"content": "Hotovo."},
            "done_reason": "stop",
            "prompt_eval_count": 2,
            "eval_count": 1,
        }

    monkeypatch.setattr(ollama_module, "request_json_with_retry", fake_request_json_with_retry)
    provider = OllamaProvider(ollama_settings(AKL_OLLAMA_THINK="false"))

    await provider.chat_completion(
        ChatCompletionRequest(
            model="gemma4:12b-mlx",
            messages=[{"role": "user", "content": "Test"}],
            think=True,
        )
    )

    assert captured["json_body"]["think"] is False


@pytest.mark.asyncio
async def test_ollama_provider_rejects_thinking_only_empty_content(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_request_json_with_retry(**kwargs):
        if kwargs["url"].endswith("/api/tags"):
            return {"models": [{"name": "gemma4:12b-mlx"}]}
        return {
            "message": {"content": "", "thinking": "internal thinking"},
            "done_reason": "length",
            "prompt_eval_count": 2,
            "eval_count": 256,
        }

    monkeypatch.setattr(ollama_module, "request_json_with_retry", fake_request_json_with_retry)
    provider = OllamaProvider(ollama_settings())

    with pytest.raises(GatewayError) as exc_info:
        await provider.chat_completion(
            ChatCompletionRequest(
                model="gemma4:12b-mlx",
                messages=[{"role": "user", "content": "Test"}],
                think=False,
                max_tokens=256,
            )
        )

    assert exc_info.value.code == "EMPTY_CONTENT_THINKING_ONLY"
    assert exc_info.value.status_code == 502
