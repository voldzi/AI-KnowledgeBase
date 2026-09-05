import time
from types import SimpleNamespace

import pytest
from starlette.requests import Request

import app.security as security
from app.config import ConfigError, load_settings
from app.errors import RetrievalError
from app.managed_identity import ManagedIdentityInvalid, ManagedIdentityUnavailable

ISSUER = "https://identity.example/identity"


def settings(**updates):
    return load_settings({"AKL_ENV": "development", "AKL_AUTH_MODE": "oidc", "AKL_IDENTITY_MODE": "managed",
                         "AKL_OIDC_ISSUER": ISSUER, "AKL_MANAGED_IDENTITY_ISSUER": ISSUER,
                         "AKL_OIDC_AUDIENCE": "akl-api", "AKL_RAG_USER_OIDC_AUDIENCE": "akl-api"} | updates)


def claims(**updates):
    now = int(time.time())
    return {"iss": ISSUER, "sub": "11111111-1111-4111-8111-111111111111", "aud": ["akl-api", "stratos-access-api"],
            "iat": now, "exp": now + 300, "stratos_roles": ["stratos_user"], "identity_source": "directory-a",
            "identity_audience": "employees", "stratos_remember_device": False} | updates


def request():
    return Request({"type": "http", "method": "POST", "path": "/api/v1/query", "headers": [
        (b"authorization", b"Bearer synthetic-test-token"), (b"x-akl-roles", b"admin"),
        (b"x-stratos-capabilities", b"akb:manage_access"), (b"x-stratos-scopes", b"public"),
    ]})


def test_managed_rag_requires_registry_authorization_not_static_claims(monkeypatch):
    monkeypatch.setattr(security, "managed_verifier", lambda *_: SimpleNamespace(verify=lambda _: claims()))
    req = request()
    security.require_service_auth(req, settings())
    context = req.state.auth_context
    assert context.subject_id == claims()["sub"]
    assert not context.roles and not context.groups and not context.capabilities and not context.scopes
    assert not context.identity_active and not context.membership_active and not context.application_access_active
    assert not context.service_identity


@pytest.mark.parametrize("change", [{"aud": ["akl-api"]}, {"stratos_service": True}, {"realm_access": {"roles": ["admin"]}}, {"identity_audience": ["employees"]}, {"sub": "same-email"}])
def test_managed_rag_rejects_untrusted_claim_shapes(monkeypatch, change):
    monkeypatch.setattr(security, "managed_verifier", lambda *_: SimpleNamespace(verify=lambda _: claims(**change)))
    with pytest.raises(RetrievalError) as rejected:
        security.require_service_auth(request(), settings())
    assert rejected.value.status_code == 401


@pytest.mark.parametrize("failure,status", [(ManagedIdentityInvalid, 401), (ManagedIdentityUnavailable, 503)])
def test_managed_rag_has_no_authentication_fallback(monkeypatch, failure, status):
    def reject(_):
        raise failure("private-upstream-error")
    monkeypatch.setattr(security, "managed_verifier", lambda *_: SimpleNamespace(verify=reject))
    with pytest.raises(RetrievalError) as rejected:
        security.require_service_auth(request(), settings())
    assert rejected.value.status_code == status
    assert "private-upstream-error" not in str(rejected.value)


@pytest.mark.parametrize("updates", [{"AKL_AUTH_MODE": "disabled"}, {"AKL_IDENTITY_MODE": "unknown"}, {"AKL_MANAGED_IDENTITY_ISSUER": "https://other.example/identity"}, {"AKL_RAG_USER_OIDC_AUDIENCE": "other"}])
def test_managed_rag_config_is_opt_in_and_fail_closed(updates):
    with pytest.raises((ConfigError, ValueError)):
        settings(**updates)
