from __future__ import annotations

import time
from types import SimpleNamespace

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app


def test_oidc_uses_stratos_projection_and_ignores_static_roles_and_headers(monkeypatch, tmp_path) -> None:  # type: ignore[no-untyped-def]
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key()

    class FakeJwkClient:
        def get_signing_key_from_jwt(self, _token: str) -> SimpleNamespace:
            return SimpleNamespace(key=public_key)

    monkeypatch.setattr("app.security._jwk_client", lambda _url: FakeJwkClient())
    projections = [
        {"tenantId": "org_stratos", "applicationAccess": [{
            "application": "AKB",
            "capabilities": ["akb:read_document"],
            "scopes": [{"type": "organization", "id": "org_stratos"}],
        }]},
        {"tenantId": "org_stratos", "applicationAccess": []},
    ]

    class ProjectionClient:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def get(self, _url, **_kwargs):
            return SimpleNamespace(status_code=200, json=lambda: projections.pop(0))

    monkeypatch.setattr("app.security.httpx.Client", ProjectionClient)
    settings = load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "oidc",
            "AKL_OIDC_ISSUER": "https://login.test/realms/stratos",
            "AKL_OIDC_AUDIENCE": "akl-api",
            "AKL_OIDC_JWKS_URL": "https://login.test/jwks",
            "AKL_STRATOS_AUTH_ME_URL": "https://stratos.test/api/v1/auth/me",
            "AKL_EVAL_DEPENDENCY_MODE": "mock",
            "AKL_EVAL_DATASETS_DIR": str(tmp_path / "datasets"),
            "AKL_EVAL_SEED_DATASETS_DIR": "datasets",
            "AKL_EVAL_REPORTS_DIR": str(tmp_path / "reports"),
        }
    )

    with TestClient(create_app(settings)) as client:
        analyst_response = client.get(
            "/api/v1/evaluations/datasets",
            headers={"Authorization": f"Bearer {_token(private_key, roles=['analyst'])}"},
        )
        reader_response = client.get(
            "/api/v1/evaluations/datasets",
            headers={
                "Authorization": f"Bearer {_token(private_key, roles=['admin'])}",
                "X-STRATOS-Capabilities": "akb:manage_access",
            },
        )

    assert analyst_response.status_code == 200
    assert reader_response.status_code == 403
    assert reader_response.json()["error"]["code"] == "AUTH_FORBIDDEN"


def test_oidc_rejects_wrong_audience(monkeypatch, tmp_path) -> None:  # type: ignore[no-untyped-def]
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key()
    monkeypatch.setattr(
        "app.security._jwk_client",
        lambda _url: SimpleNamespace(
            get_signing_key_from_jwt=lambda _token: SimpleNamespace(key=public_key)
        ),
    )
    settings = load_settings(
        {
            "AKL_ENV": "test",
            "AKL_AUTH_MODE": "oidc",
            "AKL_OIDC_ISSUER": "https://login.test/realms/stratos",
            "AKL_OIDC_AUDIENCE": "akl-api",
            "AKL_OIDC_JWKS_URL": "https://login.test/jwks",
            "AKL_STRATOS_AUTH_ME_URL": "https://stratos.test/api/v1/auth/me",
            "AKL_EVAL_DEPENDENCY_MODE": "mock",
            "AKL_EVAL_DATASETS_DIR": str(tmp_path / "datasets"),
            "AKL_EVAL_REPORTS_DIR": str(tmp_path / "reports"),
        }
    )
    token = jwt.encode(
        {
            "sub": "analyst_1",
            "iss": "https://login.test/realms/stratos",
            "aud": "wrong-api",
            "exp": int(time.time()) + 300,
            "realm_access": {"roles": ["analyst"]},
        },
        private_key,
        algorithm="RS256",
    )

    with TestClient(create_app(settings)) as client:
        response = client.get(
            "/api/v1/evaluations/datasets",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "AUTH_FORBIDDEN"


def _token(private_key, *, roles: list[str]) -> str:  # type: ignore[no-untyped-def]
    return jwt.encode(
        {
            "sub": "user_1",
            "iss": "https://login.test/realms/stratos",
            "aud": "akl-api",
            "exp": int(time.time()) + 300,
            "realm_access": {"roles": roles},
        },
        private_key,
        algorithm="RS256",
    )
