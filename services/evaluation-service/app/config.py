from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping


class ConfigError(ValueError):
    """Raised when environment configuration is invalid."""


CLIENT_MODES = {"mock", "http"}
AUTH_MODES = {"disabled", "bearer", "mock"}


def _get(env: Mapping[str, str], key: str, default: str) -> str:
    value = env.get(key)
    if value is None or value == "":
        return default
    return value


def _parse_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _client_mode(env: Mapping[str, str], key: str, default: str) -> str:
    mode = _get(env, key, default).strip().lower()
    if mode not in CLIENT_MODES:
        raise ConfigError(f"{key} must be one of: mock, http")
    return mode


@dataclass(frozen=True)
class Settings:
    service_name: str
    service_version: str
    env: str
    log_level: str

    auth_mode: str
    service_token: str | None
    upstream_bearer_token: str | None

    rag_client_mode: str
    registry_client_mode: str
    rag_base_url: str
    registry_base_url: str

    datasets_dir: str
    reports_dir: str
    service_actor_id: str

    request_timeout_seconds: float
    retry_attempts: int
    retry_backoff_seconds: float
    max_cases_per_run: int
    pass_threshold: float
    answer_excerpt_chars: int
    audit_enabled: bool


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    source = os.environ if env is None else env

    env_name = _get(source, "AKL_ENV", "development").strip().lower()
    auth_mode = _get(source, "AKL_AUTH_MODE", "disabled").strip().lower()
    service_token = source.get("AKL_SERVICE_TOKEN") or None
    dependency_mode = _get(source, "AKL_EVAL_DEPENDENCY_MODE", "mock").strip().lower()

    if auth_mode not in AUTH_MODES:
        raise ConfigError("AKL_AUTH_MODE must be one of: disabled, bearer, mock")
    if dependency_mode not in CLIENT_MODES:
        raise ConfigError("AKL_EVAL_DEPENDENCY_MODE must be one of: mock, http")

    rag_client_mode = _client_mode(source, "AKL_EVAL_RAG_CLIENT_MODE", dependency_mode)
    registry_client_mode = _client_mode(source, "AKL_EVAL_REGISTRY_CLIENT_MODE", dependency_mode)

    try:
        request_timeout_seconds = float(_get(source, "AKL_EVAL_REQUEST_TIMEOUT_SECONDS", "30"))
        retry_attempts = int(_get(source, "AKL_EVAL_RETRY_ATTEMPTS", "2"))
        retry_backoff_seconds = float(_get(source, "AKL_EVAL_RETRY_BACKOFF_SECONDS", "0.25"))
        max_cases_per_run = int(_get(source, "AKL_EVAL_MAX_CASES_PER_RUN", "200"))
        pass_threshold = float(_get(source, "AKL_EVAL_PASS_THRESHOLD", "0.75"))
        answer_excerpt_chars = int(_get(source, "AKL_EVAL_ANSWER_EXCERPT_CHARS", "500"))
    except ValueError as exc:
        raise ConfigError("Numeric AKL_EVAL_* configuration value is invalid") from exc

    if request_timeout_seconds <= 0:
        raise ConfigError("AKL_EVAL_REQUEST_TIMEOUT_SECONDS must be greater than zero")
    if retry_attempts < 0:
        raise ConfigError("AKL_EVAL_RETRY_ATTEMPTS must be zero or greater")
    if retry_backoff_seconds < 0:
        raise ConfigError("AKL_EVAL_RETRY_BACKOFF_SECONDS must be zero or greater")
    if max_cases_per_run <= 0 or max_cases_per_run > 1000:
        raise ConfigError("AKL_EVAL_MAX_CASES_PER_RUN must be between 1 and 1000")
    if not 0 <= pass_threshold <= 1:
        raise ConfigError("AKL_EVAL_PASS_THRESHOLD must be between 0 and 1")
    if answer_excerpt_chars < 0 or answer_excerpt_chars > 4000:
        raise ConfigError("AKL_EVAL_ANSWER_EXCERPT_CHARS must be between 0 and 4000")

    audit_enabled = _parse_bool(_get(source, "AKL_EVAL_AUDIT_ENABLED", "true"))
    if env_name == "production":
        if auth_mode != "bearer":
            raise ConfigError("Production requires AKL_AUTH_MODE=bearer")
        if not service_token:
            raise ConfigError("Production requires AKL_SERVICE_TOKEN")
        if rag_client_mode != "http":
            raise ConfigError("Production requires AKL_EVAL_RAG_CLIENT_MODE=http")
        if audit_enabled and registry_client_mode != "http":
            raise ConfigError("Production audit requires AKL_EVAL_REGISTRY_CLIENT_MODE=http")

    return Settings(
        service_name=_get(source, "AKL_SERVICE_NAME", "evaluation-service"),
        service_version=_get(source, "AKL_SERVICE_VERSION", "dev"),
        env=env_name,
        log_level=_get(source, "AKL_LOG_LEVEL", "INFO").upper(),
        auth_mode=auth_mode,
        service_token=service_token,
        upstream_bearer_token=source.get("AKL_UPSTREAM_BEARER_TOKEN") or None,
        rag_client_mode=rag_client_mode,
        registry_client_mode=registry_client_mode,
        rag_base_url=_get(source, "AKL_RAG_BASE_URL", "http://localhost:8002/api/v1").rstrip("/"),
        registry_base_url=_get(source, "AKL_REGISTRY_BASE_URL", "http://localhost:8001/api/v1").rstrip("/"),
        datasets_dir=_get(source, "AKL_EVAL_DATASETS_DIR", "datasets"),
        reports_dir=_get(source, "AKL_EVAL_REPORTS_DIR", "reports"),
        service_actor_id=_get(source, "AKL_EVAL_SERVICE_ACTOR_ID", "svc-evaluation"),
        request_timeout_seconds=request_timeout_seconds,
        retry_attempts=retry_attempts,
        retry_backoff_seconds=retry_backoff_seconds,
        max_cases_per_run=max_cases_per_run,
        pass_threshold=pass_threshold,
        answer_excerpt_chars=answer_excerpt_chars,
        audit_enabled=audit_enabled,
    )
