import json
import time
from pathlib import Path
from types import SimpleNamespace

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException

import app.auth as auth
from app.access_governance import GovernanceDenied, GovernanceUnavailable, StratosGovernanceClient
from app.config import Settings, get_settings
from app.managed_identity import ManagedIdentityInvalid, ManagedIdentityUnavailable, ManagedOidcVerifier, validate_rules_service, validate_user

ISSUER = "https://identity.example/identity"
SUBJECT = "11111111-1111-4111-8111-111111111111"
OTHER = "22222222-2222-4222-8222-222222222222"


def settings(**updates):
    values = {
        "AKL_ENV": "test", "AKL_AUTH_MODE": "oidc", "AKL_IDENTITY_MODE": "managed",
        "AKL_OIDC_ISSUER": ISSUER, "AKL_MANAGED_IDENTITY_ISSUER": ISSUER,
        "AKL_OIDC_AUDIENCE": "akl-api", "AKL_STRATOS_AUTH_ME_URL": "https://identity.example/api/v1/auth/me",
        "AKL_TRUSTED_SERVICE_CLIENT_IDS": "svc-budget-controlled-rules",
        "AKL_SERVICE_CLIENT_ROUTE_GRANTS": "svc-budget-controlled-rules=controlled-rules-read",
        "AKL_SERVICE_CLIENT_DELEGATIONS": "",
    }
    return Settings(**(values | updates))


def user(**updates):
    now = int(time.time())
    return {"iss": ISSUER, "sub": SUBJECT, "aud": ["akl-api", "stratos-access-api"], "iat": now, "exp": now + 300,
            "stratos_roles": ["stratos_user"], "identity_source": "directory-a", "identity_audience": "employees",
            "stratos_remember_device": False, "preferred_username": "same-login", "email": "same@example.invalid"} | updates


def service(**updates):
    now = int(time.time())
    return {"iss": ISSUER, "sub": "service:svc-budget-controlled-rules", "aud": "akl-api", "iat": now, "exp": now + 300,
            "client_id": "svc-budget-controlled-rules", "stratos_service": True, "scope": "controlled-rules-read",
            "stratos_service_roles": ["service_budget_rules_read"]} | updates


@pytest.fixture
def signed(monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key())) | {"kid": "test-key", "alg": "RS256", "use": "sig"}
    verifier = ManagedOidcVerifier(ISSUER, ISSUER)
    monkeypatch.setattr(verifier, "_json", lambda url: {"issuer": ISSUER, "jwks_uri": ISSUER + "/jwks"} if url.endswith("openid-configuration") else {"keys": [jwk]})
    monkeypatch.setattr(auth, "managed_verifier", lambda *_: verifier)
    return verifier, lambda claims: jwt.encode(claims, key, algorithm="RS256", headers={"kid": "test-key"})


def test_signature_and_separate_user_service_contract(signed):
    verifier, sign = signed
    validate_user(verifier.verify(sign(user())))
    validate_rules_service(verifier.verify(sign(service())))
    with pytest.raises(ManagedIdentityInvalid):
        validate_user(verifier.verify(sign(service())))
    with pytest.raises(ManagedIdentityInvalid):
        validate_rules_service(verifier.verify(sign(user())))
    with pytest.raises(ManagedIdentityInvalid):
        verifier.verify(sign(user())[:-30] + "a" * 30)


@pytest.mark.parametrize("change", [
    {"iss": "https://foreign.example/identity"}, {"aud": ["akl-api"]}, {"aud": ["akl-api", "stratos-access-api", "budget-api"]},
    {"sub": "same-login"}, {"exp": 1}, {"exp": int(time.time()) + 3600},
    {"stratos_roles": ["stratos_user", "admin"]}, {"realm_access": {}}, {"resource_access": {}},
    {"stratos_service": False}, {"stratos_service_roles": []}, {"roles": []}, {"role": "admin"},
    {"identity_source": ""}, {"identity_audience": "other"}, {"identity_audience": ["employees"]}, {"stratos_remember_device": "true"},
])
def test_user_negative_claims(signed, change):
    verifier, sign = signed
    with pytest.raises(ManagedIdentityInvalid):
        validate_user(verifier.verify(sign(user(**change))))


@pytest.mark.parametrize("change", [
    {"aud": ["akl-api", "stratos-access-api"]}, {"client_id": "other"}, {"azp": "other"},
    {"scope": "controlled-rules-read admin"}, {"scope": ""}, {"stratos_service": False},
    {"stratos_service_roles": []}, {"stratos_service_roles": ["service_budget_rules_read", "admin"]},
    {"realm_access": {}}, {"stratos_roles": []}, {"identity_source": "ldap-a"}, {"email": "person@example.invalid"},
])
def test_service_negative_claims(signed, change):
    verifier, sign = signed
    with pytest.raises(ManagedIdentityInvalid):
        validate_rules_service(verifier.verify(sign(service(**change))))


