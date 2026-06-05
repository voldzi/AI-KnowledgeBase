from __future__ import annotations

from tests.conftest import make_client


def test_health_returns_ok_and_correlation_headers() -> None:
    with make_client() as client:
        response = client.get("/health", headers={"X-Correlation-ID": "corr-test"})

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["version"] == "dev"
    assert response.headers["X-Correlation-ID"] == "corr-test"
    assert response.headers["X-Request-ID"]


def test_ready_uses_default_provider() -> None:
    with make_client() as client:
        response = client.get("/ready")

    assert response.status_code == 200
    assert response.json()["status"] == "ready"
    assert response.json()["providers"] == {"mock": True}
