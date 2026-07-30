from __future__ import annotations

import pytest

from app.config import ConfigError, load_settings
from app.http_utils import outgoing_headers


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


def test_actor_bearer_overrides_only_the_upstream_authorization_header() -> None:
    settings = load_settings(
        {
            "AKL_ENV": "test",
            "AKL_UPSTREAM_BEARER_TOKEN": "fallback-service-token",
        }
    )

    headers = outgoing_headers(settings, bearer_token="current-actor-token")

    assert headers["Authorization"] == "Bearer current-actor-token"
    assert headers["X-Service-Name"] == "governance-service"
