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

    registry_client_mode: str
    rag_client_mode: str
    registry_base_url: str
    rag_base_url: str

    request_timeout_seconds: float
    retry_attempts: int
    retry_backoff_seconds: float

    max_document_chars: int
    max_control_chunks: int
    default_validity_alert_days: int
    confidence_high_threshold: float
    confidence_medium_threshold: float
    mock_registry_denied_document_ids: tuple[str, ...]


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    source = os.environ if env is None else env

    env_name = _get(source, "AKL_ENV", "development").strip().lower()
    auth_mode = _get(source, "AKL_AUTH_MODE", "disabled").strip().lower()
    service_token = source.get("AKL_SERVICE_TOKEN") or None
    dependency_mode = _get(source, "AKL_GOVERNANCE_DEPENDENCY_MODE", "mock").strip().lower()

    if auth_mode not in AUTH_MODES:
        raise ConfigError("AKL_AUTH_MODE must be one of: disabled, bearer, mock")
    if dependency_mode not in CLIENT_MODES:
        raise ConfigError("AKL_GOVERNANCE_DEPENDENCY_MODE must be one of: mock, http")

    registry_client_mode = _client_mode(source, "AKL_GOVERNANCE_REGISTRY_CLIENT_MODE", dependency_mode)
    rag_client_mode = _client_mode(source, "AKL_GOVERNANCE_RAG_CLIENT_MODE", dependency_mode)

    try:
        request_timeout_seconds = float(_get(source, "AKL_GOVERNANCE_REQUEST_TIMEOUT_SECONDS", "30"))
        retry_attempts = int(_get(source, "AKL_GOVERNANCE_RETRY_ATTEMPTS", "2"))
        retry_backoff_seconds = float(_get(source, "AKL_GOVERNANCE_RETRY_BACKOFF_SECONDS", "0.25"))
        max_document_chars = int(_get(source, "AKL_GOVERNANCE_MAX_DOCUMENT_CHARS", "200000"))
        max_control_chunks = int(_get(source, "AKL_GOVERNANCE_MAX_CONTROL_CHUNKS", "12"))
        default_validity_alert_days = int(_get(source, "AKL_GOVERNANCE_DEFAULT_VALIDITY_ALERT_DAYS", "60"))
        confidence_high_threshold = float(_get(source, "AKL_GOVERNANCE_CONFIDENCE_HIGH_THRESHOLD", "0.75"))
        confidence_medium_threshold = float(_get(source, "AKL_GOVERNANCE_CONFIDENCE_MEDIUM_THRESHOLD", "0.5"))
    except ValueError as exc:
        raise ConfigError("Numeric AKL_GOVERNANCE_* configuration value is invalid") from exc

    if request_timeout_seconds <= 0:
        raise ConfigError("AKL_GOVERNANCE_REQUEST_TIMEOUT_SECONDS must be greater than zero")
    if retry_attempts < 0:
        raise ConfigError("AKL_GOVERNANCE_RETRY_ATTEMPTS must be zero or greater")
    if retry_backoff_seconds < 0:
        raise ConfigError("AKL_GOVERNANCE_RETRY_BACKOFF_SECONDS must be zero or greater")
    if max_document_chars < 1000:
        raise ConfigError("AKL_GOVERNANCE_MAX_DOCUMENT_CHARS must be at least 1000")
    if max_control_chunks <= 0 or max_control_chunks > 50:
        raise ConfigError("AKL_GOVERNANCE_MAX_CONTROL_CHUNKS must be between 1 and 50")
    if default_validity_alert_days <= 0 or default_validity_alert_days > 730:
        raise ConfigError("AKL_GOVERNANCE_DEFAULT_VALIDITY_ALERT_DAYS must be between 1 and 730")
    if confidence_high_threshold < confidence_medium_threshold:
        raise ConfigError(
            "AKL_GOVERNANCE_CONFIDENCE_HIGH_THRESHOLD must be >= "
            "AKL_GOVERNANCE_CONFIDENCE_MEDIUM_THRESHOLD"
        )

    if env_name == "production":
        if auth_mode != "bearer":
            raise ConfigError("Production requires AKL_AUTH_MODE=bearer")
        if not service_token:
            raise ConfigError("Production requires AKL_SERVICE_TOKEN")
        if registry_client_mode != "http" or rag_client_mode != "http":
            raise ConfigError("Production must use http clients for Registry API and RAG Retrieval Service")

    denied = tuple(
        item.strip()
        for item in _get(source, "AKL_GOVERNANCE_MOCK_DENIED_DOCUMENT_IDS", "doc_denied").split(",")
        if item.strip()
    )

    return Settings(
        service_name=_get(source, "AKL_SERVICE_NAME", "governance-service"),
        service_version=_get(source, "AKL_SERVICE_VERSION", "dev"),
        env=env_name,
        log_level=_get(source, "AKL_LOG_LEVEL", "INFO").upper(),
        auth_mode=auth_mode,
        service_token=service_token,
        upstream_bearer_token=source.get("AKL_UPSTREAM_BEARER_TOKEN") or None,
        registry_client_mode=registry_client_mode,
        rag_client_mode=rag_client_mode,
        registry_base_url=_get(source, "AKL_REGISTRY_BASE_URL", "http://localhost:8001/api/v1").rstrip("/"),
        rag_base_url=_get(source, "AKL_RAG_BASE_URL", "http://localhost:8082/api/v1").rstrip("/"),
        request_timeout_seconds=request_timeout_seconds,
        retry_attempts=retry_attempts,
        retry_backoff_seconds=retry_backoff_seconds,
        max_document_chars=max_document_chars,
        max_control_chunks=max_control_chunks,
        default_validity_alert_days=default_validity_alert_days,
        confidence_high_threshold=confidence_high_threshold,
        confidence_medium_threshold=confidence_medium_threshold,
        mock_registry_denied_document_ids=denied,
    )
