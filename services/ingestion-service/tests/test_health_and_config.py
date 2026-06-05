from __future__ import annotations

import pytest

from app.config import ConfigError, load_settings
from tests.conftest import make_client


def test_health_and_ready(tmp_path) -> None:
    with make_client(tmp_path) as client:
        health = client.get("/health")
        ready = client.get("/ready")

    assert health.status_code == 200
    assert health.json() == {"status": "ok", "service": "ingestion-service", "version": "dev"}
    assert ready.status_code == 200
    assert ready.json()["status"] == "ready"
    assert ready.json()["checks"]["registry"] == "mock"


def test_correlation_headers_are_returned(tmp_path) -> None:
    with make_client(tmp_path) as client:
        response = client.get(
            "/health",
            headers={"X-Request-ID": "req-test", "X-Correlation-ID": "corr-test"},
        )

    assert response.headers["X-Request-ID"] == "req-test"
    assert response.headers["X-Correlation-ID"] == "corr-test"


def test_oidc_auth_mode_requires_bearer_token(tmp_path) -> None:
    with make_client(tmp_path, {"AKL_AUTH_MODE": "oidc"}) as client:
        response = client.get("/api/v1/ingestion/jobs")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_production_rejects_mock_dependencies() -> None:
    with pytest.raises(ConfigError):
        load_settings(
            {
                "AKL_ENV": "production",
                "AKL_AUTH_MODE": "bearer",
                "AKL_SERVICE_TOKEN": "token",
                "AKL_INGESTION_REGISTRY_CLIENT_MODE": "mock",
                "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
                "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "mock",
                "AKL_INGESTION_INDEXER_MODE": "mock",
            }
        )
