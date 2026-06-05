from __future__ import annotations

from tests.conftest import make_client


def test_health_and_ready_return_service_status_and_correlation_headers() -> None:
    with make_client() as client:
        health = client.get("/health", headers={"X-Correlation-ID": "corr_test"})
        ready = client.get("/ready", headers={"X-Correlation-ID": "corr_test"})

    assert health.status_code == 200
    assert health.json() == {"status": "ok", "service": "governance-service", "version": "dev"}
    assert health.headers["X-Correlation-ID"] == "corr_test"
    assert ready.status_code == 200
    assert ready.json()["dependencies"] == {
        "registry-api": "ready",
        "rag-retrieval-service": "ready",
    }
