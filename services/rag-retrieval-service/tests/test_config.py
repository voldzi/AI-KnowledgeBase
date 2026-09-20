from __future__ import annotations

import pytest

from app.config import ConfigError, load_settings


def test_load_settings_defaults_to_mock_clients_for_development() -> None:
    settings = load_settings({"AKL_ENV": "development", "AKL_AUTH_MODE": "disabled"})

    assert settings.service_name == "rag-retrieval-service"
    assert settings.registry_client_mode == "mock"
    assert settings.retriever_mode == "mock"
    assert settings.llm_client_mode == "mock"
    assert settings.max_context_chars == 20000
    assert settings.answer_max_tokens == 1536
    assert settings.source_context_window == 1
    assert settings.assistant_history_max_user_messages == 12
    assert settings.assistant_history_max_message_chars == 800
    assert settings.assistant_history_max_chars == 6000
    assert settings.llm_request_timeout_seconds == 100
    assert settings.llm_retry_attempts == 0
    assert settings.evidence_verifier_timeout_seconds == 120
    assert settings.evidence_verifier_local_max_tokens == 4096
    assert settings.model_routing_mode == "cost_optimized"
    assert settings.external_complexity_threshold == 3
    assert settings.external_premium_complexity_threshold == 8


def test_production_rejects_mock_clients() -> None:
    with pytest.raises(ConfigError, match="Production must use non-mock clients"):
        load_settings(
            {
                "AKL_ENV": "production",
                "AKL_AUTH_MODE": "bearer",
                "AKL_SERVICE_TOKEN": "token",
                "AKL_RAG_DEPENDENCY_MODE": "mock",
            }
        )


def _production_env() -> dict[str, str]:
    return {
        "AKL_ENV": "production",
        "AKL_AUTH_MODE": "oidc",
        "AKL_OIDC_ISSUER": "https://login.example/realms/stratos",
        "AKL_OIDC_AUDIENCE": "akl-api",
        "AKL_OIDC_JWKS_URL": "https://login.example/realms/stratos/certs",
        "AKL_RAG_USER_OIDC_AUDIENCE": "akl-api",
        "AKL_TRUSTED_SERVICE_CLIENT_IDS": "akb-rag-service",
        "AKL_RAG_DEPENDENCY_MODE": "http",
        "AKL_RAG_AUTHZ_MODE": "registry",
    }


def test_production_allows_no_trusted_service_clients() -> None:
    values = _production_env()
    values["AKL_TRUSTED_SERVICE_CLIENT_IDS"] = ""
    settings = load_settings(values)
    assert settings.trusted_service_client_ids == ()


def test_production_requires_user_audience_allowlist() -> None:
    values = _production_env()
    values["AKL_RAG_USER_OIDC_AUDIENCE"] = ""
    with pytest.raises(ConfigError, match="AKL_RAG_USER_OIDC_AUDIENCE"):
        load_settings(values)


def test_invalid_threshold_is_rejected() -> None:
    with pytest.raises(ConfigError, match="AKL_RAG_NO_ANSWER_MIN_SCORE"):
        load_settings({"AKL_RAG_NO_ANSWER_MIN_SCORE": "2"})


def test_invalid_answer_max_tokens_is_rejected() -> None:
    with pytest.raises(ConfigError, match="AKL_RAG_ANSWER_MAX_TOKENS"):
        load_settings({"AKL_RAG_ANSWER_MAX_TOKENS": "0"})


def test_evidence_repair_mode_is_supported_and_unknown_mode_is_rejected() -> None:
    assert load_settings({"AKL_RAG_EVIDENCE_GATE_MODE": "repair"}).evidence_gate_mode == "repair"
    with pytest.raises(ConfigError, match="off, shadow, enforce, repair"):
        load_settings({"AKL_RAG_EVIDENCE_GATE_MODE": "rewrite-everything"})


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("AKL_RAG_LLM_REQUEST_TIMEOUT_SECONDS", "0"),
        ("AKL_RAG_LLM_RETRY_ATTEMPTS", "3"),
        ("AKL_RAG_EVIDENCE_VERIFIER_TIMEOUT_SECONDS", "301"),
        ("AKL_RAG_EVIDENCE_VERIFIER_LOCAL_MAX_TOKENS", "511"),
    ],
)
def test_invalid_llm_and_verifier_bounds_are_rejected(key: str, value: str) -> None:
    with pytest.raises(ConfigError, match=key):
        load_settings({key: value})


