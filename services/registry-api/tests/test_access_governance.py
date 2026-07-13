from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from starlette.requests import Request

import app.auth as auth_module
import app.api as api_module
import app.permissions as permissions_module
from app.access_governance import AccessProjection, GovernanceUnavailable, StratosGovernanceClient
from app.api import (
    _audit_service_decision_coordinates,
    _register_governed_resource,
    _service_action_decision,
)
from app.auth import Principal, _oidc_principal
from app.config import Settings
from app.information_policy import InformationPolicyBinding, canonical_policy_hash
from app.models import Document
from app.permissions import evaluate_document_access, evaluate_runtime_document_access, SubjectContext


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
        "scope": {"type": "organization", "id": "org_stratos"},
        "policy_binding": None,
        "policy_hash": None,
    }]
    assert _audit_service_decision_coordinates("aiip.harmonize.completed") == ("akb:chat", "ai")
    assert _audit_service_decision_coordinates("ingestion.job.completed") == ("akb:manage_document", "upload")


def _policy(scope_id: str = "it") -> InformationPolicyBinding:
    return InformationPolicyBinding.model_validate({
        "schemaVersion": "stratos-information-policy-2",
        "policyBindingId": "pol_scopebinding01",
        "policyVersion": "information-policy-2.0.0",
        "handlingClass": "INTERNAL",
        "legalClassification": "NONE",
        "tlp": None,
        "pap": None,
        "contentCategories": ["FINANCIAL"],
        "audience": {
            "organizationId": "org_stratos",
            "scopeType": "organization_unit",
            "scopeIds": [scope_id],
            "recipientSubjectIds": [],
        },
        "obligations": ["AUDIT_ACCESS"],
    })


def _document(binding: InformationPolicyBinding) -> Document:
    return Document(
        document_id="doc_scope",
        title="Scoped document",
        document_type="contract",
        status="valid",
        classification="internal",
        owner_id="owner",
        policy_binding_id=binding.policy_binding_id,
        policy_version=binding.policy_version,
        policy_hash=canonical_policy_hash(binding),
        policy_summary=binding.model_dump(mode="json", by_alias=True, exclude_none=False),
        governance_scope_type="organization_unit",
        governance_scope_id="it",
    )


def test_runtime_decision_rechecks_active_scope_and_fails_closed(monkeypatch) -> None:
    binding = _policy()
    document = _document(binding)
    principal = Principal(
        subject_id="user-it",
        roles={"stratos_user"},
        groups=set(),
        capabilities={"akb:read_document"},
        scopes={"organization_unit:it"},
        dynamic_access_loaded=True,
        bearer_token="verified-user-token",
    )
    context = SubjectContext(
        subject_id="user-it",
        roles={"stratos_user"},
        groups=set(),
        capabilities={"akb:read_document"},
        scopes={"organization_unit:it"},
        organization_id="org_stratos",
        identity_active=True,
        membership_active=True,
        application_access_active=True,
        access_v2=True,
    )
    calls = []

    class Client:
        def decide(self, **kwargs):
            calls.append(kwargs)
            return {"decision": "DENY", "reasonCodes": ["SCOPE_INACTIVE"]}

    monkeypatch.setattr(permissions_module, "get_settings", lambda: _settings())
    monkeypatch.setattr(permissions_module, "governance_client", lambda _settings: Client())

    local = evaluate_document_access(context, "document.read", document)
    decision = evaluate_runtime_document_access(principal, "document.read", document, local)

    assert local.allowed is True
    assert decision.allowed is False
    assert decision.reason_codes == ("SCOPE_INACTIVE",)
    assert calls[0]["scope"] == {"type": "organization_unit", "id": "it"}
    assert calls[0]["credential_token"] == "verified-user-token"


def test_governed_resource_registration_uses_verified_obo_contract(monkeypatch) -> None:
    binding = _policy()
    captured = {}

    class Client:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def request(self, method, url, **kwargs):
            captured.update(method=method, url=url, **kwargs)
            return SimpleNamespace(
                status_code=200,
                json=lambda: {
                    "id": "gir_akb_doc_1",
                    "application": "AKB",
                    "resourceType": "document",
                    "resourceId": "doc_1",
                    "sourceVersion": "ver_policy_1",
                    "effectivePolicy": {
                        "policyBindingId": binding.policy_binding_id,
                        "policyHash": canonical_policy_hash(binding),
                    },
                },
            )

    monkeypatch.setattr("app.access_governance.httpx.Client", Client)
    settings = _settings(
        AKL_STRATOS_INFORMATION_RESOURCES_URL="https://stratos.example/api/v1/information/resources"
    )
    registration = StratosGovernanceClient(settings).register_information_resource(
        credential_token="runtime-token",
        actor_subject_id="user-owner",
        resource_type="document",
        resource_id="doc_1",
        source_version="ver_policy_1",
        title="Document",
        scope={"type": "organization_unit", "id": "it"},
        binding=binding,
        parent_resource_id="gir_source_parent",
        reason="test registration",
    )

    assert registration.resource_id == "gir_akb_doc_1"
    assert captured["headers"]["Authorization"] == "Bearer runtime-token"
    assert captured["json"]["actorSubjectId"] == "user-owner"
    assert captured["json"]["parentId"] == "gir_source_parent"
    assert captured["json"]["scope"] == {"type": "organization_unit", "id": "it"}


def test_service_registration_without_delegated_actor_fails_closed(monkeypatch) -> None:
    binding = _policy()
    settings = _settings(
        AKL_STRATOS_INFORMATION_RESOURCES_URL="https://stratos.example/api/v1/information/resources",
        AKL_STRATOS_POLICY_SERVICE_TOKEN="runtime-token",
    )
    monkeypatch.setattr(api_module, "get_settings", lambda: settings)
    principal = Principal(
        subject_id="service-account-source-app",
        roles={"service_integration"},
        groups=set(),
        service_identity=True,
    )

    with pytest.raises(HTTPException) as raised:
        _register_governed_resource(
            principal=principal,
            resource_type="document",
            resource_id="doc_1",
            source_version="gresver_1",
            title="Document",
            policy=binding,
            requested_scope=None,
            parent_resource_id=None,
            reason="test service registration",
        )

    assert raised.value.status_code == 422
    assert raised.value.detail["error"]["code"] == "delegated_actor_required"
