from app.schemas import ChatCompletionRequest
from providers.openai_compatible import _chat_payload


def test_current_openai_reasoning_model_uses_supported_generation_fields() -> None:
    request = ChatCompletionRequest(
        model="gpt-5.6-luna",
        messages=[{"role": "user", "content": "test"}],
        temperature=0,
        top_p=0.9,
        max_tokens=64,
    )

    payload = _chat_payload(request, stream=False)

    assert payload["max_completion_tokens"] == 64
    assert "max_tokens" not in payload
    assert "temperature" not in payload
    assert "top_p" not in payload


def test_generic_compatible_model_keeps_legacy_generation_fields() -> None:
    request = ChatCompletionRequest(
        model="custom-chat-model",
        messages=[{"role": "user", "content": "test"}],
        temperature=0.2,
        top_p=0.8,
        max_tokens=32,
    )

    payload = _chat_payload(request, stream=False)

    assert payload["max_tokens"] == 32
    assert "max_completion_tokens" not in payload
    assert payload["temperature"] == 0.2
    assert payload["top_p"] == 0.8
