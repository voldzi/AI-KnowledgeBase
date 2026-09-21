from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.config import load_settings
from app.errors import EvaluationError
from app.main import create_app
from app.security import EvaluationPrincipal, _parse_active_projection
from app.service import _require_token_valid_for_run


def test_oidc_uses_stratos_projection_and_ignores_static_roles_and_headers(monkeypatch, tmp_path) -> None:  # type: ignore[no-untyped-def]
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key()

    class FakeJwkClient:
        def get_signing_key_from_jwt(self, _token: str) -> SimpleNamespace:
            return SimpleNamespace(key=public_key)

    monkeypatch.setattr("app.security._jwk_client", lambda _url: FakeJwkClient())
    projections = [
        _projection([_entitlement()]),
        _projection([]),
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
            "AKL_STRATOS_AUTH_ME_URL": "https://stratos.test/api/v2/auth/me",
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


def test_active_v2_projection_preserves_single_entitlement_boundary() -> None:
    capabilities, scopes = _parse_active_projection(
        _projection([
            _entitlement(
                "read-contracts",
                capabilities=["akb:access", "akb:read_document"],
                effective_scopes=[{"type": "budget_scope", "id": "budget:it"}],
            ),
            _entitlement(
                "audit-organization",
                capabilities=["akb:access", "akb:read_audit"],
                effective_scopes=[{"type": "organization", "id": "org_stratos"}],
            ),
        ]),
        expected_subject_id="user_1",
    )

    assert capabilities == ("akb:access", "akb:read_audit")
    assert scopes == ("organization:org_stratos",)
    assert "akb:read_document" not in capabilities
    assert "budget_scope:budget:it" not in scopes


def test_active_v2_projection_rejects_unknown_fields() -> None:
    projection = _projection([_entitlement()])
    projection["legacyCapabilities"] = ["akb:manage_access"]

    with pytest.raises(ValueError, match="invalid projection"):
        _parse_active_projection(projection, expected_subject_id="user_1")


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
            "AKL_STRATOS_AUTH_ME_URL": "https://stratos.test/api/v2/auth/me",
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


def test_evaluation_run_requires_sufficient_user_token_lifetime() -> None:
    principal = EvaluationPrincipal(
        subject_id="user_1",
        roles=(),
        groups=(),
        bearer_token="redacted",
        token_expires_at=int(time.time()) + 30,
    )

    with pytest.raises(EvaluationError, match="Refresh the user session") as exc_info:
        _require_token_valid_for_run(principal, 120)

    assert exc_info.value.code == "ACCESS_TOKEN_REFRESH_REQUIRED"
    assert exc_info.value.status_code == 409


def test_evaluation_run_accepts_fresh_user_token() -> None:
    principal = EvaluationPrincipal(
        subject_id="user_1",
        roles=(),
        groups=(),
        bearer_token="redacted",
        token_expires_at=int(time.time()) + 300,
    )

    _require_token_valid_for_run(principal, 120)


def _token(private_key, *, roles: list[str], expires_in: int = 300) -> str:  # type: ignore[no-untyped-def]
    return jwt.encode(
        {
            "sub": "user_1",
            "iss": "https://login.test/realms/stratos",
            "aud": "akl-api",
            "exp": int(time.time()) + expires_in,
            "realm_access": {"roles": roles},
        },
        private_key,
        algorithm="RS256",
    )


def _projection(entitlements: list[dict[str, object]]) -> dict[str, object]:
    now = datetime.now(timezone.utc)
    return {
        "schemaVersion": "stratos-access-projection-2",
        "contractRevision": "2.1.0",
        "contractStatus": "active",
        "contractDigest": "sha256:16509ccbdc3e49e7a9918a29c833a8ae1aa7c78777b0a8693a2477acc2f0dafa",
        "catalogVersion": "capabilities-1.12.4",
        "generatedAt": (now - timedelta(seconds=1)).isoformat().replace("+00:00", "Z"),
        "expiresAt": (now + timedelta(minutes=10)).isoformat().replace("+00:00", "Z"),
        "organizationId": "org_stratos",
        "identity": {
            "subjectId": "user_1",
            "kind": "person",
            "active": True,
            "employeeEligible": True,
        },
        "membership": {"active": True, "validUntil": None},
        "applicationAccess": ([{"applicationId": "akb", "entitlements": entitlements}]
                              if entitlements else []),
    }


def _entitlement(
    entitlement_id: str = "employee-read",
    *,
    capabilities: list[str] | None = None,
    effective_scopes: list[dict[str, str]] | None = None,
) -> dict[str, object]:
    now = datetime.now(timezone.utc)
    scopes = effective_scopes or [{"type": "organization", "id": "org_stratos"}]
    return {
        "entitlementId": entitlement_id,
        "definitionVersion": "capabilities-1.12.4",
        "profileId": None,
        "source": "MANUAL",
        "sourceRef": None,
        "virtual": False,
        "capabilities": capabilities or ["akb:access", "akb:read_document"],
        "scopes": scopes,
        "effectiveScopes": scopes,
        "validFrom": (now - timedelta(minutes=1)).isoformat().replace("+00:00", "Z"),
        "validUntil": None,
    }
