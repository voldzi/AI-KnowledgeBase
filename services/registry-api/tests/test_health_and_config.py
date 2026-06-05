import pytest
from pydantic import ValidationError

from app.config import Settings


def test_health_and_ready(client):
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json() == {"status": "ok", "service": "registry-api", "version": "dev"}
    assert health.headers["X-Request-ID"]
    assert health.headers["X-Correlation-ID"]

    ready = client.get("/ready")
    assert ready.status_code == 200
    assert ready.json() == {"status": "ready", "service": "registry-api"}


def test_production_rejects_mock_auth():
    with pytest.raises(ValidationError, match="AKL_AUTH_MODE=mock"):
        Settings(AKL_ENV="production", AKL_AUTH_MODE="mock")


def test_error_shape_uses_trace_id(client, reader_headers):
    response = client.post(
        "/api/v1/documents",
        headers=reader_headers | {"X-Correlation-ID": "corr-denied"},
        json={
            "title": "Nope",
            "document_type": "policy",
            "owner_id": "user_reader",
            "classification": "internal",
        },
    )

    assert response.status_code == 403
    body = response.json()
    assert body["error"]["code"] == "forbidden"
    assert body["error"]["trace_id"] == "corr-denied"
