from __future__ import annotations

import pytest

from app.config import ConfigError, load_settings


def test_default_settings_use_mock_dependency_mode() -> None:
    settings = load_settings({"AKL_ENV": "test"})

    assert settings.service_name == "governance-service"
    assert settings.registry_client_mode == "mock"
    assert settings.rag_client_mode == "mock"


def test_production_rejects_mock_dependencies() -> None:
    with pytest.raises(ConfigError, match="Production must use http clients"):
        load_settings(
            {
                "AKL_ENV": "production",
                "AKL_AUTH_MODE": "bearer",
                "AKL_SERVICE_TOKEN": "token",
                "AKL_GOVERNANCE_DEPENDENCY_MODE": "mock",
            }
        )


def test_production_requires_bearer_auth() -> None:
    with pytest.raises(ConfigError, match="Production requires AKL_AUTH_MODE=bearer"):
        load_settings(
            {
                "AKL_ENV": "production",
                "AKL_AUTH_MODE": "disabled",
                "AKL_GOVERNANCE_DEPENDENCY_MODE": "http",
            }
        )
