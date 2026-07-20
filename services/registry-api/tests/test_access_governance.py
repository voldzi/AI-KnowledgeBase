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
    _is_official_public_source_create,
    _register_governed_resource,
    _service_action_decision,
)
from app.auth import (
    Principal,
    _enforce_service_route,
    _oidc_principal,
    _service_route_for_request,
)
from app.config import Settings
from app.information_policy import InformationPolicyBinding, canonical_policy_hash
from app.models import Document, DocumentVersion
from app.official_public_sources import is_official_public_source_document
from app.schemas import DocumentCreate
from app.permissions import (
    Decision,
    DocumentVersionAuthority,
    SubjectContext,
    evaluate_document_access,
    evaluate_document_version_access,
    evaluate_runtime_document_access,
    evaluate_runtime_document_version_access,
)


def _settings(**overrides) -> Settings:
    values = {
        "AKL_ENV": "test",
        "AKL_AUTH_MODE": "oidc",
        "AKL_OIDC_ISSUER": "https://login.example/realms/stratos",
        "AKL_OIDC_AUDIENCE": "akb-api",
        "AKL_OIDC_JWKS_URL": "https://login.example/realms/stratos/certs",
        "AKL_STRATOS_AUTH_ME_URL": "https://stratos.example/api/v1/auth/me",
        "AKL_STRATOS_ACCESS_CACHE_TTL_SECONDS": 0,
        "AKL_TRUSTED_SERVICE_CLIENT_IDS": "akb-rag-service,aiip-document-service,svc-ingestion",
        "AKL_SERVICE_CLIENT_ROUTE_GRANTS": (
            "akb-rag-service=authz|audit|idempotency,"
            "aiip-document-service=aiip-upload,"
            "svc-ingestion=authz|audit|documents-read|ingestion-status"
        ),
        "AKL_SERVICE_CLIENT_DELEGATIONS": "akb-rag-service=aiip-service",
    }
    values.update(overrides)
    return Settings(**values)


