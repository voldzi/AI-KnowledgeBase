from __future__ import annotations

import pytest

import providers.ollama as ollama_module
from app.config import load_settings
from app.errors import GatewayError
from app.schemas import ChatCompletionRequest
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

    assert calls == [
        "http://unavailable-ollama:11434/api/tags",
        "http://192.168.1.176:11434/api/tags",
        "http://192.168.1.176:11434/api/chat",
    ]
    assert probe_timeouts == [3, 3]
    assert response.content == "Hotovo."


@pytest.mark.asyncio
async def test_ollama_provider_env_false_overrides_request_think_true(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    async def fake_request_json_with_retry(**kwargs):
        captured.update(kwargs)
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
