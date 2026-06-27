from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Mapping

KNOWN_PROVIDERS = {"mock", "ollama", "openai"}


class ConfigError(ValueError):
    """Raised when environment configuration is invalid."""


def _get(env: Mapping[str, str], key: str, default: str) -> str:
    value = env.get(key)
    if value is not None and value != "":
        return value
    return default


def _parse_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _parse_csv(value: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in value.split(",") if item.strip())


def _dedupe(values: tuple[str, ...]) -> tuple[str, ...]:
    seen: set[str] = set()
    deduped: list[str] = []
    for value in values:
        if value not in seen:
            deduped.append(value)
            seen.add(value)
    return tuple(deduped)


def _parse_model_map(value: str) -> dict[str, str]:
    try:
        raw = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ConfigError("AKL_LLM_MODEL_PROVIDER_MAP must be a JSON object") from exc

    if not isinstance(raw, dict):
        raise ConfigError("AKL_LLM_MODEL_PROVIDER_MAP must be a JSON object")

    parsed: dict[str, str] = {}
    for model, provider in raw.items():
        if not isinstance(model, str) or not isinstance(provider, str):
            raise ConfigError("AKL_LLM_MODEL_PROVIDER_MAP keys and values must be strings")
        normalized = provider.strip().lower()
        if normalized not in KNOWN_PROVIDERS:
            raise ConfigError(f"Unknown provider '{provider}' in AKL_LLM_MODEL_PROVIDER_MAP")
        parsed[model] = normalized
    return parsed