def test_user_projection_reflects_immediate_application_suspension(monkeypatch) -> None:
    responses = [
        {"tenantId": "org_stratos", "applicationAccess": [{
            "application": "AKB",
            "capabilities": ["akb:chat"],
            "scopes": [{"type": "project", "id": "inactive-or-orphaned"}],
            "effectiveScopes": [{"type": "organization", "id": "org_stratos"}],
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
    assert active.scopes == frozenset({"organization:org_stratos"})
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


def test_user_projection_never_falls_back_to_raw_scope_grants(monkeypatch) -> None:
    class Client:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def get(self, _url, **_kwargs):
            return SimpleNamespace(
                status_code=200,
                json=lambda: {
                    "tenantId": "org_stratos",
                    "applicationAccess": [{
                        "application": "AKB",
                        "capabilities": ["akb:read_document"],
                        "scopes": [{"type": "organization", "id": "org_stratos"}],
                    }],
                },
            )

    monkeypatch.setattr("app.access_governance.httpx.Client", Client)
    projection = StratosGovernanceClient(_settings()).user_projection(
        "token",
        token_expires_at=None,
    )

    assert projection.application_access_active is True
    assert projection.capabilities == frozenset({"akb:read_document"})
    assert projection.scopes == frozenset()


def test_policy_registry_response_must_match_every_immutable_dimension(monkeypatch) -> None:
    binding = _policy()
    expected_hash = canonical_policy_hash(binding)
    requests: list[dict[str, object]] = []
    response_body = {
        "schemaVersion": "stratos-information-policy-2",
        "organizationId": "org_stratos",
        "applicationId": "akb",
        "policyBindingId": binding.policy_binding_id,
        "policyVersion": binding.policy_version,
        "policyHash": expected_hash,
        "handlingClass": binding.handling_class,
        "legalClassification": binding.legal_classification,
        "tlp": binding.tlp,
        "pap": binding.pap,
        "contentCategories": list(binding.content_categories),
        "audience": binding.audience.model_dump(mode="json", by_alias=True),
        "obligations": list(binding.obligations),
        "originatorId": None,
        "originator": None,
        "issuedAt": "2026-07-14T00:00:00Z",
        "reviewAt": None,
    }

    class Client:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def request(self, _method, _url, **_kwargs):
            requests.append(dict(_kwargs["json"]))
            return SimpleNamespace(status_code=200, json=lambda: dict(response_body))

    monkeypatch.setattr("app.access_governance.httpx.Client", Client)
    client = StratosGovernanceClient(_settings(
        AKL_STRATOS_POLICY_BINDINGS_URL="https://stratos.example/api/v1/policy/bindings",
        AKB_POLICY_SERVICE_TOKEN="runtime-token",
    ))

    assert client.ensure_binding_registered(binding) == expected_hash
    assert requests[-1]["originatorId"] == binding.originator_id
    assert requests[-1]["issuedAt"] == "2026-07-14T00:00:00Z"
    assert requests[-1]["reviewAt"] is None
    response_body["audience"] = {
        **response_body["audience"],
        "scopeIds": ["logistics"],
    }
    with pytest.raises(GovernanceUnavailable):
        client.ensure_binding_registered(binding)


def test_service_policy_binding_is_fetched_and_hash_verified(monkeypatch) -> None:
    binding = _service_policy()
    response_body = {
        **binding.model_dump(mode="json", by_alias=True, exclude_none=False),
        "organizationId": "org_stratos",
        "applicationId": "akb",
        "policyHash": canonical_policy_hash(binding),
    }

    class Client:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def get(self, url, **_kwargs):
            assert url.endswith("/pol_akb_internal_source_v1")
            return SimpleNamespace(status_code=200, json=lambda: dict(response_body))

    monkeypatch.setattr("app.access_governance.httpx.Client", Client)
    client = StratosGovernanceClient(_settings(
        AKL_STRATOS_POLICY_BINDINGS_URL="https://stratos.example/api/v1/policy/bindings",
        AKL_STRATOS_SERVICE_POLICY_BINDING_ID="pol_akb_internal_source_v1",
        AKB_POLICY_SERVICE_TOKEN="runtime-token",
    ))

    summary, policy_hash = client.service_policy_binding()
    assert summary["policyBindingId"] == "pol_akb_internal_source_v1"
    assert policy_hash == canonical_policy_hash(binding)

    response_body["policyHash"] = f"sha256:{'f' * 64}"
    with pytest.raises(GovernanceUnavailable):
        client.service_policy_binding()


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


def test_oidc_rejects_service_looking_token_from_untrusted_azp(monkeypatch) -> None:
    class JwkClient:
        def __init__(self, _url):
            pass

        def get_signing_key_from_jwt(self, _token):
            return SimpleNamespace(key="test-key")

    monkeypatch.setattr(auth_module, "PyJWKClient", JwkClient)
    monkeypatch.setattr(
        auth_module.jwt,
        "decode",
        lambda *_args, **_kwargs: {
            "sub": "service-account-foreign-service",
            "preferred_username": "service-account-foreign-service",
            "azp": "foreign-service",
        },
    )
    request = Request({
        "type": "http",
        "headers": [(b"authorization", b"Bearer signed-token")],
    })

    with pytest.raises(HTTPException) as exc_info:
        _oidc_principal(request, _settings())

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail["error"]["code"] == "untrusted_service_identity"


def test_oidc_accepts_only_exact_trusted_service_account_binding(monkeypatch) -> None:
    class JwkClient:
        def __init__(self, _url):
            pass

        def get_signing_key_from_jwt(self, _token):
            return SimpleNamespace(key="test-key")

    claims = {
        # Keycloak commonly uses an opaque subject and the exact service
        # account name in preferred_username.
        "sub": "8128b756-7fd8-4b20-bdf9-7fb754a2af19",
        "preferred_username": "service-account-akb-rag-service",
        "azp": "akb-rag-service",
        "realm_access": {"roles": ["service_rag"]},
    }
    monkeypatch.setattr(auth_module, "PyJWKClient", JwkClient)
    monkeypatch.setattr(auth_module.jwt, "decode", lambda *_args, **_kwargs: claims)
    request = Request({
        "type": "http",
        "headers": [(b"authorization", b"Bearer signed-token")],
    })

    principal = _oidc_principal(request, _settings())

    assert principal.service_identity is True
    assert principal.service_client_id == "akb-rag-service"
    assert principal.subject_id == claims["sub"]

    claims["preferred_username"] = "service-account-aiip-service"
    with pytest.raises(HTTPException) as mismatch:
        _oidc_principal(request, _settings())
    assert mismatch.value.status_code == 403
    assert mismatch.value.detail["error"]["code"] == "untrusted_service_identity"


def test_oidc_user_flow_on_trusted_client_is_not_promoted_to_service(monkeypatch) -> None:
    class JwkClient:
        def __init__(self, _url):
            pass

        def get_signing_key_from_jwt(self, _token):
            return SimpleNamespace(key="test-key")

    projection = AccessProjection(
        capabilities=frozenset({"akb:chat"}),
        scopes=frozenset({"public"}),
        organization_id="org_stratos",
        identity_active=True,
        membership_active=True,
        application_access_active=True,
    )
    monkeypatch.setattr(auth_module, "PyJWKClient", JwkClient)
    monkeypatch.setattr(
        auth_module.jwt,
        "decode",
        lambda *_args, **_kwargs: {
            "sub": "user-123",
            "preferred_username": "user-123",
            "azp": "akb-rag-service",
            "exp": 2_000_000_000,
        },
    )
    monkeypatch.setattr(
        auth_module,
        "governance_client",
        lambda _settings: SimpleNamespace(user_projection=lambda *_args, **_kwargs: projection),
    )
    request = Request({
        "type": "http",
        "headers": [(b"authorization", b"Bearer signed-token")],
    })

    principal = _oidc_principal(request, _settings())

    assert principal.service_identity is False
    assert principal.service_client_id is None
    assert principal.scopes == {"public"}


def test_service_decision_uses_fixed_akb_central_identity(monkeypatch) -> None:
    calls = []
    service_binding = _service_policy()

    class Client:
        def service_policy_binding(self):
            return (
                service_binding.model_dump(mode="json", by_alias=True, exclude_none=False),
                canonical_policy_hash(service_binding),
            )

        def decide(self, **kwargs):
            calls.append(kwargs)
            return {"decision": "ALLOW", "reasonCodes": ["CAPABILITY_ALLOW"]}

    monkeypatch.setattr(api_module, "get_settings", lambda: _settings())
    monkeypatch.setattr(api_module, "governance_client", lambda _settings: Client())
    principal = Principal(
        subject_id="service-account-akb-rag-service",
        roles={"service_rag"},
        groups=set(),
        service_identity=True,
        service_client_id="akb-rag-service",
        application_access_active=False,
    )

    with pytest.raises(HTTPException) as denied:
        _service_action_decision(
            principal=principal,
            subject_id="service-account-aiip-service",
            action="rag.query",
            document=None,
        )
    assert denied.value.status_code == 403

    decision = _service_action_decision(
        principal=principal,
        subject_id=principal.subject_id,
        action="rag.query",
        document=None,
    )

    assert decision.allowed is True
    assert calls == [{
        "capability_id": "akb:chat",
        "operation": "access",
        "scope": {"type": "organization", "id": "org_stratos"},
        "policy_binding": None,
        "policy_hash": None,
    }]
    assert _audit_service_decision_coordinates("aiip.harmonize.completed") == ("akb:chat", "ai")
    assert _audit_service_decision_coordinates("ingestion.job.completed") == ("akb:manage_document", "upload")

    audit_capability, audit_operation = _audit_service_decision_coordinates("aiip.harmonize.completed")
    audit_decision = _service_action_decision(
        principal=principal,
        subject_id=principal.subject_id,
        action="audit.write",
        document=None,
        capability_override=audit_capability,
        operation_override=audit_operation,
    )
    assert audit_decision.allowed is True
    assert calls[-1]["policy_binding"]["policyBindingId"] == "pol_akb_internal_source_v1"
    assert calls[-1]["policy_hash"] == canonical_policy_hash(service_binding)


def test_ingestion_service_document_transport_uses_fixed_central_identity(
    monkeypatch,
) -> None:
    binding = _policy()
    document = _document(binding)
    principal = Principal(
        subject_id="service-account-svc-ingestion",
        roles={"service_ingestion"},
        groups=set(),
        service_identity=True,
        service_client_id="svc-ingestion",
        application_access_active=False,
    )
    calls = []

    class Client:
        def decide(self, **kwargs):
            calls.append(kwargs)
            return {"decision": "ALLOW", "reasonCodes": ["CAPABILITY_ALLOW"]}

    monkeypatch.setattr(permissions_module, "get_settings", lambda: _settings())
    monkeypatch.setattr(permissions_module, "governance_client", lambda _settings: Client())

    read_decision = evaluate_runtime_document_access(
        principal,
        "document.read",
        document,
    )
    ingest_decision = evaluate_runtime_document_access(
        principal,
        "document.ingest",
        document,
    )

    assert read_decision.allowed is True
    assert ingest_decision.allowed is True
    assert [call["operation"] for call in calls] == ["read", "upload"]
    assert [call["capability_id"] for call in calls] == [
        "akb:read_document",
        "akb:manage_document",
    ]
    assert all(call["credential_token"] is None for call in calls)


def test_rag_service_client_is_default_denied_on_document_registry_routes(client) -> None:
    headers = {
        "X-AKL-Subject": "service-account-akb-rag-service",
        "X-AKL-Roles": "service_rag",
        "X-AKL-Service-Client-ID": "akb-rag-service",
    }

    listing = client.get("/api/v1/documents", headers=headers)
    deletion = client.delete("/api/v1/documents/doc-any", headers=headers)

    assert listing.status_code == 403
    assert listing.json()["error"]["code"] == "service_route_forbidden"
    assert deletion.status_code == 403
    assert deletion.json()["error"]["code"] == "service_route_forbidden"

    forged_subject = client.get(
        "/api/v1/documents",
        headers={
            "X-AKL-Subject": "user-attacker",
            "X-AKL-Service-Client-ID": "akb-rag-service",
        },
    )
    assert forged_subject.status_code == 403
    assert forged_subject.json()["error"]["code"] == "untrusted_service_identity"


def test_budget_upload_service_is_limited_to_dedicated_route() -> None:
    settings = _settings(
        AKL_TRUSTED_SERVICE_CLIENT_IDS=(
            "akb-rag-service,aiip-document-service,stratos-akb-service,svc-ingestion"
        ),
        AKL_SERVICE_CLIENT_ROUTE_GRANTS=(
            "akb-rag-service=authz|audit|idempotency,"
            "aiip-document-service=aiip-upload,"
            "stratos-akb-service=stratos-budget-upload,"
            "svc-ingestion=authz|audit|documents-read|ingestion-status"
        ),
    )
    principal = Principal(
        subject_id="service-account-stratos-akb-service",
        roles={"service_ingestion"},
        groups=set(),
        service_identity=True,
        service_client_id="stratos-akb-service",
        application_access_active=False,
    )

    dedicated = Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "https",
            "path": (
                "/api/v1/integrations/stratos-budget-upload/"
                "external-documents/upsert"
            ),
            "raw_path": b"",
            "query_string": b"",
            "headers": [],
            "client": ("testclient", 50000),
            "server": ("testserver", 443),
        }
    )
    assert _service_route_for_request(dedicated) == "stratos-budget-upload"
    _enforce_service_route(principal, dedicated, settings)

    without_required_role = Principal(
        subject_id="service-account-stratos-akb-service",
        roles={"stratos_user"},
        groups=set(),
        service_identity=True,
        service_client_id="stratos-akb-service",
        application_access_active=False,
    )
    with pytest.raises(HTTPException) as role_exc:
        _enforce_service_route(without_required_role, dedicated, settings)
    assert role_exc.value.status_code == 403
    assert role_exc.value.detail["error"]["code"] == "service_route_forbidden"

    generic_write = Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "https",
            "path": "/api/v1/documents",
            "raw_path": b"",
            "query_string": b"",
            "headers": [],
            "client": ("testclient", 50000),
            "server": ("testserver", 443),
        }
    )
    with pytest.raises(HTTPException) as exc_info:
        _enforce_service_route(principal, generic_write, settings)
    assert exc_info.value.status_code == 403
    assert exc_info.value.detail["error"]["code"] == "service_route_forbidden"


