from __future__ import annotations

import pytest

from app.config import ConfigError, load_settings
from tests.conftest import make_client, readiness_transport_headers


def test_health_and_ready(tmp_path) -> None:
    with make_client(tmp_path) as client:
        health = client.get("/health")
        ready = client.get("/ready", headers=readiness_transport_headers())

    assert health.status_code == 200
    assert health.json() == {"status": "ok", "service": "ingestion-service", "version": "dev"}
    assert ready.status_code == 200
    assert ready.json()["status"] == "ready"
    assert ready.json()["checks"]["registry"] == "mock"


def test_ready_returns_503_when_registry_service_identity_is_unavailable(
    tmp_path,
    monkeypatch,
) -> None:
    async def registry_not_ready(_self) -> str:
        return "not_ready"

    monkeypatch.setattr(
        "app.registry_client.RegistryClient.readiness",
        registry_not_ready,
    )
    with make_client(
        tmp_path,
        {"AKL_INGESTION_REGISTRY_CLIENT_MODE": "http"},
    ) as client:
        ready = client.get("/ready", headers=readiness_transport_headers())

    assert ready.status_code == 503
    assert ready.json()["status"] == "not_ready"
    assert ready.json()["checks"]["registry"] == "not_ready"


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


def test_authenticated_http_registry_requires_complete_dedicated_service_identity(
    tmp_path,
) -> None:
    base = {
        "AKL_ENV": "test",
        "AKL_AUTH_MODE": "oidc",
        "AKL_OIDC_ISSUER": "https://login.example/realms/stratos",
        "AKL_OIDC_AUDIENCE": "akl-api",
        "AKL_OIDC_JWKS_URL": "https://login.example/realms/stratos/certs",
        "AKL_INGESTION_REGISTRY_CLIENT_MODE": "http",
        "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
        "AKL_OBJECT_STORAGE_ROOT": str(tmp_path / "objects"),
        "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "mock",
        "AKL_INGESTION_INDEXER_MODE": "mock",
    }

    with pytest.raises(ConfigError, match="dedicated Registry service identity"):
        load_settings(base)
    with pytest.raises(ConfigError, match="requires AKL_REGISTRY_SERVICE_TOKEN_URL"):
        load_settings(
            {
                **base,
                "AKL_REGISTRY_SERVICE_TOKEN_URL": "https://login.example/token",
                "AKL_REGISTRY_SERVICE_CLIENT_ID": "svc-ingestion",
            }
        )


def test_registry_service_secret_file_and_ingestion_client_boundary(tmp_path) -> None:
    secret_file = tmp_path / "svc-ingestion-client-secret"
    secret_file.write_text("registry-secret\n", encoding="utf-8")
    base = {
        "AKL_ENV": "test",
        "AKL_AUTH_MODE": "oidc",
        "AKL_OIDC_ISSUER": "https://login.example/realms/stratos",
        "AKL_OIDC_AUDIENCE": "akl-api",
        "AKL_OIDC_JWKS_URL": "https://login.example/realms/stratos/certs",
        "AKL_INGESTION_REGISTRY_CLIENT_MODE": "http",
        "AKL_REGISTRY_SERVICE_TOKEN_URL": "https://login.example/token",
        "AKL_REGISTRY_SERVICE_CLIENT_ID": "svc-ingestion",
        "AKL_REGISTRY_SERVICE_CLIENT_SECRET_FILE": str(secret_file),
        "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
        "AKL_OBJECT_STORAGE_ROOT": str(tmp_path / "objects"),
        "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "mock",
        "AKL_INGESTION_INDEXER_MODE": "mock",
    }

    settings = load_settings(base)
    assert settings.registry_service_client_secret == "registry-secret"

    with pytest.raises(ConfigError, match="not aiip-service"):
        load_settings(
            {
                **base,
                "AKL_REGISTRY_SERVICE_CLIENT_ID": "aiip-service",
            }
        )


def test_production_registry_service_identity_must_match_ingestion_identity(tmp_path) -> None:
    secret_file = tmp_path / "svc-ingestion-client-secret"
    secret_file.write_text("registry-secret\n", encoding="utf-8")
    base = {
        "AKL_ENV": "production",
        "AKL_AUTH_MODE": "oidc",
        "AKL_OIDC_ISSUER": "https://login.example/realms/stratos",
        "AKL_OIDC_AUDIENCE": "akl-api",
        "AKL_OIDC_JWKS_URL": "https://login.example/realms/stratos/certs",
        "AKL_SERVICE_ACCOUNT_SUBJECT": "svc-ingestion",
        "AKL_INGESTION_REGISTRY_CLIENT_MODE": "http",
        "AKL_REGISTRY_SERVICE_TOKEN_URL": "https://login.example/token",
        "AKL_REGISTRY_SERVICE_CLIENT_ID": "another-service",
        "AKL_REGISTRY_SERVICE_CLIENT_SECRET_FILE": str(secret_file),
        "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
        "AKL_OBJECT_STORAGE_ROOT": str(tmp_path / "objects"),
        "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "http",
        "AKL_INGESTION_INDEXER_MODE": "qdrant",
    }

    with pytest.raises(ConfigError, match="must be svc-ingestion"):
        load_settings(base)

    with pytest.raises(ConfigError, match="must match AKL_SERVICE_ACCOUNT_SUBJECT"):
        load_settings(
            {
                **base,
                "AKL_SERVICE_ACCOUNT_SUBJECT": "another-service",
                "AKL_REGISTRY_SERVICE_CLIENT_ID": "svc-ingestion",
            }
        )

    with pytest.raises(ConfigError, match="must use HTTPS"):
        load_settings(
            {
                **base,
                "AKL_REGISTRY_SERVICE_TOKEN_URL": "http://login.example/token",
                "AKL_REGISTRY_SERVICE_CLIENT_ID": "svc-ingestion",
            }
        )

    settings = load_settings(
        {
            **base,
            "AKL_REGISTRY_SERVICE_CLIENT_ID": "svc-ingestion",
        }
    )
    assert settings.registry_service_client_id == "svc-ingestion"


