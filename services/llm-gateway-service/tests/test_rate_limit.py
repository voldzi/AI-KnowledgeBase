from __future__ import annotations

from tests.conftest import make_client


def test_rate_limit_uses_authenticated_principal_not_spoofable_header() -> None:
    with make_client(
        {
            "AKL_AUTH_MODE": "mock",
            "AKL_RATE_LIMIT_ENABLED": "true",
            "AKL_RATE_LIMIT_PER_MINUTE": "1",
        }
    ) as client:
        first = client.post(
            "/api/v1/embeddings",
            headers={"X-Service-Name": "spoofed-service-a"},
            json={"model": "mock-embedding", "input": ["first"]},
        )
        second = client.post(
            "/api/v1/embeddings",
            headers={"X-Service-Name": "spoofed-service-b"},
            json={"model": "mock-embedding", "input": ["second"]},
        )

    assert first.status_code == 200
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "RATE_LIMIT_EXCEEDED"


def test_rate_limit_identity_store_is_bounded() -> None:
    with make_client(
        {
            "AKL_AUTH_MODE": "disabled",
            "AKL_RATE_LIMIT_ENABLED": "true",
            "AKL_RATE_LIMIT_PER_MINUTE": "10",
            "AKL_RATE_LIMIT_MAX_IDENTITIES": "1",
        }
    ) as client:
        limiter = client.app.state.rate_limiter
        limiter._windows["older"] = type("Counter", (), {"window_start": 1.0, "count": 1})()
        response = client.post(
            "/api/v1/embeddings",
            json={"model": "mock-embedding", "input": ["first"]},
        )

    assert response.status_code == 200
    assert len(limiter._windows) <= 1
