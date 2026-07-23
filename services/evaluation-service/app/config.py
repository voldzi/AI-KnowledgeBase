from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping


class ConfigError(ValueError):
    """Raised when environment configuration is invalid."""


CLIENT_MODES = {"mock", "http"}
AUTH_MODES = {"disabled", "bearer", "mock", "oidc"}


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
    oidc_issuer: str | None
    oidc_audience: str | None
    oidc_jwks_url: str | None
    stratos_auth_me_url: str | None
    stratos_access_timeout_seconds: float
    min_run_token_ttl_seconds: int

    rag_client_mode: str
    registry_client_mode: str
    rag_base_url: str
    registry_base_url: str

    datasets_dir: str
    seed_datasets_dir: str | None
    reports_dir: str
    service_actor_id: str

    request_timeout_seconds: float
    retry_attempts: int
    retry_backoff_seconds: float
    max_cases_per_run: int
    concurrency: int
    pass_threshold: float
    answer_excerpt_chars: int
    audit_enabled: bool
    gate_retrieval_recall_min: float
    gate_retrieval_ndcg_min: float
    gate_false_zero_result_rate_max: float
    gate_authorization_leak_rate_max: float
    gate_citation_traceability_min: float
    gate_retrieval_latency_p95_ms_max: float
    gate_retrieval_recall_at_50_min: float
    gate_supported_claim_rate_min: float
    gate_false_answer_rate_max: float
    gate_router_accuracy_min: float


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
        concurrency = int(_get(source, "AKL_EVAL_CONCURRENCY", "4"))
        pass_threshold = float(_get(source, "AKL_EVAL_PASS_THRESHOLD", "0.75"))
        answer_excerpt_chars = int(_get(source, "AKL_EVAL_ANSWER_EXCERPT_CHARS", "500"))
        gate_retrieval_recall_min = float(_get(source, "AKL_EVAL_GATE_RETRIEVAL_RECALL_MIN", "0.95"))
        gate_retrieval_ndcg_min = float(_get(source, "AKL_EVAL_GATE_RETRIEVAL_NDCG_MIN", "0.85"))
        gate_false_zero_result_rate_max = float(
            _get(source, "AKL_EVAL_GATE_FALSE_ZERO_RESULT_RATE_MAX", "0.02")
        )
        gate_authorization_leak_rate_max = float(
            _get(source, "AKL_EVAL_GATE_AUTHORIZATION_LEAK_RATE_MAX", "0")
        )
        gate_citation_traceability_min = float(
            _get(source, "AKL_EVAL_GATE_CITATION_TRACEABILITY_MIN", "1")
        )
        gate_retrieval_latency_p95_ms_max = float(
            _get(source, "AKL_EVAL_GATE_RETRIEVAL_LATENCY_P95_MS_MAX", "3000")
        )
        gate_retrieval_recall_at_50_min = float(
            _get(source, "AKL_EVAL_GATE_RETRIEVAL_RECALL_AT_50_MIN", "0.98")
        )
        gate_supported_claim_rate_min = float(
            _get(source, "AKL_EVAL_GATE_SUPPORTED_CLAIM_RATE_MIN", "0.98")
        )
        gate_false_answer_rate_max = float(
            _get(source, "AKL_EVAL_GATE_FALSE_ANSWER_RATE_MAX", "0.02")
        )
        gate_router_accuracy_min = float(
            _get(source, "AKL_EVAL_GATE_ROUTER_ACCURACY_MIN", "0.95")
        )
        stratos_access_timeout_seconds = float(
            _get(source, "AKL_STRATOS_ACCESS_TIMEOUT_SECONDS", "3")
        )
        min_run_token_ttl_seconds = int(
            _get(source, "AKL_EVAL_MIN_RUN_TOKEN_TTL_SECONDS", "240")
        )
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
    if concurrency <= 0 or concurrency > 32:
        raise ConfigError("AKL_EVAL_CONCURRENCY must be between 1 and 32")
    if not 0 <= pass_threshold <= 1:
        raise ConfigError("AKL_EVAL_PASS_THRESHOLD must be between 0 and 1")
    if answer_excerpt_chars < 0 or answer_excerpt_chars > 4000:
        raise ConfigError("AKL_EVAL_ANSWER_EXCERPT_CHARS must be between 0 and 4000")
    unit_interval_values = {
        "AKL_EVAL_GATE_RETRIEVAL_RECALL_MIN": gate_retrieval_recall_min,
        "AKL_EVAL_GATE_RETRIEVAL_NDCG_MIN": gate_retrieval_ndcg_min,
        "AKL_EVAL_GATE_FALSE_ZERO_RESULT_RATE_MAX": gate_false_zero_result_rate_max,
        "AKL_EVAL_GATE_AUTHORIZATION_LEAK_RATE_MAX": gate_authorization_leak_rate_max,
        "AKL_EVAL_GATE_CITATION_TRACEABILITY_MIN": gate_citation_traceability_min,
        "AKL_EVAL_GATE_RETRIEVAL_RECALL_AT_50_MIN": gate_retrieval_recall_at_50_min,
        "AKL_EVAL_GATE_SUPPORTED_CLAIM_RATE_MIN": gate_supported_claim_rate_min,
        "AKL_EVAL_GATE_FALSE_ANSWER_RATE_MAX": gate_false_answer_rate_max,
        "AKL_EVAL_GATE_ROUTER_ACCURACY_MIN": gate_router_accuracy_min,
    }
    for key, value in unit_interval_values.items():
        if not 0 <= value <= 1:
            raise ConfigError(f"{key} must be between 0 and 1")
    if gate_retrieval_latency_p95_ms_max <= 0:
        raise ConfigError("AKL_EVAL_GATE_RETRIEVAL_LATENCY_P95_MS_MAX must be greater than zero")
    if stratos_access_timeout_seconds <= 0:
        raise ConfigError("AKL_STRATOS_ACCESS_TIMEOUT_SECONDS must be greater than zero")
    if min_run_token_ttl_seconds < 0 or min_run_token_ttl_seconds > 3600:
        raise ConfigError("AKL_EVAL_MIN_RUN_TOKEN_TTL_SECONDS must be between 0 and 3600")

    audit_enabled = _parse_bool(_get(source, "AKL_EVAL_AUDIT_ENABLED", "true"))
    oidc_issuer = source.get("AKL_OIDC_ISSUER") or None
    oidc_audience = source.get("AKL_OIDC_AUDIENCE") or None
    oidc_jwks_url = source.get("AKL_OIDC_JWKS_URL") or None
    stratos_auth_me_url = source.get("AKL_STRATOS_AUTH_ME_URL") or None
    if auth_mode == "oidc" and not all([oidc_issuer, oidc_audience, oidc_jwks_url, stratos_auth_me_url]):
        raise ConfigError(
            "AKL_AUTH_MODE=oidc requires AKL_OIDC_ISSUER, AKL_OIDC_AUDIENCE, "
            "AKL_OIDC_JWKS_URL, and AKL_STRATOS_AUTH_ME_URL"
        )

    if env_name == "production":
        if auth_mode not in {"bearer", "oidc"}:
            raise ConfigError("Production requires AKL_AUTH_MODE=bearer or oidc")
        if auth_mode == "bearer" and not service_token:
            raise ConfigError("Production bearer auth requires AKL_SERVICE_TOKEN")
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
        oidc_issuer=oidc_issuer,
        oidc_audience=oidc_audience,
        oidc_jwks_url=oidc_jwks_url,
        stratos_auth_me_url=stratos_auth_me_url,
        stratos_access_timeout_seconds=stratos_access_timeout_seconds,
        min_run_token_ttl_seconds=min_run_token_ttl_seconds,
        rag_client_mode=rag_client_mode,
        registry_client_mode=registry_client_mode,
        rag_base_url=_get(source, "AKL_RAG_BASE_URL", "http://localhost:8002/api/v1").rstrip("/"),
        registry_base_url=_get(source, "AKL_REGISTRY_BASE_URL", "http://localhost:8001/api/v1").rstrip("/"),
        datasets_dir=_get(source, "AKL_EVAL_DATASETS_DIR", "datasets"),
        seed_datasets_dir=source.get("AKL_EVAL_SEED_DATASETS_DIR") or None,
        reports_dir=_get(source, "AKL_EVAL_REPORTS_DIR", "reports"),
        service_actor_id=_get(source, "AKL_EVAL_SERVICE_ACTOR_ID", "svc-evaluation"),
        request_timeout_seconds=request_timeout_seconds,
        retry_attempts=retry_attempts,
        retry_backoff_seconds=retry_backoff_seconds,
        max_cases_per_run=max_cases_per_run,
        concurrency=concurrency,
        pass_threshold=pass_threshold,
        answer_excerpt_chars=answer_excerpt_chars,
        audit_enabled=audit_enabled,
        gate_retrieval_recall_min=gate_retrieval_recall_min,
        gate_retrieval_ndcg_min=gate_retrieval_ndcg_min,
        gate_false_zero_result_rate_max=gate_false_zero_result_rate_max,
        gate_authorization_leak_rate_max=gate_authorization_leak_rate_max,
        gate_citation_traceability_min=gate_citation_traceability_min,
        gate_retrieval_latency_p95_ms_max=gate_retrieval_latency_p95_ms_max,
        gate_retrieval_recall_at_50_min=gate_retrieval_recall_at_50_min,
        gate_supported_claim_rate_min=gate_supported_claim_rate_min,
        gate_false_answer_rate_max=gate_false_answer_rate_max,
        gate_router_accuracy_min=gate_router_accuracy_min,
    )
