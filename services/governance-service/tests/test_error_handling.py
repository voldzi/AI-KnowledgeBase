from __future__ import annotations

from tests.conftest import make_client


def test_bearer_auth_mode_requires_authorization_header() -> None:
    with make_client({"AKL_AUTH_MODE": "bearer", "AKL_SERVICE_TOKEN": "secret"}) as client:
        response = client.get("/api/v1/governance/validity-alerts?subject_id=user_123")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


def test_request_validation_uses_standard_error_envelope() -> None:
    with make_client() as client:
        response = client.post("/api/v1/governance/compare-versions", json={})

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert "trace_id" in body["error"]
