from __future__ import annotations

import pytest

from app.config import ConfigError, load_settings


def test_load_settings_defaults_to_mock_clients_for_development() -> None:
    settings = load_settings({"AKL_ENV": "development", "AKL_AUTH_MODE": "disabled"})

    assert settings.service_name == "rag-retrieval-service"
    assert settings.registry_client_mode == "mock"
    assert settings.retriever_mode == "mock"
    assert settings.llm_client_mode == "mock"
    assert settings.answer_max_tokens == 512


def test_production_rejects_mock_clients() -> None:
    with pytest.raises(ConfigError, match="Production must use http clients"):
        load_settings(
            {
                "AKL_ENV": "production",
                "AKL_AUTH_MODE": "bearer",
                "AKL_SERVICE_TOKEN": "token",
                "AKL_RAG_DEPENDENCY_MODE": "mock",
            }
        )


def test_invalid_threshold_is_rejected() -> None:
    with pytest.raises(ConfigError, match="AKL_RAG_NO_ANSWER_MIN_SCORE"):
        load_settings({"AKL_RAG_NO_ANSWER_MIN_SCORE": "2"})


def test_invalid_answer_max_tokens_is_rejected() -> None:
    with pytest.raises(ConfigError, match="AKL_RAG_ANSWER_MAX_TOKENS"):
        load_settings({"AKL_RAG_ANSWER_MAX_TOKENS": "0"})


def test_phase_02_legacy_env_names_are_supported() -> None:
    settings = load_settings(
        {
            "AKL_ENV": "development",
            "AKL_AUTH_MODE": "disabled",
            "RAG_RETRIEVAL_MODE": "qdrant",
            "RAG_MOCK_MODE": "false",
            "QDRANT_URL": "http://qdrant:6333",
            "QDRANT_COLLECTION": "phase02_chunks",
            "REGISTRY_API_URL": "http://registry-api:8000",
            "LLM_GATEWAY_URL": "http://llm-gateway:8080",
            "RAG_TOP_K": "6",
            "RAG_MIN_SCORE": "0.15",
            "RAG_AUTHZ_MODE": "registry",
            "RAG_ENABLE_RERANKING": "false",
        }
    )

    assert settings.retriever_mode == "qdrant"
    assert settings.registry_client_mode == "http"
    assert settings.llm_client_mode == "http"
    assert settings.qdrant_base_url == "http://qdrant:6333"
    assert settings.qdrant_collection == "phase02_chunks"
    assert settings.registry_base_url == "http://registry-api:8000/api/v1"
    assert settings.llm_gateway_base_url == "http://llm-gateway:8080/api/v1"
    assert settings.default_max_chunks == 6
    assert settings.no_answer_min_score == 0.15
    assert settings.enable_reranking is False