def test_reranker_candidate_limit_is_bounded() -> None:
    assert load_settings({"AKL_RAG_RERANKER_CANDIDATE_LIMIT": "8"}).reranker_candidate_limit == 8
    with pytest.raises(ConfigError, match="AKL_RAG_RERANKER_CANDIDATE_LIMIT"):
        load_settings({"AKL_RAG_RERANKER_CANDIDATE_LIMIT": "0"})


def test_invalid_source_context_window_is_rejected() -> None:
    with pytest.raises(ConfigError, match="AKL_RAG_SOURCE_CONTEXT_WINDOW"):
        load_settings({"AKL_RAG_SOURCE_CONTEXT_WINDOW": "6"})


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("AKL_ASSISTANT_HISTORY_MAX_USER_MESSAGES", "25"),
        ("AKL_ASSISTANT_HISTORY_MAX_MESSAGE_CHARS", "100"),
        ("AKL_ASSISTANT_HISTORY_MAX_CHARS", "12001"),
    ],
)
def test_invalid_assistant_history_bounds_are_rejected(key: str, value: str) -> None:
    with pytest.raises(ConfigError, match=key):
        load_settings({key: value})


def test_current_http_profile_uses_explicit_akl_env_names(tmp_path) -> None:
    secret_file = tmp_path / "registry-client-secret"
    secret_file.write_text("registry-secret\n")
    qdrant_secret_file = tmp_path / "qdrant-api-key"
    qdrant_secret_file.write_text("qdrant-secret\n")
    qdrant_ca_file = tmp_path / "qdrant-ca.pem"
    qdrant_ca_file.write_text("test-ca\n")
    settings = load_settings(
        {
            "AKL_ENV": "development",
            "AKL_AUTH_MODE": "disabled",
            "AKL_RAG_DEPENDENCY_MODE": "http",
            "AKL_RAG_RETRIEVER_MODE": "qdrant",
            "AKL_RAG_FULLTEXT_MODE": "opensearch",
            "AKL_QDRANT_BASE_URL": "http://qdrant:6333",
            "AKL_QDRANT_API_KEY_FILE": str(qdrant_secret_file),
            "AKL_QDRANT_CA_FILE": str(qdrant_ca_file),
            "AKL_QDRANT_COLLECTION": "document_chunks",
            "AKL_OPENSEARCH_BASE_URL": "http://opensearch:9200",
            "AKL_OPENSEARCH_INDEX": "document_chunks_search",
            "AKL_REGISTRY_BASE_URL": "http://registry-api:8000",
            "AKL_REGISTRY_SERVICE_TOKEN_URL": "https://login.example/token",
            "AKL_REGISTRY_SERVICE_CLIENT_ID": "akb-rag-service",
            "AKL_REGISTRY_SERVICE_CLIENT_SECRET_FILE": str(secret_file),
            "AKL_LLM_GATEWAY_BASE_URL": "http://llm-gateway:8080",
            "AKL_RAG_DEFAULT_MAX_CHUNKS": "6",
            "AKL_RAG_NO_ANSWER_MIN_SCORE": "0.15",
            "AKL_RAG_AUTHZ_MODE": "registry",
            "AKL_RAG_ENABLE_RERANKING": "false",
            "AKL_RAG_SOURCE_CONTEXT_WINDOW": "2",
            "AKL_RAG_EMBEDDING_MODEL": "qwen3-embedding:8b",
            "AKL_RAG_EMBEDDING_DIMENSIONS": "1024",
            "AKL_RAG_CHAT_MODEL": "gemma4:12b-mlx",
            "AKL_RAG_HIGH_QUALITY_CHAT_MODEL": "gemma4:31b-mlx",
            "AKL_RAG_HIGH_QUALITY_MIN_CONTEXT_CHUNKS": "4",
            "AKL_RAG_ASSISTANT_LLM_FOLLOW_UPS_ENABLED": "true",
        }
    )

    assert settings.retriever_mode == "qdrant"
    assert settings.fulltext_mode == "opensearch"
    assert settings.registry_client_mode == "http"
    assert settings.llm_client_mode == "http"
    assert settings.qdrant_base_url == "http://qdrant:6333"
    assert settings.qdrant_api_key == "qdrant-secret"
    assert settings.qdrant_ca_file == qdrant_ca_file
    assert settings.qdrant_collection == "document_chunks"
    assert settings.opensearch_base_url == "http://opensearch:9200"
    assert settings.opensearch_index == "document_chunks_search"
    assert settings.registry_base_url == "http://registry-api:8000/api/v1"
    assert settings.registry_service_client_id == "akb-rag-service"
    assert settings.registry_service_client_secret == "registry-secret"
    assert settings.llm_gateway_base_url == "http://llm-gateway:8080/api/v1"
    assert settings.default_max_chunks == 6
    assert settings.no_answer_min_score == 0.15
    assert settings.enable_reranking is False
    assert settings.source_context_window == 2
    assert settings.embedding_model == "qwen3-embedding:8b"
    assert settings.embedding_dimensions == 1024
    assert settings.chat_model == "gemma4:12b-mlx"
    assert settings.high_quality_chat_model == "gemma4:31b-mlx"
    assert settings.high_quality_min_context_chunks == 4
    assert settings.assistant_llm_follow_ups_enabled is True


