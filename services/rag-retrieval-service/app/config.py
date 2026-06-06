from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping


class ConfigError(ValueError):
    """Raised when environment configuration is invalid."""


CLIENT_MODES = {"mock", "http"}
RETRIEVER_MODES = {"mock", "http", "qdrant"}
AUTH_MODES = {"disabled", "bearer", "mock", "oidc"}
AUTHZ_MODES = {"dev", "registry"}


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


def _retriever_mode(env: Mapping[str, str], key: str, default: str) -> str:
    mode = _get(env, key, default).strip().lower()
    if mode not in RETRIEVER_MODES:
        raise ConfigError(f"{key} must be one of: mock, http, qdrant")
    return mode


def _normalize_api_base_url(value: str) -> str:
    normalized = value.rstrip("/")
    if normalized.endswith("/api/v1"):
        return normalized
    return f"{normalized}/api/v1"


@dataclass(frozen=True)
class Settings:
    service_name: str
    service_version: str
    env: str
    log_level: str

    auth_mode: str
    service_token: str | None
    upstream_bearer_token: str | None
    service_account_subject: str
    service_account_roles: tuple[str, ...]

    registry_client_mode: str
    retriever_mode: str
    llm_client_mode: str
    authz_mode: str
    require_citations: bool
    enable_reranking: bool

    registry_base_url: str
    qdrant_base_url: str
    qdrant_collection: str
    llm_gateway_base_url: str

    request_timeout_seconds: float
    retry_attempts: int
    retry_backoff_seconds: float

    default_max_chunks: int
    retrieval_candidate_limit: int
    max_context_chars: int
    answer_max_tokens: int
    hybrid_dense_weight: float
    no_answer_min_score: float
    confidence_high_threshold: float
    confidence_medium_threshold: float

    embedding_model: str
    chat_model: str
    mock_chat_response: str | None
    mock_registry_denied_document_ids: tuple[str, ...]


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    source = os.environ if env is None else env

    env_name = _get(source, "AKL_ENV", "development").strip().lower()
    auth_mode = _get(source, "AKL_AUTH_MODE", "disabled").strip().lower()
    service_token = source.get("AKL_SERVICE_TOKEN") or None
    dependency_mode = _get(source, "AKL_RAG_DEPENDENCY_MODE", "mock").strip().lower()
    authz_mode = _get(source, "AKL_RAG_AUTHZ_MODE", "dev").strip().lower()

    if auth_mode not in AUTH_MODES:
        raise ConfigError("AKL_AUTH_MODE must be one of: disabled, bearer, mock, oidc")
    if dependency_mode not in CLIENT_MODES:
        raise ConfigError("AKL_RAG_DEPENDENCY_MODE must be one of: mock, http")
    if authz_mode not in AUTHZ_MODES:
        raise ConfigError("AKL_RAG_AUTHZ_MODE must be one of: dev, registry")

    registry_default = "http" if authz_mode == "registry" else "mock"
    registry_client_mode = _client_mode(source, "AKL_RAG_REGISTRY_CLIENT_MODE", registry_default)
    retriever_mode = _retriever_mode(source, "AKL_RAG_RETRIEVER_MODE", dependency_mode)
    llm_client_mode = _client_mode(source, "AKL_RAG_LLM_CLIENT_MODE", dependency_mode)

    try:
        request_timeout_seconds = float(_get(source, "AKL_RAG_REQUEST_TIMEOUT_SECONDS", "30"))
        retry_attempts = int(_get(source, "AKL_RAG_RETRY_ATTEMPTS", "2"))
        retry_backoff_seconds = float(_get(source, "AKL_RAG_RETRY_BACKOFF_SECONDS", "0.25"))
        default_max_chunks = int(_get(source, "AKL_RAG_DEFAULT_MAX_CHUNKS", "8"))
        retrieval_candidate_limit = int(
            _get(source, "AKL_RAG_RETRIEVAL_CANDIDATE_LIMIT", str(max(24, default_max_chunks * 3)))
        )
        max_context_chars = int(_get(source, "AKL_RAG_MAX_CONTEXT_CHARS", "12000"))
        answer_max_tokens = int(_get(source, "AKL_RAG_ANSWER_MAX_TOKENS", "512"))
        hybrid_dense_weight = float(_get(source, "AKL_RAG_HYBRID_DENSE_WEIGHT", "0.35"))
        no_answer_min_score = float(_get(source, "AKL_RAG_NO_ANSWER_MIN_SCORE", "0.35"))
        confidence_high_threshold = float(_get(source, "AKL_RAG_CONFIDENCE_HIGH_THRESHOLD", "0.75"))
        confidence_medium_threshold = float(_get(source, "AKL_RAG_CONFIDENCE_MEDIUM_THRESHOLD", "0.5"))
    except ValueError as exc:
        raise ConfigError("Numeric AKL_RAG_* configuration value is invalid") from exc

    if request_timeout_seconds <= 0:
        raise ConfigError("AKL_RAG_REQUEST_TIMEOUT_SECONDS must be greater than zero")
    if retry_attempts < 0:
        raise ConfigError("AKL_RAG_RETRY_ATTEMPTS must be zero or greater")
    if retry_backoff_seconds < 0:
        raise ConfigError("AKL_RAG_RETRY_BACKOFF_SECONDS must be zero or greater")
    if default_max_chunks <= 0 or default_max_chunks > 20:
        raise ConfigError("AKL_RAG_DEFAULT_MAX_CHUNKS must be between 1 and 20")
    if retrieval_candidate_limit < default_max_chunks:
        raise ConfigError("AKL_RAG_RETRIEVAL_CANDIDATE_LIMIT must be at least AKL_RAG_DEFAULT_MAX_CHUNKS")
    if max_context_chars <= 0:
        raise ConfigError("AKL_RAG_MAX_CONTEXT_CHARS must be greater than zero")
    if answer_max_tokens <= 0:
        raise ConfigError("AKL_RAG_ANSWER_MAX_TOKENS must be greater than zero")
    if not 0 <= hybrid_dense_weight <= 1:
        raise ConfigError("AKL_RAG_HYBRID_DENSE_WEIGHT must be between 0 and 1")
    if not 0 <= no_answer_min_score <= 1:
        raise ConfigError("AKL_RAG_NO_ANSWER_MIN_SCORE must be between 0 and 1")
    if confidence_high_threshold < confidence_medium_threshold:
        raise ConfigError("AKL_RAG_CONFIDENCE_HIGH_THRESHOLD must be >= AKL_RAG_CONFIDENCE_MEDIUM_THRESHOLD")

    if env_name == "production":
        if auth_mode not in {"bearer", "oidc"}:
            raise ConfigError("Production requires AKL_AUTH_MODE=bearer or oidc")
        if auth_mode == "bearer" and not service_token:
            raise ConfigError("Production requires AKL_SERVICE_TOKEN")
        if registry_client_mode == "mock" or retriever_mode == "mock" or llm_client_mode == "mock":
            raise ConfigError("Production must use non-mock clients for Registry API, Qdrant, and LLM Gateway")

    denied = tuple(
        item.strip()
        for item in _get(source, "AKL_RAG_MOCK_DENIED_DOCUMENT_IDS", "doc_denied").split(",")
        if item.strip()
    )

    return Settings(
        service_name=_get(source, "AKL_SERVICE_NAME", "rag-retrieval-service"),
        service_version=_get(source, "AKL_SERVICE_VERSION", "dev"),
        env=env_name,
        log_level=_get(source, "AKL_LOG_LEVEL", "INFO").upper(),
        auth_mode=auth_mode,
        service_token=service_token,
        upstream_bearer_token=source.get("AKL_UPSTREAM_BEARER_TOKEN") or None,
        service_account_subject=_get(source, "AKL_SERVICE_ACCOUNT_SUBJECT", "svc-rag"),
        service_account_roles=tuple(
            item.strip()
            for item in _get(source, "AKL_SERVICE_ACCOUNT_ROLES", "service_rag").split(",")
            if item.strip()
        ),
        registry_client_mode=registry_client_mode,
        retriever_mode=retriever_mode,
        llm_client_mode=llm_client_mode,
        authz_mode=authz_mode,
        require_citations=_parse_bool(_get(source, "AKL_RAG_REQUIRE_CITATIONS", "true")),
        enable_reranking=_parse_bool(_get(source, "AKL_RAG_ENABLE_RERANKING", "true")),
        registry_base_url=_normalize_api_base_url(
            _get(source, "AKL_REGISTRY_BASE_URL", "http://localhost:8001/api/v1")
        ),
        qdrant_base_url=_get(source, "AKL_QDRANT_BASE_URL", "http://localhost:6333").rstrip("/"),
        qdrant_collection=_get(source, "AKL_QDRANT_COLLECTION", "akl_document_chunks"),
        llm_gateway_base_url=_normalize_api_base_url(
            _get(source, "AKL_LLM_GATEWAY_BASE_URL", "http://localhost:8080/api/v1")
        ),
        request_timeout_seconds=request_timeout_seconds,
        retry_attempts=retry_attempts,
        retry_backoff_seconds=retry_backoff_seconds,
        default_max_chunks=default_max_chunks,
        retrieval_candidate_limit=retrieval_candidate_limit,
        max_context_chars=max_context_chars,
        answer_max_tokens=answer_max_tokens,
        hybrid_dense_weight=hybrid_dense_weight,
        no_answer_min_score=no_answer_min_score,
        confidence_high_threshold=confidence_high_threshold,
        confidence_medium_threshold=confidence_medium_threshold,
        embedding_model=_get(source, "AKL_RAG_EMBEDDING_MODEL", "mock-embedding"),
        chat_model=_get(source, "AKL_RAG_CHAT_MODEL", "mock-chat"),
        mock_chat_response=source.get("AKL_RAG_MOCK_CHAT_RESPONSE") or None,
        mock_registry_denied_document_ids=denied,
    )
