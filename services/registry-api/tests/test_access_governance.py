from types import SimpleNamespace

import httpx
from starlette.requests import Request

import app.auth as auth_module
import app.api as api_module
from app.access_governance import AccessProjection, GovernanceUnavailable, StratosGovernanceClient
from app.api import _audit_service_decision_coordinates, _service_action_decision
from app.auth import Principal, _oidc_principal
from app.config import Settings


def _settings(**overrides) -> Settings:
    values = {
        "AKL_ENV": "test",
        "AKL_AUTH_MODE": "oidc",
        "AKL_OIDC_ISSUER": "https://login.example/realms/stratos",
        "AKL_OIDC_AUDIENCE": "akb-api",
        "AKL_OIDC_JWKS_URL": "https://login.example/realms/stratos/certs",
        "AKL_STRATOS_AUTH_ME_URL": "https://stratos.example/api/v1/auth/me",
        "AKL_STRATOS_ACCESS_CACHE_TTL_SECONDS": 0,
    }
    values.update(overrides)
    return Settings(**values)


def test_user_projection_reflects_immediate_application_suspension(monkeypatch) -> None:
    responses = [
        {"tenantId": "org_stratos", "applicationAccess": [{
            "application": "AKB",
            "capabilities": ["akb:chat"],
            "scopes": [{"type": "organization", "id": "org_stratos"}],
        }]},
        {"tenantId": "org_stratos", "applicationAccess": []},
    ]

    class Client:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def get(self, _url, **_kwargs):
            return SimpleNamespace(status_code=200, json=lambda: responses.pop(0))

    monkeypatch.setattr("app.access_governance.httpx.Client", Client)
    client = StratosGovernanceClient(_settings())

    active = client.user_projection("token", token_expires_at=None)
    suspended = client.user_projection("token", token_expires_at=None)

    assert active.application_access_active is True
    assert active.capabilities == frozenset({"akb:chat"})
    assert suspended.application_access_active is False
    assert suspended.capabilities == frozenset()


def test_user_projection_fails_closed_when_stratos_is_unavailable(monkeypatch) -> None:
    class Client:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def get(self, url, **_kwargs):
            raise httpx.ConnectError("offline", request=httpx.Request("GET", url))

    monkeypatch.setattr("app.access_governance.httpx.Client", Client)

    try:
        StratosGovernanceClient(_settings()).user_projection("token", token_expires_at=None)
        raise AssertionError("projection must fail closed")
    except GovernanceUnavailable:
        pass


def test_oidc_principal_ignores_static_access_claims_and_forged_headers(monkeypatch) -> None:
    class JwkClient:
        def __init__(self, _url):
            pass

        def get_signing_key_from_jwt(self, _token):
            return SimpleNamespace(key="test-key")

    claims = {
        "sub": "user-123",
        "exp": 2_000_000_000,
        "realm_access": {"roles": ["admin"]},
        "stratos_access": {
            "capabilities": ["akb:manage_access"],
            "scopes": ["organization"],
        },
    }
    projection = AccessProjection(
        capabilities=frozenset({"akb:chat"}),
        scopes=frozenset({"organization:org_stratos"}),
        organization_id="org_stratos",
        identity_active=True,
        membership_active=True,
        application_access_active=True,
    )
    monkeypatch.setattr(auth_module, "PyJWKClient", JwkClient)
    monkeypatch.setattr(auth_module.jwt, "decode", lambda *_args, **_kwargs: claims)
    monkeypatch.setattr(
        auth_module,
        "governance_client",
        lambda _settings: SimpleNamespace(user_projection=lambda *_args, **_kwargs: projection),
    )
    request = Request({
        "type": "http",
        "headers": [
            (b"authorization", b"Bearer signed-token"),
            (b"x-stratos-capabilities", b"akb:manage_access"),
            (b"x-stratos-scopes", b"organization"),
        ],
    })

    principal = _oidc_principal(request, _settings())

    assert principal.dynamic_access_loaded is True
    assert principal.capabilities == {"akb:chat"}
    assert principal.scopes == {"organization:org_stratos"}
    assert "akb:manage_access" not in principal.capabilities


def test_service_decision_uses_central_runtime_client_and_delegated_actor(monkeypatch) -> None:
    calls = []

    class Client:
        def decide(self, **kwargs):
            calls.append(kwargs)
            return {"decision": "ALLOW", "reasonCodes": ["CAPABILITY_ALLOW"]}

    monkeypatch.setattr(api_module, "governance_client", lambda _settings: Client())
    principal = Principal(
        subject_id="service-account-akb-rag-service",
        roles={"service_rag"},
        groups=set(),
        service_identity=True,
        application_access_active=False,
    )

    decision = _service_action_decision(
        principal=principal,
        subject_id="service-account-aiip-service",
        action="rag.query",
        document=None,
    )

    assert decision.allowed is True
    assert calls == [{
        "actor_subject_id": "service-account-aiip-service",
        "capability_id": "akb:chat",
        "operation": "access",
        "policy_binding": None,
        "policy_hash": None,
    }]
    assert _audit_service_decision_coordinates("aiip.harmonize.completed") == ("akb:chat", "ai")
    assert _audit_service_decision_coordinates("ingestion.job.completed") == ("akb:manage_document", "upload")
