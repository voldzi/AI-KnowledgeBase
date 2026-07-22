from __future__ import annotations

from tests.conftest import make_client


def test_health_returns_service_name() -> None:
    with make_client() as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "rag-retrieval-service", "version": "dev"}


def test_ready_reports_mock_dependencies() -> None:
    with make_client() as client:
        response = client.get("/ready")

    assert response.status_code == 200
    assert response.json()["status"] == "ready"
    assert response.json()["dependencies"] == {
        "registry-api": "ready",
        "retriever": "ready",
        "llm-gateway": "ready",
        "reranker": "ready",
    }
