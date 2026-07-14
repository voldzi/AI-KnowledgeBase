from __future__ import annotations

from types import SimpleNamespace

import jwt

import app.permissions as permissions_module
from app.auth import Principal, get_current_principal
from app.config import get_settings
from app.information_policy import InformationPolicyBinding, canonical_policy_hash
from app.models import Document, DocumentVersion


def _document_version(
    client,
    headers,
    *,
    access_policies: list[dict] | None = None,
) -> tuple[str, str]:
    payload = {
        "title": "Ingestion authorization test",
        "document_type": "directive",
        "owner_id": "user_admin",
        "classification": "internal",
        "tags": ["ingestion"],
        "information_policy": {
            "schemaVersion": "stratos-information-policy-2",
            "policyBindingId": "pb_ingestion_authorization_test",
            "policyVersion": "information-policy-2.0.0",
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
            "obligations": ["AUDIT_ACCESS"],
            "originatorId": "user_admin",
            "issuedAt": "2026-07-14T08:00:00Z",
            "reviewAt": None,
        },
    }
    if access_policies is not None:
        payload["access_policies"] = access_policies
    created = client.post(
        "/api/v1/documents",
        headers=headers,
        json=payload,
    )
    assert created.status_code == 201, created.text
    document_id = created.json()["document_id"]
    version = client.post(
        f"/api/v1/documents/{document_id}/versions",
        headers=headers,
        json={
            "version_label": "1.0",
            "source_file_uri": "s3://akl-documents/test/source.pdf",
            "file_hash": "sha256:" + "a" * 64,
        },
    )
    assert version.status_code == 201, version.text
    return document_id, version.json()["document_version_id"]


def _ingestion_service_headers(correlation_id: str) -> dict[str, str]:
    return {
        "X-AKL-Subject": "service-account-svc-ingestion",
        "X-AKL-Service-Client-ID": "svc-ingestion",
        "X-AKL-Roles": "service_ingestion",
        "X-Request-ID": correlation_id,
        "X-Correlation-ID": correlation_id,
    }


def _restricted_historical_version(client, headers) -> tuple[str, str]:
    document_id, _ = _document_version(client, headers)
    version = client.post(
        f"/api/v1/documents/{document_id}/versions",
        headers=headers,
        json={
            "version_label": "0.9-restricted",
            "source_file_uri": "s3://akl-documents/test/restricted-history.pdf",
            "file_hash": "sha256:" + "b" * 64,
            "governance_scope": {
                "type": "organization_unit",
                "id": "finance",
            },
            "information_policy": {
                "schemaVersion": "stratos-information-policy-2",
                "policyBindingId": "pb_ingestion_restricted_history",
                "policyVersion": "information-policy-2.0.0",
                "handlingClass": "RESTRICTED",
                "legalClassification": "NONE",
                "tlp": "TLP:AMBER",
                "pap": None,
                "contentCategories": ["FINANCIAL"],
                "audience": {
                    "organizationId": "org_stratos",
                    "scopeType": "organization_unit",
                    "scopeIds": ["finance"],
                    "recipientSubjectIds": [],
                },
                "obligations": ["AUDIT_ACCESS"],
                "originatorId": "user_admin",
                "issuedAt": "2026-07-14T08:30:00Z",
                "reviewAt": None,
            },
        },
    )
    assert version.status_code == 201, version.text
    return document_id, version.json()["document_version_id"]


def _mark_indexed(client, headers, document_id: str, version_id: str, job_id: str) -> None:
    for expected_status, next_status in [
        (None, "QUEUED"),
        (job_id, "INGESTING"),
        (job_id, "INDEXED"),
    ]:
        response = client.patch(
            f"/api/v1/documents/{document_id}/external-references/current",
            headers=headers,
            json={
                "current_document_version_id": version_id,
                "expected_current_ingestion_job_id": expected_status,
                "current_ingestion_job_id": job_id,
                "current_ingestion_status": next_status,
            },
        )
        assert response.status_code == 200, response.text