def test_discovery_fails_closed_before_following_foreign_jwks(monkeypatch, signed):
    verifier, sign = signed
    monkeypatch.setattr(verifier, "_json", lambda _: {"issuer": ISSUER, "jwks_uri": "https://foreign.example/jwks"})
    with pytest.raises(ManagedIdentityInvalid):
        verifier.verify(sign(user()))
    monkeypatch.setattr(verifier, "_json", lambda _: (_ for _ in ()).throw(ManagedIdentityUnavailable("unavailable")))
    with pytest.raises(ManagedIdentityUnavailable):
        verifier.verify(sign(user()))


def test_registry_and_rag_share_the_exact_managed_verifier():
    services = Path(__file__).resolve().parents[2]
    assert (services / "registry-api/app/managed_identity.py").read_bytes() == (services / "rag-retrieval-service/app/managed_identity.py").read_bytes()


def test_controlled_rules_has_only_the_dedicated_route(client, monkeypatch, signed):
    _, sign = signed
    client.app.dependency_overrides[get_settings] = lambda: settings()
    headers = {"Authorization": "Bearer " + sign(service()), "X-AKL-Roles": "admin", "X-STRATOS-Capabilities": "akb:manage_access"}
    result = client.get("/api/v1/integrations/controlled-rules-read/rules?domain=public_procurement&valid_on=2026-07-31", headers=headers)
    assert result.status_code == 200
    assert result.json()["status"] == "no_data"
    for path in ("/api/v1/documents", "/api/v1/audit/events"):
        assert client.get(path, headers=headers).status_code == 403
    principal = auth._managed_principal(sign(service()), settings())
    assert principal.roles == {"service_budget_rules_read"}
    assert not principal.capabilities and not principal.scopes and not principal.application_access_active
    with pytest.raises(HTTPException) as rejected:
        auth._managed_principal(sign(service()), settings(AKL_SERVICE_CLIENT_ROUTE_GRANTS=""))
    assert rejected.value.status_code == 401


def test_projection_is_current_subject_bound_and_external_safe(monkeypatch):
    governance = StratosGovernanceClient(settings())
    body = {"id": SUBJECT, "tenantId": "org_stratos", "applicationAccess": [{"application": "akb", "capabilities": ["akb:chat", "akb:read_document"], "effectiveScopes": [{"type": "recipient_set", "id": "employee-directives"}]}]}
    calls = []
    monkeypatch.setattr(governance._http_client, "get", lambda *args, **kwargs: calls.append(1) or httpx.Response(200, json=body))
    first = governance.user_projection("synthetic-token", token_expires_at=time.time() + 300, expected_subject=SUBJECT, identity_audience="employees")
    assert first.application_access_active and "recipient_set:employee-directives" in first.scopes
    with pytest.raises(GovernanceDenied):
        governance.user_projection("synthetic-token", token_expires_at=time.time() + 300, expected_subject=SUBJECT, identity_audience="external")
    body["applicationAccess"] = []
    assert not governance.user_projection("synthetic-token", token_expires_at=time.time() + 300, expected_subject=SUBJECT).application_access_active
    assert len(calls) == 3
    body["id"] = OTHER
    with pytest.raises(GovernanceDenied):
        governance.user_projection("synthetic-token", token_expires_at=time.time() + 300, expected_subject=SUBJECT)
    body["id"], body["isActive"] = SUBJECT, False
    with pytest.raises(GovernanceDenied):
        governance.user_projection("synthetic-token", token_expires_at=time.time() + 300, expected_subject=SUBJECT)
    monkeypatch.setattr(governance._http_client, "get", lambda *args, **kwargs: httpx.Response(503, json={"private": "must-not-be-returned"}))
    with pytest.raises(GovernanceUnavailable):
        governance.user_projection("synthetic-token", token_expires_at=time.time() + 300, expected_subject=SUBJECT)
    governance.close()


def test_subjects_are_never_merged_by_email_or_login(monkeypatch, signed):
    _, sign = signed
    subjects = []
    def projection(_token, **kwargs):
        subjects.append(kwargs["expected_subject"])
        return SimpleNamespace(capabilities={"akb:chat"}, scopes={"public"}, organization_id="org_stratos", identity_active=True, membership_active=True, application_access_active=True)
    monkeypatch.setattr(auth, "governance_client", lambda _: SimpleNamespace(user_projection=projection))
    first = auth._managed_principal(sign(user()), settings())
    second = auth._managed_principal(sign(user(sub=OTHER, identity_source="directory-b")), settings())
    assert first.subject_id != second.subject_id
    assert subjects == [SUBJECT, OTHER]
    assert not first.roles and not first.groups


@pytest.mark.parametrize("change", [{"AKL_MANAGED_IDENTITY_ISSUER": "https://other.example/identity"}, {"AKL_OIDC_ISSUER": "http://identity.example/identity"}, {"AKL_AUTH_MODE": "mock"}, {"AKL_OIDC_AUDIENCE": "other"}, {"AKL_SERVICE_CLIENT_ROUTE_GRANTS": "svc-budget-controlled-rules=controlled-rules-read|audit"}])
def test_managed_config_fails_closed(change):
    with pytest.raises(ValueError):
        settings(**change)
