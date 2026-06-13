from __future__ import annotations

import pytest

from app.config import ConfigError, load_settings


def test_model_provider_map_is_parsed() -> None:
    settings = load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "disabled",
            "AKL_LLM_DEFAULT_PROVIDER": "mock",
            "AKL_LLM_ENABLED_PROVIDERS": "mock,ollama",
            "AKL_LLM_MODEL_PROVIDER_MAP": '{"bge-m3":"ollama"}',
        }
    )

    assert settings.model_provider_map == {"bge-m3": "ollama"}


def test_ollama_non_mock_profile_can_be_enabled() -> None:
    settings = load_settings(
        {
            "AKL_ENV": "development",
            "AKL_AUTH_MODE": "mock",
            "AKL_LLM_DEFAULT_PROVIDER": "ollama",
            "AKL_LLM_ENABLED_PROVIDERS": "ollama",
            "AKL_LLM_MODEL_PROVIDER_MAP": '{"gemma4:12b":"ollama","bge-m3":"ollama"}',
            "AKL_OLLAMA_BASE_URL": "http://ollama:11434",
        }
    )

    assert settings.default_provider == "ollama"
    assert settings.enabled_providers == ("ollama",)
    assert "mock" not in settings.enabled_providers
    assert settings.default_chat_model == "gemma4:12b"
    assert settings.default_embedding_model == "bge-m3"
    assert settings.default_max_tokens == 512
    assert settings.ollama_think is False


def test_current_ollama_profile_uses_explicit_akl_env_names() -> None:
    settings = load_settings(
        {
            "AKL_ENV": "development",
            "AKL_AUTH_MODE": "mock",
            "AKL_LLM_DEFAULT_PROVIDER": "ollama",
            "AKL_LLM_ENABLED_PROVIDERS": "ollama",
            "AKL_LLM_DEFAULT_CHAT_MODEL": "qwen2.5:14b",
            "AKL_LLM_DEFAULT_EMBEDDING_MODEL": "bge-m3",
            "AKL_LLM_ALLOW_MODEL_PULL": "true",
            "AKL_OLLAMA_BASE_URL": "http://host.docker.internal:11434",
            "AKL_LLM_DEFAULT_MAX_TOKENS": "256",
            "AKL_OLLAMA_THINK": "true",
        }
    )

    assert settings.default_provider == "ollama"
    assert settings.default_chat_model == "qwen2.5:14b"
    assert settings.default_embedding_model == "bge-m3"
    assert settings.default_max_tokens == 256
    assert settings.allow_model_pull is True
    assert settings.ollama_base_url == "http://host.docker.internal:11434"
    assert settings.ollama_base_urls == ("http://host.docker.internal:11434",)
    assert settings.ollama_think is True


def test_ollama_base_urls_are_parsed_and_deduplicated() -> None:
    settings = load_settings(
        {
            "AKL_ENV": "development",
            "AKL_AUTH_MODE": "mock",
            "AKL_LLM_DEFAULT_PROVIDER": "ollama",
            "AKL_LLM_ENABLED_PROVIDERS": "ollama",
            "AKL_OLLAMA_BASE_URL": "http://host.docker.internal:11434",
            "AKL_OLLAMA_BASE_URLS": (
                "http://host.docker.internal:11434,"
                "http://192.168.1.176:11434,"
                "http://192.168.1.176:11434/"
            ),
        }
    )

    assert settings.ollama_base_url == "http://host.docker.internal:11434"
    assert settings.ollama_base_urls == (
        "http://host.docker.internal:11434",
        "http://192.168.1.176:11434",
    )


def test_production_rejects_mock_provider() -> None:
    with pytest.raises(ConfigError):
        load_settings(
            {
                "AKL_ENV": "production",
                "AKL_AUTH_MODE": "bearer",
                "AKL_SERVICE_TOKEN": "secret",
                "AKL_LLM_DEFAULT_PROVIDER": "mock",
                "AKL_LLM_ENABLED_PROVIDERS": "mock",
            }
        )


def test_production_requires_bearer_auth() -> None:
    with pytest.raises(ConfigError):
        load_settings(
            {
                "AKL_ENV": "production",
                "AKL_AUTH_MODE": "disabled",
                "AKL_LLM_DEFAULT_PROVIDER": "openai",
                "AKL_LLM_ENABLED_PROVIDERS": "openai",
            }
        )