@dataclass(frozen=True)
class Settings:
    service_name: str
    service_version: str
    env: str
    log_level: str

    auth_mode: str
    service_token: str | None

    default_provider: str
    enabled_providers: tuple[str, ...]
    model_provider_map: dict[str, str]
    default_chat_model: str
    default_embedding_model: str
    default_max_tokens: int
    allow_model_pull: bool
    allow_model_delete: bool
    model_pull_timeout_seconds: float

    request_timeout_seconds: float
    retry_attempts: int
    retry_backoff_seconds: float

    rate_limit_enabled: bool
    rate_limit_per_minute: int

    mock_chat_response: str
    mock_embedding_dimensions: int

    ollama_base_url: str
    ollama_base_urls: tuple[str, ...]
    ollama_endpoint_timeout_seconds: float
    ollama_think: bool
    openai_base_url: str
    openai_api_key: str | None


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    source = os.environ if env is None else env

    default_provider = _get(source, "AKL_LLM_DEFAULT_PROVIDER", "mock").strip().lower()
    enabled_providers = _parse_csv(_get(source, "AKL_LLM_ENABLED_PROVIDERS", default_provider))
    model_provider_map = _parse_model_map(_get(source, "AKL_LLM_MODEL_PROVIDER_MAP", "{}"))
    default_chat_model = _get(source, "AKL_LLM_DEFAULT_CHAT_MODEL", "gemma4:12b")
    default_embedding_model = _get(source, "AKL_LLM_DEFAULT_EMBEDDING_MODEL", "bge-m3")
    env_name = _get(source, "AKL_ENV", "development").strip().lower()
    auth_mode = _get(source, "AKL_AUTH_MODE", "disabled").strip().lower()
    service_token = source.get("AKL_SERVICE_TOKEN") or None

    if default_provider not in KNOWN_PROVIDERS:
        raise ConfigError(f"Unknown AKL_LLM_DEFAULT_PROVIDER '{default_provider}'")

    unknown_enabled = sorted(set(enabled_providers) - KNOWN_PROVIDERS)
    if unknown_enabled:
        raise ConfigError(f"Unknown provider(s) in AKL_LLM_ENABLED_PROVIDERS: {', '.join(unknown_enabled)}")

    if default_provider not in enabled_providers:
        raise ConfigError("AKL_LLM_DEFAULT_PROVIDER must be listed in AKL_LLM_ENABLED_PROVIDERS")

    missing_mapped = sorted(set(model_provider_map.values()) - set(enabled_providers))
    if missing_mapped:
        raise ConfigError(
            "Providers referenced by AKL_LLM_MODEL_PROVIDER_MAP must be enabled: "
            + ", ".join(missing_mapped)
        )

    if auth_mode not in {"disabled", "bearer", "mock", "oidc"}:
        raise ConfigError("AKL_AUTH_MODE must be one of: disabled, bearer, mock, oidc")

    if env_name == "production":
        if auth_mode not in {"bearer", "oidc"}:
            raise ConfigError("Production requires AKL_AUTH_MODE=bearer or oidc")
        if auth_mode == "bearer" and not service_token:
            raise ConfigError("Production requires AKL_SERVICE_TOKEN")
        if "mock" in enabled_providers:
            raise ConfigError("Production must not enable the mock LLM provider")

    try:
        request_timeout_seconds = float(_get(source, "AKL_LLM_REQUEST_TIMEOUT_SECONDS", "30"))
        retry_attempts = int(_get(source, "AKL_LLM_RETRY_ATTEMPTS", "2"))
        retry_backoff_seconds = float(_get(source, "AKL_LLM_RETRY_BACKOFF_SECONDS", "0.25"))
        ollama_endpoint_timeout_seconds = float(_get(source, "AKL_OLLAMA_ENDPOINT_TIMEOUT_SECONDS", "3"))
        model_pull_timeout_seconds = float(_get(source, "AKL_LLM_MODEL_PULL_TIMEOUT_SECONDS", "1800"))
        rate_limit_per_minute = int(_get(source, "AKL_RATE_LIMIT_PER_MINUTE", "120"))
        mock_embedding_dimensions = int(_get(source, "AKL_MOCK_EMBEDDING_DIMENSIONS", "8"))
        default_max_tokens = int(_get(source, "AKL_LLM_DEFAULT_MAX_TOKENS", "512"))
    except ValueError as exc:
        raise ConfigError("Numeric AKL_* configuration value is invalid") from exc

    if request_timeout_seconds <= 0:
        raise ConfigError("AKL_LLM_REQUEST_TIMEOUT_SECONDS must be greater than zero")
    if retry_attempts < 0:
        raise ConfigError("AKL_LLM_RETRY_ATTEMPTS must be zero or greater")
    if retry_backoff_seconds < 0:
        raise ConfigError("AKL_LLM_RETRY_BACKOFF_SECONDS must be zero or greater")
    if ollama_endpoint_timeout_seconds <= 0:
        raise ConfigError("AKL_OLLAMA_ENDPOINT_TIMEOUT_SECONDS must be greater than zero")
    if model_pull_timeout_seconds <= 0:
        raise ConfigError("AKL_LLM_MODEL_PULL_TIMEOUT_SECONDS must be greater than zero")
    if rate_limit_per_minute <= 0:
        raise ConfigError("AKL_RATE_LIMIT_PER_MINUTE must be greater than zero")
    if mock_embedding_dimensions <= 0:
        raise ConfigError("AKL_MOCK_EMBEDDING_DIMENSIONS must be greater than zero")
    if default_max_tokens <= 0:
        raise ConfigError("AKL_LLM_DEFAULT_MAX_TOKENS must be greater than zero")

    ollama_base_url = _get(source, "AKL_OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
    configured_ollama_base_urls = _parse_csv(_get(source, "AKL_OLLAMA_BASE_URLS", ollama_base_url))
    ollama_base_urls = _dedupe(tuple(url.rstrip("/") for url in configured_ollama_base_urls))
    if not ollama_base_urls:
        raise ConfigError("AKL_OLLAMA_BASE_URLS must contain at least one URL when set")

    return Settings(
        service_name=_get(source, "AKL_SERVICE_NAME", "llm-gateway-service"),
        service_version=_get(source, "AKL_SERVICE_VERSION", "dev"),
        env=env_name,
        log_level=_get(source, "AKL_LOG_LEVEL", "INFO").upper(),
        auth_mode=auth_mode,
        service_token=service_token,
        default_provider=default_provider,
        enabled_providers=enabled_providers,
        model_provider_map=model_provider_map,
        default_chat_model=default_chat_model,
        default_embedding_model=default_embedding_model,
        default_max_tokens=default_max_tokens,
        allow_model_pull=_parse_bool(_get(source, "AKL_LLM_ALLOW_MODEL_PULL", "false")),
        allow_model_delete=_parse_bool(_get(source, "AKL_LLM_ALLOW_MODEL_DELETE", "false")),
        model_pull_timeout_seconds=model_pull_timeout_seconds,
        request_timeout_seconds=request_timeout_seconds,
        retry_attempts=retry_attempts,
        retry_backoff_seconds=retry_backoff_seconds,
        rate_limit_enabled=_parse_bool(_get(source, "AKL_RATE_LIMIT_ENABLED", "false")),
        rate_limit_per_minute=rate_limit_per_minute,
        mock_chat_response=_get(
            source,
            "AKL_MOCK_CHAT_RESPONSE",
            "Mock response generated by LLM Gateway.",
        ),
        mock_embedding_dimensions=mock_embedding_dimensions,
        ollama_base_url=ollama_base_url,
        ollama_base_urls=ollama_base_urls,
        ollama_endpoint_timeout_seconds=ollama_endpoint_timeout_seconds,
        ollama_think=_parse_bool(_get(source, "AKL_OLLAMA_THINK", "false")),
        openai_base_url=_get(source, "AKL_OPENAI_COMPAT_BASE_URL", "http://localhost:8000").rstrip("/"),
        openai_api_key=source.get("AKL_OPENAI_COMPAT_API_KEY") or None,
    )