def test_registry_issues_and_exactly_confirms_actor_bound_proof(client, admin_headers) -> None:
    document_id, version_id = _document_version(client, admin_headers)
    correlation_id = "corr-ingestion-proof"
    idempotency_key = "proof:test:document-version"
    actor_headers = {
        **admin_headers,
        "X-Request-ID": correlation_id,
        "X-Correlation-ID": correlation_id,
    }
    issued = client.post(
        f"/api/v1/documents/{document_id}/versions/{version_id}/ingestion-authorization",
        headers=actor_headers,
        json={
            "action": "document.ingest",
            "correlation_id": correlation_id,
            "idempotency_key": idempotency_key,
        },
    )
    assert issued.status_code == 200, issued.text
    proof = issued.json()
    assert proof["confirmed_subject_id"] == "user_admin"
    assert proof["document_id"] == document_id
    assert proof["document_version_id"] == version_id
    assert proof["authorization_token"]

    confirmed = client.post(
        "/api/v1/integrations/ingestion/authorizations/confirm",
        headers=_ingestion_service_headers(correlation_id),
        json={
            "authorization_token": proof["authorization_token"],
            "expected_subject_id": "user_admin",
            "action": "document.ingest",
            "document_id": document_id,
            "document_version_id": version_id,
            "correlation_id": correlation_id,
            "idempotency_key": idempotency_key,
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["authorization_token"] is None
    assert confirmed.json()["authorization_id"] == proof["authorization_id"]
    assert confirmed.json()["confirmed_subject_id"] == "user_admin"

    spoofed = client.post(
        "/api/v1/integrations/ingestion/authorizations/confirm",
        headers=_ingestion_service_headers(correlation_id),
        json={
            "authorization_token": proof["authorization_token"],
            "expected_subject_id": "user-spoofed",
            "action": "document.ingest",
            "document_id": document_id,
            "document_version_id": version_id,
            "correlation_id": correlation_id,
            "idempotency_key": idempotency_key,
        },
    )
    assert spoofed.status_code == 403
    assert spoofed.json()["error"]["code"] == "ingestion_authorization_invalid"


def test_exact_version_policy_and_scope_are_authorized_centrally_and_bound_to_proof(
    client,
    admin_headers,
    db_session,
    monkeypatch,
) -> None:
    document_id, version_id = _restricted_historical_version(client, admin_headers)
    document = db_session.get(Document, document_id)
    version = db_session.get(DocumentVersion, version_id)
    assert document is not None
    assert version is not None
    document.governance_registration_status = "REGISTERED"
    document.governed_resource_id = f"gir_document_{document_id}"
    version.governance_registration_status = "REGISTERED"
    version.governed_resource_id = f"gir_version_{version_id}"
    version.governed_parent_resource_id = document.governed_resource_id
    db_session.commit()

    calls: list[dict] = []

    class Client:
        def decide(self, **kwargs):
            calls.append(kwargs)
            return {"decision": "ALLOW", "reasonCodes": ["POLICY_ALLOW"]}

    monkeypatch.setattr(
        permissions_module,
        "get_settings",
        lambda: SimpleNamespace(auth_mode="oidc"),
    )
    monkeypatch.setattr(
        permissions_module,
        "governance_client",
        lambda _settings: Client(),
    )
    principal = Principal(
        subject_id="user_finance_reader",
        roles={"stratos_user"},
        groups=set(),
        capabilities={"akb:read_document"},
        scopes={"organization", "organization_unit:finance"},
        organization_id="org_stratos",
        identity_active=True,
        membership_active=True,
        application_access_active=True,
        dynamic_access_loaded=True,
        bearer_token="verified-finance-reader-token",
    )
    client.app.dependency_overrides[get_current_principal] = lambda: principal
    correlation_id = "corr-version-central-proof"
    try:
        issued = client.post(
            f"/api/v1/documents/{document_id}/versions/{version_id}/ingestion-authorization",
            headers={
                "X-Request-ID": correlation_id,
                "X-Correlation-ID": correlation_id,
            },
            json={
                "action": "document.read",
                "correlation_id": correlation_id,
                "idempotency_key": "proof:version:central",
            },
        )
    finally:
        client.app.dependency_overrides.pop(get_current_principal, None)

    assert issued.status_code == 200, issued.text
    assert len(calls) == 2
    assert calls[0]["scope"] == {"type": "organization", "id": "org_stratos"}
    assert calls[1] == {
        "capability_id": "akb:read_document",
        "operation": "read",
        "scope": {"type": "organization_unit", "id": "finance"},
        "policy_binding": dict(version.policy_summary),
        "policy_hash": version.policy_hash,
        "credential_token": "verified-finance-reader-token",
    }

    settings = get_settings()
    claims = jwt.decode(
        issued.json()["authorization_token"],
        settings.ingestion_authorization_signing_secret,
        algorithms=["HS256"],
        audience="akb-ingestion-service",
        issuer="akb-registry",
    )
    assert claims["governed_resource_id"] == version.governed_resource_id
    assert claims["governed_source_version"] == version.governed_source_version
    assert claims["governed_parent_resource_id"] == document.governed_resource_id
    assert claims["policy_binding_id"] == version.policy_binding_id
    assert claims["policy_version"] == version.policy_version
    assert claims["policy_hash"] == version.policy_hash
    assert claims["governance_scope_hash"].startswith("sha256:")


def test_restrictive_historical_version_denies_root_scoped_actor(
    client,
    admin_headers,
) -> None:
    document_id, version_id = _restricted_historical_version(client, admin_headers)
    correlation_id = "corr-version-restricted-denied"
    denied = client.post(
        f"/api/v1/documents/{document_id}/versions/{version_id}/ingestion-authorization",
        headers={
            "X-AKL-Subject": "user_org_reader",
            "X-AKL-Roles": "stratos_user",
            "X-STRATOS-Capabilities": "akb:read_document",
            "X-STRATOS-Scopes": "organization",
            "X-STRATOS-Organization-ID": "org_stratos",
            "X-Request-ID": correlation_id,
            "X-Correlation-ID": correlation_id,
        },
        json={
            "action": "document.read",
            "correlation_id": correlation_id,
            "idempotency_key": "proof:version:restricted",
        },
    )

    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "forbidden"
    assert "VERSION_SCOPE_MISMATCH" in denied.json()["error"]["details"]["reason_codes"]


def test_confirmation_rejects_tampered_and_stale_version_authority(
    client,
    admin_headers,
    db_session,
) -> None:
    document_id, version_id = _document_version(client, admin_headers)
    correlation_id = "corr-version-authority-stale"
    idempotency_key = "proof:version:authority-stale"
    issued = client.post(
        f"/api/v1/documents/{document_id}/versions/{version_id}/ingestion-authorization",
        headers={
            **admin_headers,
            "X-Request-ID": correlation_id,
            "X-Correlation-ID": correlation_id,
        },
        json={
            "action": "document.read",
            "correlation_id": correlation_id,
            "idempotency_key": idempotency_key,
        },
    )
    assert issued.status_code == 200, issued.text
    settings = get_settings()
    claims = jwt.decode(
        issued.json()["authorization_token"],
        settings.ingestion_authorization_signing_secret,
        algorithms=["HS256"],
        audience="akb-ingestion-service",
        issuer="akb-registry",
    )

    for claim, changed_value in [
        ("policy_hash", "sha256:" + "f" * 64),
        ("governed_source_version", "ver_tampered_source"),
    ]:
        tampered_claims = {**claims, claim: changed_value}
        tampered_token = jwt.encode(
            tampered_claims,
            settings.ingestion_authorization_signing_secret,
            algorithm="HS256",
        )
        rejected = client.post(
            "/api/v1/integrations/ingestion/authorizations/confirm",
            headers=_ingestion_service_headers(correlation_id),
            json={
                "authorization_token": tampered_token,
                "expected_subject_id": "user_admin",
                "action": "document.read",
                "document_id": document_id,
                "document_version_id": version_id,
                "correlation_id": correlation_id,
                "idempotency_key": idempotency_key,
            },
        )
        assert rejected.status_code == 403
        assert rejected.json()["error"]["code"] == "ingestion_authorization_invalid"

    version = db_session.get(DocumentVersion, version_id)
    assert version is not None
    changed_policy_payload = {
        **dict(version.policy_summary),
        "policyBindingId": "pb_ingestion_authorization_changed",
        "issuedAt": "2026-07-14T09:00:00Z",
    }
    changed_policy = InformationPolicyBinding.model_validate(changed_policy_payload)
    version.policy_binding_id = changed_policy.policy_binding_id
    version.policy_version = changed_policy.policy_version
    version.policy_hash = canonical_policy_hash(changed_policy)
    version.policy_summary = changed_policy.model_dump(
        mode="json",
        by_alias=True,
        exclude_none=True,
    )
    db_session.commit()

    stale = client.post(
        "/api/v1/integrations/ingestion/authorizations/confirm",
        headers=_ingestion_service_headers(correlation_id),
        json={
            "authorization_token": issued.json()["authorization_token"],
            "expected_subject_id": "user_admin",
            "action": "document.read",
            "document_id": document_id,
            "document_version_id": version_id,
            "correlation_id": correlation_id,
            "idempotency_key": idempotency_key,
        },
    )
    assert stale.status_code == 403
    assert stale.json()["error"]["code"] == "ingestion_authorization_invalid"


def test_suspended_actor_cannot_mint_proof(client, admin_headers) -> None:
    document_id, version_id = _document_version(client, admin_headers)
    correlation_id = "corr-suspended-proof"
    response = client.post(
        f"/api/v1/documents/{document_id}/versions/{version_id}/ingestion-authorization",
        headers={
            **admin_headers,
            "X-STRATOS-Identity-Active": "false",
            "X-Request-ID": correlation_id,
            "X-Correlation-ID": correlation_id,
        },
        json={
            "action": "document.ingest",
            "correlation_id": correlation_id,
            "idempotency_key": "proof:suspended:actor",
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ingestion_authorization_actor_inactive"


def test_proof_is_bound_to_correlation_and_idempotency(client, admin_headers) -> None:
    document_id, version_id = _document_version(client, admin_headers)
    correlation_id = "corr-bound-proof"
    issued = client.post(
        f"/api/v1/documents/{document_id}/versions/{version_id}/ingestion-authorization",
        headers={
            **admin_headers,
            "X-Request-ID": correlation_id,
            "X-Correlation-ID": correlation_id,
        },
        json={
            "action": "document.ingest",
            "correlation_id": correlation_id,
            "idempotency_key": "proof:bound:original",
        },
    )
    assert issued.status_code == 200, issued.text

    changed = client.post(
        "/api/v1/integrations/ingestion/authorizations/confirm",
        headers=_ingestion_service_headers(correlation_id),
        json={
            "authorization_token": issued.json()["authorization_token"],
            "expected_subject_id": "user_admin",
            "action": "document.ingest",
            "document_id": document_id,
            "document_version_id": version_id,
            "correlation_id": correlation_id,
            "idempotency_key": "proof:bound:changed",
        },
    )

    assert changed.status_code == 403
    assert changed.json()["error"]["code"] == "ingestion_authorization_invalid"

    changed_action = client.post(
        "/api/v1/integrations/ingestion/authorizations/confirm",
        headers=_ingestion_service_headers(correlation_id),
        json={
            "authorization_token": issued.json()["authorization_token"],
            "expected_subject_id": "user_admin",
            "action": "document.read",
            "document_id": document_id,
            "document_version_id": version_id,
            "correlation_id": correlation_id,
            "idempotency_key": "proof:bound:original",
        },
    )
    assert changed_action.status_code == 403
    assert changed_action.json()["error"]["code"] == "ingestion_authorization_invalid"


def test_intelligence_scope_proof_is_exact_actor_and_document_set_bound(
    client,
    admin_headers,
) -> None:
    first_document_id, first_version_id = _document_version(client, admin_headers)
    second_document_id, second_version_id = _document_version(client, admin_headers)
    _mark_indexed(client, admin_headers, first_document_id, first_version_id, "ing_scope_first")
    _mark_indexed(client, admin_headers, second_document_id, second_version_id, "ing_scope_second")
    document_ids = sorted([first_document_id, second_document_id])
    correlation_id = "corr-intelligence-scope"
    idempotency_key = "intelligence:scope:exact"
    actor_headers = {
        **admin_headers,
        "X-Request-ID": correlation_id,
        "X-Correlation-ID": correlation_id,
    }
    issued = client.post(
        "/api/v1/intelligence/authorization",
        headers=actor_headers,
        json={
            "document_ids": list(reversed(document_ids)),
            "correlation_id": correlation_id,
            "idempotency_key": idempotency_key,
        },
    )
    assert issued.status_code == 200, issued.text
    proof = issued.json()
    assert proof["confirmed_subject_id"] == "user_admin"
    assert proof["action"] == "intelligence.query"
    assert proof["document_count"] == 2
    assert proof["document_scope_hash"].startswith("sha256:")
    assert [item["document_id"] for item in proof["documents"]] == document_ids

    confirmed = client.post(
        "/api/v1/integrations/ingestion/intelligence-authorizations/confirm",
        headers=_ingestion_service_headers(correlation_id),
        json={
            "authorization_token": proof["authorization_token"],
            "expected_subject_id": "user_admin",
            "documents": proof["documents"],
            "correlation_id": correlation_id,
            "idempotency_key": idempotency_key,
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["authorization_token"] is None
    assert confirmed.json()["document_scope_hash"] == proof["document_scope_hash"]

    changed_scope = client.post(
        "/api/v1/integrations/ingestion/intelligence-authorizations/confirm",
        headers=_ingestion_service_headers(correlation_id),
        json={
            "authorization_token": proof["authorization_token"],
            "expected_subject_id": "user_admin",
            "documents": [proof["documents"][0]],
            "correlation_id": correlation_id,
            "idempotency_key": idempotency_key,
        },
    )
    assert changed_scope.status_code == 403
    assert changed_scope.json()["error"]["code"] == "intelligence_authorization_invalid"

    changed_version = [dict(item) for item in proof["documents"]]
    changed_version[0]["document_version_id"] = "ver_tampered"
    version_tampered = client.post(
        "/api/v1/integrations/ingestion/intelligence-authorizations/confirm",
        headers=_ingestion_service_headers(correlation_id),
        json={
            "authorization_token": proof["authorization_token"],
            "expected_subject_id": "user_admin",
            "documents": changed_version,
            "correlation_id": correlation_id,
            "idempotency_key": idempotency_key,
        },
    )
    assert version_tampered.status_code == 403
    assert version_tampered.json()["error"]["code"] == "intelligence_authorization_invalid"

    changed_policy = [dict(item) for item in proof["documents"]]
    changed_policy[0]["policy_hash"] = "sha256:" + "f" * 64
    policy_tampered = client.post(
        "/api/v1/integrations/ingestion/intelligence-authorizations/confirm",
        headers=_ingestion_service_headers(correlation_id),
        json={
            "authorization_token": proof["authorization_token"],
            "expected_subject_id": "user_admin",
            "documents": changed_policy,
            "correlation_id": correlation_id,
            "idempotency_key": idempotency_key,
        },
    )
    assert policy_tampered.status_code == 403
    assert policy_tampered.json()["error"]["code"] == "intelligence_authorization_invalid"

    duplicate_scope = client.post(
        "/api/v1/intelligence/authorization",
        headers=actor_headers,
        json={
            "document_ids": [document_ids[0], document_ids[0]],
            "correlation_id": correlation_id,
            "idempotency_key": "intelligence:scope:duplicate",
        },
    )
    assert duplicate_scope.status_code == 422


def test_intelligence_scope_omits_readable_document_without_rag_access(
    client,
    admin_headers,
    reader_headers,
) -> None:
    read_only_id, read_only_version = _document_version(
        client,
        admin_headers,
        access_policies=[
            {
                "subjects": ["role:reader"],
                "actions": ["document.read"],
                "constraints": {"classification_max": "internal"},
            }
        ],
    )
    rag_id, rag_version = _document_version(
        client,
        admin_headers,
        access_policies=[
            {
                "subjects": ["role:reader"],
                "actions": ["document.read", "rag.query"],
                "constraints": {"classification_max": "internal"},
            }
        ],
    )
    _mark_indexed(client, admin_headers, read_only_id, read_only_version, "ing_scope_read_only")
    _mark_indexed(client, admin_headers, rag_id, rag_version, "ing_scope_rag")
    correlation_id = "corr-intelligence-mixed-scope"
    issued = client.post(
        "/api/v1/intelligence/authorization",
        headers={
            **reader_headers,
            "X-Request-ID": correlation_id,
            "X-Correlation-ID": correlation_id,
        },
        json={
            "document_ids": [read_only_id, rag_id],
            "correlation_id": correlation_id,
            "idempotency_key": "intelligence:mixed:scope",
        },
    )

    assert issued.status_code == 200, issued.text
    assert issued.json()["document_count"] == 1
    assert issued.json()["documents"][0]["document_id"] == rag_id


def test_service_identity_cannot_mint_intelligence_scope(
    client,
    admin_headers,
) -> None:
    document_id, version_id = _document_version(client, admin_headers)
    _mark_indexed(client, admin_headers, document_id, version_id, "ing_scope_service")
    correlation_id = "corr-intelligence-service"
    issued = client.post(
        "/api/v1/intelligence/authorization",
        headers=_ingestion_service_headers(correlation_id),
        json={
            "document_ids": [document_id],
            "correlation_id": correlation_id,
            "idempotency_key": "intelligence:service:forbidden",
        },
    )

    assert issued.status_code == 403
    assert issued.json()["error"]["code"] == "service_route_forbidden"


def test_intelligence_scope_omits_archived_and_stale_indexed_coordinate(
    client,
    admin_headers,
    db_session,
) -> None:
    document_id, version_id = _document_version(client, admin_headers)
    _mark_indexed(client, admin_headers, document_id, version_id, "ing_scope_stale")
    document = db_session.get(Document, document_id)
    version = db_session.get(DocumentVersion, version_id)
    assert document is not None
    assert version is not None
    document.status = "valid"
    version.status = "archived"
    db_session.commit()

    def issue(correlation_id: str, idempotency_key: str):
        return client.post(
            "/api/v1/intelligence/authorization",
            headers={
                "X-AKL-Subject": "user_scope_reader",
                "X-AKL-Roles": "stratos_user",
                "X-STRATOS-Capabilities": "akb:chat",
                "X-STRATOS-Scopes": "organization",
                "X-STRATOS-Organization-ID": "org_stratos",
                "X-Request-ID": correlation_id,
                "X-Correlation-ID": correlation_id,
            },
            json={
                "document_ids": [document_id],
                "correlation_id": correlation_id,
                "idempotency_key": idempotency_key,
            },
        )

    archived = issue("corr-intelligence-archived", "intelligence:archived:coordinate")
    assert archived.status_code == 409
    assert archived.json()["error"]["code"] == "intelligence_scope_empty"

    version.status = "valid"
    version.policy_hash = "sha256:" + "f" * 64
    db_session.commit()
    stale = issue("corr-intelligence-stale", "intelligence:stale:coordinate")
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "intelligence_scope_empty"