def test_invalid_combined_mock_indexer_mode_is_rejected(tmp_path) -> None:
    with pytest.raises(ConfigError, match="cannot be combined"):
        load_settings(
            {
                "AKL_ENV": "test",
                "AKL_AUTH_MODE": "disabled",
                "AKL_INGESTION_REGISTRY_CLIENT_MODE": "mock",
                "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
                "AKL_OBJECT_STORAGE_ROOT": str(tmp_path),
                "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "mock",
                "AKL_INGESTION_INDEXER_MODE": "mock,opensearch",
            }
        )


def test_ocrmypdf_provider_configuration_is_supported(tmp_path) -> None:
    settings = load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "disabled",
            "AKL_INGESTION_REGISTRY_CLIENT_MODE": "mock",
            "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
            "AKL_OBJECT_STORAGE_ROOT": str(tmp_path),
            "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "mock",
            "AKL_INGESTION_INDEXER_MODE": "mock",
            "AKL_INGESTION_OCR_PROVIDER": "ocrmypdf",
            "AKL_INGESTION_OCRMYPDF_COMMAND": "/usr/bin/ocrmypdf",
            "AKL_INGESTION_OCR_TIMEOUT_SECONDS": "600",
        }
    )

    assert settings.ocr_provider == "ocrmypdf"
    assert settings.ocrmypdf_command == "/usr/bin/ocrmypdf"
    assert settings.ocr_timeout_seconds == 600


def test_opensearch_password_file_overrides_direct_password(tmp_path) -> None:
    password_file = tmp_path / "opensearch.password"
    password_file.write_text("file-password\n", encoding="utf-8")

    settings = load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "disabled",
            "AKL_INGESTION_REGISTRY_CLIENT_MODE": "mock",
            "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
            "AKL_OBJECT_STORAGE_ROOT": str(tmp_path),
            "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "mock",
            "AKL_INGESTION_INDEXER_MODE": "opensearch",
            "AKL_OPENSEARCH_USERNAME": "writer",
            "AKL_OPENSEARCH_PASSWORD": "direct-password",
            "AKL_OPENSEARCH_PASSWORD_FILE": str(password_file),
        }
    )

    assert settings.opensearch_password == "file-password"
    assert settings.opensearch_password_file == password_file


def test_production_opensearch_requires_tls_secret_files_and_managed_alias(
    tmp_path,
) -> None:
    registry_secret = tmp_path / "registry.secret"
    registry_secret.write_text("registry-secret\n", encoding="utf-8")
    opensearch_password = tmp_path / "opensearch.password"
    opensearch_password.write_text("writer-secret\n", encoding="utf-8")
    ca_file = tmp_path / "opensearch-ca.pem"
    ca_file.write_text("test-ca\n", encoding="utf-8")
    base = {
        "AKL_ENV": "production",
        "AKL_AUTH_MODE": "oidc",
        "AKL_OIDC_ISSUER": "https://login.example/realms/stratos",
        "AKL_OIDC_AUDIENCE": "akl-api",
        "AKL_OIDC_JWKS_URL": "https://login.example/realms/stratos/certs",
        "AKL_SERVICE_ACCOUNT_SUBJECT": "svc-ingestion",
        "AKL_INGESTION_REGISTRY_CLIENT_MODE": "http",
        "AKL_REGISTRY_SERVICE_TOKEN_URL": "https://login.example/token",
        "AKL_REGISTRY_SERVICE_CLIENT_ID": "svc-ingestion",
        "AKL_REGISTRY_SERVICE_CLIENT_SECRET_FILE": str(registry_secret),
        "AKL_INGESTION_OBJECT_STORAGE_MODE": "local",
        "AKL_OBJECT_STORAGE_ROOT": str(tmp_path / "objects"),
        "AKL_INGESTION_EMBEDDING_CLIENT_MODE": "http",
        "AKL_INGESTION_INDEXER_MODE": "qdrant,opensearch",
        "AKL_OPENSEARCH_BASE_URL": "https://opensearch.example:9200",
        "AKL_OPENSEARCH_USERNAME": "writer",
        "AKL_OPENSEARCH_PASSWORD_FILE": str(opensearch_password),
        "AKL_OPENSEARCH_CA_FILE": str(ca_file),
        "AKL_OPENSEARCH_AUTO_CREATE_INDEX": "false",
    }

    settings = load_settings(base)
    assert settings.opensearch_password == "writer-secret"
    assert settings.opensearch_ca_file == ca_file
    assert settings.opensearch_auto_create_index is False

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
    with pytest.raises(ConfigError, match="AUTO_CREATE_INDEX=false"):
        load_settings({**base, "AKL_OPENSEARCH_AUTO_CREATE_INDEX": "true"})