def test_llm_follow_ups_are_disabled_by_default() -> None:
    assert load_settings({}).assistant_llm_follow_ups_enabled is False


def test_invalid_high_quality_min_context_chunks_is_rejected() -> None:
    with pytest.raises(ConfigError, match="AKL_RAG_HIGH_QUALITY_MIN_CONTEXT_CHUNKS"):
        load_settings({"AKL_RAG_HIGH_QUALITY_MIN_CONTEXT_CHUNKS": "0"})


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("AKL_RAG_EXTERNAL_COMPLEXITY_THRESHOLD", "0"),
        ("AKL_RAG_EXTERNAL_PREMIUM_COMPLEXITY_THRESHOLD", "31"),
    ],
)
def test_invalid_model_routing_threshold_is_rejected(key: str, value: str) -> None:
    with pytest.raises(ConfigError, match=key):
        load_settings({key: value})


def test_invalid_model_routing_mode_is_rejected() -> None:
    with pytest.raises(ConfigError, match="AKL_RAG_MODEL_ROUTING_MODE"):
        load_settings({"AKL_RAG_MODEL_ROUTING_MODE": "automatic-magic"})


@pytest.mark.parametrize("local_key", ["AKL_RAG_CHAT_MODEL", "AKL_RAG_HIGH_QUALITY_CHAT_MODEL"])
def test_external_model_cannot_replace_policy_safe_local_model(local_key: str) -> None:
    with pytest.raises(ConfigError, match="AKL_RAG_EXTERNAL_CHAT_MODEL"):
        load_settings(
            {
                "AKL_RAG_CHAT_MODEL": "gemma4:12b-mlx",
                "AKL_RAG_HIGH_QUALITY_CHAT_MODEL": "gemma4:12b-mlx",
                local_key: "gpt-5.6-luna",
                "AKL_RAG_EXTERNAL_CHAT_MODEL": "gpt-5.6-luna",
            }
        )


def test_opensearch_password_file_overrides_direct_password(tmp_path) -> None:
    password_file = tmp_path / "opensearch.password"
    password_file.write_text("reader-secret\n", encoding="utf-8")

    settings = load_settings(
        {
            "AKL_ENV": "development",
            "AKL_RAG_FULLTEXT_MODE": "opensearch",
            "AKL_OPENSEARCH_USERNAME": "reader",
            "AKL_OPENSEARCH_PASSWORD": "direct-password",
            "AKL_OPENSEARCH_PASSWORD_FILE": str(password_file),
        }
    )

    assert settings.opensearch_password == "reader-secret"
    assert settings.opensearch_password_file == password_file


def test_production_opensearch_requires_tls_and_secret_file(tmp_path) -> None:
    password_file = tmp_path / "opensearch.password"
    password_file.write_text("reader-secret\n", encoding="utf-8")
    ca_file = tmp_path / "opensearch-ca.pem"
    ca_file.write_text("test-ca\n", encoding="utf-8")
    base = {
        **_production_env(),
        "AKL_RAG_FULLTEXT_MODE": "opensearch",
        "AKL_OPENSEARCH_BASE_URL": "https://opensearch.example:9200",
        "AKL_OPENSEARCH_USERNAME": "reader",
        "AKL_OPENSEARCH_PASSWORD_FILE": str(password_file),
        "AKL_OPENSEARCH_CA_FILE": str(ca_file),
    }

    settings = load_settings(base)
    assert settings.opensearch_password == "reader-secret"
    assert settings.opensearch_ca_file == ca_file

    with pytest.raises(ConfigError, match="AKL_OPENSEARCH_PASSWORD_FILE"):
        load_settings(
            {
                **base,
                "AKL_OPENSEARCH_PASSWORD_FILE": "",
                "AKL_OPENSEARCH_PASSWORD": "direct-only",
            }
        )
    with pytest.raises(ConfigError, match="must use HTTPS"):
        load_settings({**base, "AKL_OPENSEARCH_BASE_URL": "http://opensearch:9200"})