def _policy(scope_id: str = "it") -> InformationPolicyBinding:
    return InformationPolicyBinding.model_validate({
        "schemaVersion": "stratos-information-policy-2",
        "policyBindingId": "pol_scopebinding01",
        "policyVersion": "information-policy-2.0.0",
        "issuedAt": "2026-07-14T00:00:00Z",
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


def _service_policy() -> InformationPolicyBinding:
    return InformationPolicyBinding.model_validate({
        "schemaVersion": "stratos-information-policy-2",
        "policyBindingId": "pol_akb_internal_source_v1",
        "policyVersion": "information-policy-2.0.0",
        "issuedAt": "2026-07-14T00:00:00Z",
        "handlingClass": "INTERNAL",
        "legalClassification": "NONE",
        "tlp": None,
        "pap": None,
        "contentCategories": ["AUDIT"],
        "audience": {
            "organizationId": "org_stratos",
            "scopeType": "organization",
            "scopeIds": [],
            "recipientSubjectIds": [],
        },
        "obligations": ["AUDIT_ACCESS", "NO_PUBLIC_EXPORT"],
    })


def _public_policy() -> InformationPolicyBinding:
    return InformationPolicyBinding.model_validate({
        "schemaVersion": "stratos-information-policy-2",
        "policyBindingId": "pol_akb_public_source_v1",
        "policyVersion": "information-policy-2.0.0",
        "issuedAt": "2026-07-14T00:00:00Z",
        "handlingClass": "PUBLIC",
        "legalClassification": "NONE",
        "tlp": None,
        "pap": None,
        "contentCategories": ["PUBLIC_INFORMATION"],
        "audience": {
            "organizationId": "org_stratos",
            "scopeType": "organization",
            "scopeIds": [],
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


def _official_public_document() -> Document:
    binding = _public_policy()
    return Document(
        document_id="doc_official_public",
        title="Official public source",
        document_type="methodology",
        status="valid",
        classification="public",
        owner_id="user-manager",
        tags=["official-public-reference", "official-source-collection:nukib"],
        document_metadata={
            "source_model": "official-public-reference-v1",
            "source_public": True,
            "audience": "organization",
            "anonymous_publication": False,
            "collection_id": "nukib",
            "authority": "NÚKIB",
            "canonical_url": "https://nukib.gov.cz/example.pdf",
        },
        policy_binding_id=binding.policy_binding_id,
        policy_version=binding.policy_version,
        policy_hash=canonical_policy_hash(binding),
        policy_summary=binding.model_dump(mode="json", by_alias=True, exclude_none=False),
        governance_scope_type="organization",
        governance_scope_id="org_stratos",
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


def test_official_public_source_runtime_decision_uses_fixed_service_identity(
    monkeypatch,
) -> None:
    document = _official_public_document()
    principal = Principal(
        subject_id="user-manager",
        roles={"stratos_user"},
        groups=set(),
        capabilities={"akb:manage_document"},
        scopes={"organization:org_stratos"},
        dynamic_access_loaded=True,
        bearer_token="interactive-user-token",
    )
    context = SubjectContext(
        subject_id="user-manager",
        roles={"stratos_user"},
        groups=set(),
        capabilities={"akb:manage_document"},
        scopes={"organization:org_stratos"},
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
            return {"decision": "ALLOW", "reasonCodes": ["ACCESS_ALLOW"]}

    monkeypatch.setattr(permissions_module, "get_settings", lambda: _settings())
    monkeypatch.setattr(permissions_module, "governance_client", lambda _settings: Client())

    local = evaluate_document_access(context, "document.update", document)
    decision = evaluate_runtime_document_access(
        principal,
        "document.update",
        document,
        local,
    )

    assert is_official_public_source_document(document) is True
    assert local.allowed is True
    assert decision.allowed is True
    assert calls[0]["credential_token"] is None
    assert calls[0]["capability_id"] == "akb:manage_document"


def test_public_chat_scope_can_query_but_not_read_valid_official_reference(
    monkeypatch,
) -> None:
    document = _official_public_document()
    principal = Principal(
        subject_id="user-employee",
        roles={"stratos_user"},
        groups=set(),
        capabilities={"akb:chat", "akb:read_document"},
        scopes={"public"},
        organization_id="org_stratos",
        dynamic_access_loaded=True,
        bearer_token="verified-user-token",
    )
    context = SubjectContext(
        subject_id="user-employee",
        roles={"stratos_user"},
        groups=set(),
        capabilities={"akb:chat", "akb:read_document"},
        scopes={"public"},
        organization_id="org_stratos",
        identity_active=True,
        membership_active=True,
        application_access_active=True,
        access_v2=True,
    )

    class Client:
        def decide(self, **_kwargs):
            raise AssertionError("official public RAG must not use generic organization-scope PDP")

    monkeypatch.setattr(permissions_module, "get_settings", lambda: _settings())
    monkeypatch.setattr(permissions_module, "governance_client", lambda _settings: Client())

    local = evaluate_document_access(context, "rag.query", document)
    runtime = evaluate_runtime_document_access(principal, "rag.query", document, local)
    direct_read = evaluate_document_access(context, "document.read", document)

    assert local.allowed is True
    assert local.constraints["official_public_reference"] is True
    assert runtime.allowed is True
    assert direct_read.allowed is False
    assert direct_read.reason_codes == ("PUBLIC_PROJECTION_REQUIRED",)


def test_public_chat_scope_denies_inactive_or_untrusted_official_reference() -> None:
    document = _official_public_document()
    context = SubjectContext(
        subject_id="user-employee",
        roles={"stratos_user"},
        groups=set(),
        capabilities={"akb:chat"},
        scopes={"public"},
        organization_id="org_stratos",
        identity_active=True,
        membership_active=True,
        application_access_active=True,
        access_v2=True,
    )

    document.status = "archived"
    archived = evaluate_document_access(context, "rag.query", document)
    document.status = "valid"
    document.document_metadata["source_model"] = "untrusted-source"
    untrusted = evaluate_document_access(context, "rag.query", document)
    inactive_context = SubjectContext(
        **{
            **context.__dict__,
            "identity_active": False,
        },
    )
    inactive = evaluate_document_access(inactive_context, "rag.query", document)

    assert archived.allowed is False
    assert archived.reason_codes == ("PUBLICATION_INACTIVE",)
    assert untrusted.allowed is False
    assert untrusted.reason_codes == ("PUBLICATION_INACTIVE",)
    assert inactive.allowed is False
    assert inactive.reason_codes == ("IDENTITY_DISABLED",)


def test_official_public_source_exact_version_decision_uses_fixed_service_identity(
    monkeypatch,
) -> None:
    document = _official_public_document()
    binding = _public_policy()
    policy_hash = canonical_policy_hash(binding)
    version = DocumentVersion(
        document_version_id="ver_official_public_1",
        document_id=document.document_id,
        version_label="1.0",
        status="valid",
        organization_id="org_stratos",
        policy_binding_id=binding.policy_binding_id,
        policy_version=binding.policy_version,
        policy_hash=policy_hash,
        policy_summary=binding.model_dump(mode="json", by_alias=True, exclude_none=False),
        governance_scope_type="organization",
        governance_scope_id="org_stratos",
    )
    authority = DocumentVersionAuthority(
        organization_id="org_stratos",
        governed_resource_id="gir_official_public_version_1",
        governed_source_version=version.document_version_id,
        governed_parent_resource_id="gir_official_public_document",
        policy_binding_id=binding.policy_binding_id,
        policy_version=binding.policy_version,
        policy_hash=policy_hash,
        governance_scope={"type": "organization", "id": "org_stratos"},
        governance_scope_hash="sha256:" + "a" * 64,
        policy_binding=binding,
    )
    principal = Principal(
        subject_id="user-manager",
        roles={"stratos_user"},
        groups=set(),
        capabilities={"akb:manage_document"},
        scopes={"organization:org_stratos"},
        dynamic_access_loaded=True,
        bearer_token="interactive-user-token",
    )
    calls = []

    class Client:
        def decide(self, **kwargs):
            calls.append(kwargs)
            return {"decision": "ALLOW", "reasonCodes": ["ACCESS_ALLOW"]}

    monkeypatch.setattr(permissions_module, "get_settings", lambda: _settings())
    monkeypatch.setattr(permissions_module, "governance_client", lambda _settings: Client())

    result = evaluate_runtime_document_version_access(
        principal,
        "document.ingest",
        document,
        version,
        authority,
        Decision(True, "local allow", {}),
    )

    assert result.allowed is True
    assert calls[0]["credential_token"] is None
    assert calls[0]["capability_id"] == "akb:manage_document"


def test_public_chat_scope_keeps_exact_valid_official_reference_version(
    monkeypatch,
) -> None:
    document = _official_public_document()
    binding = _public_policy()
    policy_hash = canonical_policy_hash(binding)
    version = DocumentVersion(
        document_version_id="ver_official_public_history",
        document_id=document.document_id,
        version_label="1.0",
        status="valid",
        organization_id="org_stratos",
        policy_binding_id=binding.policy_binding_id,
        policy_version=binding.policy_version,
        policy_hash=policy_hash,
        policy_summary=binding.model_dump(mode="json", by_alias=True, exclude_none=False),
        governance_scope_type="organization",
        governance_scope_id="org_stratos",
    )
    authority = DocumentVersionAuthority(
        organization_id="org_stratos",
        governed_resource_id="gir_official_public_history_version",
        governed_source_version=version.document_version_id,
        governed_parent_resource_id="gir_official_public_history_document",
        policy_binding_id=binding.policy_binding_id,
        policy_version=binding.policy_version,
        policy_hash=policy_hash,
        governance_scope={"type": "organization", "id": "org_stratos"},
        governance_scope_hash="sha256:" + "b" * 64,
        policy_binding=binding,
    )
    context = SubjectContext(
        subject_id="user-employee",
        roles={"stratos_user"},
        groups=set(),
        capabilities={"akb:chat", "akb:read_document"},
        scopes={"public"},
        organization_id="org_stratos",
        identity_active=True,
        membership_active=True,
        application_access_active=True,
        access_v2=True,
    )
    principal = Principal(
        subject_id="user-employee",
        roles={"stratos_user"},
        groups=set(),
        capabilities={"akb:chat", "akb:read_document"},
        scopes={"public"},
        organization_id="org_stratos",
        dynamic_access_loaded=True,
        bearer_token="verified-user-token",
    )

    local = evaluate_document_version_access(
        context,
        "rag.query",
        version,
        authority,
        official_public_reference=True,
    )
    without_official_source = evaluate_document_version_access(
        context,
        "rag.query",
        version,
        authority,
    )
    direct_read = evaluate_document_version_access(
        context,
        "document.read",
        version,
        authority,
        official_public_reference=True,
    )

    class Client:
        def decide(self, **_kwargs):
            raise AssertionError(
                "official public historical RAG must not use generic organization-scope PDP"
            )

    monkeypatch.setattr(permissions_module, "get_settings", lambda: _settings())
    monkeypatch.setattr(permissions_module, "governance_client", lambda _settings: Client())
    runtime = evaluate_runtime_document_version_access(
        principal,
        "rag.query",
        document,
        version,
        authority,
        local,
    )

    assert local.allowed is True
    assert local.constraints["official_public_reference"] is True
    assert local.reason_codes == ("VERSION_OFFICIAL_PUBLIC_REFERENCE_ALLOW",)
    assert runtime.allowed is True
    assert without_official_source.allowed is False
    assert without_official_source.reason_codes == ("VERSION_SCOPE_MISMATCH",)
    assert direct_read.allowed is False
    assert direct_read.reason_codes == ("VERSION_SCOPE_MISMATCH",)


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
                    "parentId": "gir_source_parent",
                    "scope": {"type": "organization_unit", "id": "it"},
                    "policyAssignment": "EXPLICIT",
                    "explicitPolicyBindingId": binding.policy_binding_id,
                    "confirmedBySubjectId": "user-current-actor",
                    "effectivePolicy": {
                        "policyBindingId": binding.policy_binding_id,
                        "policyHash": canonical_policy_hash(binding),
                        "originatorId": None,
                        "originator": None,
                        "issuedAt": "2026-07-14T00:00:00Z",
                        "reviewAt": None,
                    },
                },
            )

    monkeypatch.setattr("app.access_governance.httpx.Client", Client)
    settings = _settings(
        AKL_STRATOS_INFORMATION_RESOURCES_URL="https://stratos.example/api/v1/information/resources"
    )
    registration = StratosGovernanceClient(settings).register_information_resource(
        credential_token="runtime-token",
        audit_actor_subject_id="user-owner",
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
    assert "actorSubjectId" not in captured["json"]
    assert captured["json"]["metadata"]["auditActorSubjectId"] == "user-owner"
    assert captured["json"]["parentId"] == "gir_source_parent"
    assert captured["json"]["scope"] == {"type": "organization_unit", "id": "it"}


def test_service_registration_without_delegated_actor_uses_fixed_akb_identity(monkeypatch) -> None:
    binding = _policy()
    settings = _settings(
        AKL_STRATOS_INFORMATION_RESOURCES_URL="https://stratos.example/api/v1/information/resources",
        AKB_POLICY_SERVICE_TOKEN="runtime-token",
    )
    monkeypatch.setattr(api_module, "get_settings", lambda: settings)
    principal = Principal(
        subject_id="service-account-source-app",
        roles={"service_integration"},
        groups=set(),
        service_identity=True,
    )

    captured = {}

    class Client:
        def register_information_resource(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                resource_id="gir_fixed_service",
                source_version="gresver_1",
                policy_binding_id=binding.policy_binding_id,
                policy_hash=canonical_policy_hash(binding),
            )

    monkeypatch.setattr(api_module, "governance_client", lambda _settings: Client())
    result = _register_governed_resource(
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

    assert result["governance_registration_status"] == "REGISTERED"
    assert captured["credential_token"] == "runtime-token"
    assert captured["audit_actor_subject_id"] is None


def test_interactive_registration_uses_fixed_akb_identity_and_human_audit(monkeypatch) -> None:
    binding = _policy()
    settings = _settings(
        AKL_STRATOS_INFORMATION_RESOURCES_URL="https://stratos.example/api/v1/information/resources",
        AKB_POLICY_SERVICE_TOKEN="fixed-akb-token",
    )
    monkeypatch.setattr(api_module, "get_settings", lambda: settings)
    principal = Principal(
        subject_id="user-manager",
        roles={"stratos_user"},
        groups=set(),
        capabilities={"akb:upload", "akb:manage_document"},
        bearer_token="interactive-user-token",
    )
    captured = {}

    class Client:
        def register_information_resource(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                resource_id="gir_interactive_document",
                source_version="gresver_interactive_1",
                policy_binding_id=binding.policy_binding_id,
                policy_hash=canonical_policy_hash(binding),
            )

    monkeypatch.setattr(api_module, "governance_client", lambda _settings: Client())
    result = _register_governed_resource(
        principal=principal,
        resource_type="document",
        resource_id="doc_interactive",
        source_version="gresver_interactive_1",
        title="Interactive document",
        policy=binding,
        requested_scope=None,
        parent_resource_id=None,
        reason="test interactive registration",
    )

    assert result["governance_registration_status"] == "REGISTERED"
    assert captured["credential_token"] == "fixed-akb-token"
    assert captured["audit_actor_subject_id"] == "user-manager"


def test_official_public_source_marker_requires_exact_public_policy_shape() -> None:
    payload = DocumentCreate.model_validate({
        "title": "Official source",
        "document_type": "methodology",
        "owner_id": "user-manager",
        "classification": "public",
        "information_policy": _public_policy().model_dump(mode="json", by_alias=True),
        "tags": ["official-public-reference", "official-source-collection:nukib"],
        "metadata": {
            "source_model": "official-public-reference-v1",
            "source_public": True,
            "audience": "organization",
            "anonymous_publication": False,
            "collection_id": "nukib",
            "authority": "NÚKIB",
            "canonical_url": "https://nukib.gov.cz/example.pdf",
        },
    })

    assert _is_official_public_source_create(payload) is True
    assert _is_official_public_source_create(
        payload.model_copy(update={"metadata": {**payload.metadata, "source_public": False}})
    ) is False
    assert _is_official_public_source_create(
        payload.model_copy(update={"tags": ["official-source-collection:nukib"]})
    ) is False


def test_official_public_registration_uses_fixed_identity_and_human_audit(monkeypatch) -> None:
    binding = _public_policy()
    settings = _settings(
        AKL_STRATOS_INFORMATION_RESOURCES_URL="https://stratos.example/api/v1/information/resources",
        AKB_POLICY_SERVICE_TOKEN="fixed-akb-token",
    )
    monkeypatch.setattr(api_module, "get_settings", lambda: settings)
    principal = Principal(
        subject_id="user-manager",
        roles={"stratos_user"},
        groups=set(),
        capabilities={"akb:upload", "akb:manage_document"},
        bearer_token="interactive-user-token",
    )
    captured = {}

    class Client:
        def register_information_resource(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                resource_id="gir_official_source",
                source_version="gresver_public_1",
                policy_binding_id=binding.policy_binding_id,
                policy_hash=canonical_policy_hash(binding),
            )

    monkeypatch.setattr(api_module, "governance_client", lambda _settings: Client())
    result = _register_governed_resource(
        principal=principal,
        resource_type="document",
        resource_id="doc_official_source",
        source_version="gresver_public_1",
        title="Official source",
        policy=binding,
        requested_scope=None,
        parent_resource_id=None,
        reason="test official source registration",
        delegated_actor_subject_id=principal.subject_id,
        use_fixed_akb_identity=True,
    )

    assert result["governance_registration_status"] == "REGISTERED"
    assert captured["credential_token"] == "fixed-akb-token"
    assert captured["audit_actor_subject_id"] == "user-manager"


def test_publication_write_forwards_interactive_bearer_and_public_decision_is_anonymous(
    monkeypatch,
) -> None:
    binding = _policy()
    calls = []

    class Client:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def request(self, method, url, **kwargs):
            calls.append({"method": method, "url": url, **kwargs})
            if url.endswith("/policy/public-decisions"):
                return SimpleNamespace(
                    status_code=200,
                    json=lambda: {
                        "decision": "DENY",
                        "decisionId": "pdec-test",
                        "reasonCodes": ["PUBLICATION_INACTIVE"],
                        "obligations": ["AUDIT_ACCESS"],
                        "policyVersion": binding.policy_version,
                        "publication": None,
                    },
                )
            response_status = kwargs["json"]["status"]
            return SimpleNamespace(
                status_code=200,
                json=lambda: {
                    "id": "ipub-akb-test",
                    "application": "AKB",
                    "resourceType": "document_version",
                    "resourceId": "ver-public-1",
                    "sourceVersion": "ver-public-1",
                    "governedResourceId": "gir-public-1",
                    "policyBindingId": binding.policy_binding_id,
                    "policyHash": canonical_policy_hash(binding),
                    "publicSlug": "public-guide",
                    "status": response_status,
                    "publishedAt": (
                        "2026-07-13T12:00:00Z" if response_status == "PUBLISHED" else None
                    ),
                    "revokedAt": (
                        "2026-07-13T13:00:00Z" if response_status == "REVOKED" else None
                    ),
                },
            )

    monkeypatch.setattr("app.access_governance.httpx.Client", Client)
    client = StratosGovernanceClient(
        _settings(
            AKL_STRATOS_INFORMATION_PUBLICATIONS_URL="https://stratos.example/api/v1/information/publications",
            AKL_STRATOS_PUBLIC_DECISIONS_URL="https://stratos.example/api/v1/policy/public-decisions",
        )
    )
    publication = client.upsert_information_publication(
        credential_token="interactive-user-token",
        resource_type="document_version",
        resource_id="ver-public-1",
        source_version="ver-public-1",
        scope={"type": "organization", "id": "org_stratos"},
        policy_binding_id=binding.policy_binding_id,
        policy_hash=canonical_policy_hash(binding),
        public_slug="public-guide",
        status="PUBLISHED",
        reason="Approved public source",
    )
    decision = client.public_decide(public_slug="public-guide", operation="public_download")
    revoked = client.upsert_information_publication(
        credential_token="interactive-user-token",
        resource_type="document_version",
        resource_id="ver-public-1",
        source_version="ver-public-1",
        scope={"type": "organization", "id": "client-must-not-send-this"},
        policy_binding_id=binding.policy_binding_id,
        policy_hash=canonical_policy_hash(binding),
        public_slug="public-guide",
        status="REVOKED",
        reason="Public approval withdrawn",
    )

    assert publication.publication_id == "ipub-akb-test"
    assert publication.policy_hash == canonical_policy_hash(binding)
    assert calls[0]["headers"]["Authorization"] == "Bearer interactive-user-token"
    assert calls[0]["json"]["sourceVersion"] == "ver-public-1"
    assert calls[0]["json"]["status"] == "PUBLISHED"
    assert calls[1]["url"].endswith("/policy/public-decisions")
    assert "Authorization" not in calls[1]["headers"]
    assert calls[1]["json"] == {
        "publicSlug": "public-guide",
        "operation": "public_download",
    }
    assert decision["decision"] == "DENY"
    assert calls[2]["json"] == {
        "sourceVersion": "ver-public-1",
        "status": "REVOKED",
        "reason": "Public approval withdrawn",
    }
    assert revoked.revoked_at == "2026-07-13T13:00:00Z"


@pytest.mark.parametrize(
    "response_override",
    [
        {"revokedAt": None},
        {"policyHash": f"sha256:{'f' * 64}"},
    ],
)
def test_revoke_rejects_missing_timestamp_or_foreign_policy_hash(
    monkeypatch,
    response_override,
) -> None:
    binding = _policy()

    class Client:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def request(self, _method, _url, **_kwargs):
            body = {
                "id": "ipub-akb-test",
                "application": "AKB",
                "resourceType": "document_version",
                "resourceId": "ver-public-1",
                "sourceVersion": "ver-public-1",
                "governedResourceId": "gir-public-1",
                "policyBindingId": binding.policy_binding_id,
                "policyHash": canonical_policy_hash(binding),
                "publicSlug": "public-guide",
                "status": "REVOKED",
                "publishedAt": "2026-07-13T12:00:00Z",
                "revokedAt": "2026-07-13T13:00:00Z",
                **response_override,
            }
            return SimpleNamespace(status_code=200, json=lambda: body)

    monkeypatch.setattr("app.access_governance.httpx.Client", Client)
    client = StratosGovernanceClient(
        _settings(
            AKL_STRATOS_INFORMATION_PUBLICATIONS_URL=(
                "https://stratos.example/api/v1/information/publications"
            ),
        )
    )

    with pytest.raises(GovernanceUnavailable):
        client.upsert_information_publication(
            credential_token="interactive-user-token",
            resource_type="document_version",
            resource_id="ver-public-1",
            source_version="ver-public-1",
            scope={"type": "organization", "id": "org_stratos"},
            policy_binding_id=binding.policy_binding_id,
            policy_hash=canonical_policy_hash(binding),
            public_slug="public-guide",
            status="REVOKED",
            reason="Public approval withdrawn",
        )
