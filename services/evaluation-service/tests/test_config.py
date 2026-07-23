from __future__ import annotations

import pytest

from app.config import ConfigError, load_settings


def test_load_settings_defaults_to_mock_clients_for_development() -> None:
    settings = load_settings({"AKL_ENV": "development", "AKL_AUTH_MODE": "disabled"})

    assert settings.service_name == "evaluation-service"
    assert settings.rag_client_mode == "mock"
    assert settings.registry_client_mode == "mock"


def test_production_rejects_mock_rag_client() -> None:
    with pytest.raises(ConfigError, match="AKL_EVAL_RAG_CLIENT_MODE=http"):
        load_settings(
            {
                "AKL_ENV": "production",
                "AKL_AUTH_MODE": "bearer",
                "AKL_SERVICE_TOKEN": "token",
                "AKL_EVAL_DEPENDENCY_MODE": "mock",
            }
        )


def test_invalid_pass_threshold_is_rejected() -> None:
    with pytest.raises(ConfigError, match="AKL_EVAL_PASS_THRESHOLD"):
        load_settings({"AKL_EVAL_PASS_THRESHOLD": "2"})


def test_invalid_minimum_run_token_ttl_is_rejected() -> None:
    with pytest.raises(ConfigError, match="AKL_EVAL_MIN_RUN_TOKEN_TTL_SECONDS"):
        load_settings({"AKL_EVAL_MIN_RUN_TOKEN_TTL_SECONDS": "3601"})
