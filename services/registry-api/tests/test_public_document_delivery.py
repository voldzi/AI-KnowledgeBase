from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import selectinload

import app.api as api_module
import app.permissions as permissions_module
from app.access_governance import (
    GovernanceUnavailable,
    InformationPublicationRegistration,
)
from app.information_policy import InformationPolicyBinding, canonical_policy_hash
from app.models import (
    AuditEvent,
    Document,
    DocumentFile,
    DocumentPublication,
    DocumentVersion,
    IngestionAttempt,
)
from app.auth import Principal
from app.public_delivery_limiter import PublicDeliveryLimiter
from app.permissions import (
    context_for_principal,
    evaluate_document_access,
    evaluate_runtime_document_access,
)


PUBLIC_SLUG = "public-governance-guide"
SOURCE_HASH = f"sha256:{'a' * 64}"
SOURCE_URI = "s3://akl-documents/public/governance-guide.pdf"
INTERNAL_TOKEN = "test-public-delivery-token-00000000000000000000"


def _public_policy() -> InformationPolicyBinding:
    return InformationPolicyBinding.model_validate(
        {
            "schemaVersion": "stratos-information-policy-2",
            "policyBindingId": "pb_akb_public_documents_01",
            "policyVersion": "information-policy-2.0.0",
            "handlingClass": "PUBLIC",
            "legalClassification": "NONE",
            "tlp": "TLP:CLEAR",
            "pap": "PAP:CLEAR",
            "contentCategories": ["PUBLIC_INFORMATION"],
            "audience": {
                "organizationId": "org_stratos",
                "scopeType": "public",
                "scopeIds": [],
                "recipientSubjectIds": [],
            },
            "obligations": ["AUDIT_ACCESS"],
            "originatorId": "user-publisher",
            "issuedAt": "2026-07-13T12:00:00Z",
            "reviewAt": None,
        }
    )


def _seed_public_version(db_session) -> tuple[Document, DocumentVersion]:
    binding = _public_policy()
    policy_hash = canonical_policy_hash(binding)
    policy_summary = binding.model_dump(mode="json", by_alias=True, exclude_none=False)
    now = datetime.now(timezone.utc)
    document = Document(
        document_id="doc_public_guide",
        title="Public governance guide",
        document_type="manual",
        status="valid",
        classification="public",
        organization_id="org_stratos",
        policy_binding_id=binding.policy_binding_id,
        policy_version=binding.policy_version,
        policy_hash=policy_hash,
        policy_summary=policy_summary,
        governed_resource_id="gir_akb_document_public_guide",
        governed_source_version="gres_document_public_guide",
        governance_scope_type="organization",
        governance_scope_id="org_stratos",
        governance_registration_status="REGISTERED",
        governance_registered_at=now,
        owner_id="user-owner",
        tags=["public"],
        document_metadata={"internal_note": "must never enter the public snapshot"},
    )
    version = DocumentVersion(
        document_version_id="ver_public_guide_1",
        document_id=document.document_id,
        version_label="1.0",
        status="valid",
        organization_id="org_stratos",
        policy_binding_id=binding.policy_binding_id,
        policy_version=binding.policy_version,
        policy_hash=policy_hash,
        policy_summary=policy_summary,
        governed_resource_id="gir_akb_document_version_public_guide_1",
        governed_source_version="ver_public_guide_1",
        governed_parent_resource_id=document.governed_resource_id,
        governance_scope_type="organization",
        governance_scope_id="org_stratos",
        governance_registration_status="REGISTERED",
        governance_registered_at=now,
        source_file_uri=SOURCE_URI,
        file_hash=SOURCE_HASH,
        change_summary="internal change summary must not be public",
        published_at=now,
    )
    source = DocumentFile(
        file_id="file_public_guide_1",
        document_id=document.document_id,
        document_version_id=version.document_version_id,
        uri=SOURCE_URI,
        filename="governance-guide.pdf",
        mime_type="application/pdf",
        size_bytes=321,
        sha256=SOURCE_HASH,
        uploaded_by="user-owner",
    )
    db_session.add_all([document, version, source])
    db_session.commit()
    return document, version


def _publisher_headers(*, capabilities: str = "akb:assign_policy,akb:publish_public") -> dict[str, str]:
    return {
        "Authorization": "Bearer interactive-publisher-token",
        "X-AKL-Subject": "user-publisher",
        "X-AKL-Roles": "stratos_user",
        "X-STRATOS-Capabilities": capabilities,
        "X-STRATOS-Scopes": "organization:org_stratos",
        "X-STRATOS-Organization-ID": "org_stratos",
        "X-Correlation-ID": "corr-public-document",
    }


class CentralGovernanceStub:
    def __init__(self, version: DocumentVersion) -> None:
        self.version = version
        self.publication_id = "ipub_akb_public_guide_1"
        self.public_slug = PUBLIC_SLUG
        self.policy_binding_id = str(version.policy_binding_id)
        self.policy_version = str(version.policy_version)
        self.policy_hash = str(version.policy_hash)
        self.status = "PUBLISHED"
        self.decision_mode = "ALLOW"
        self.decision_policy_version = self.policy_version
        self.decision_extra: dict[str, Any] = {}
        self.publication_extra: dict[str, Any] = {}
        self.outage = False
        self.mismatch = False
        self.publication_calls: list[dict[str, Any]] = []
        self.decision_calls: list[dict[str, Any]] = []

    def upsert_information_publication(self, **kwargs) -> InformationPublicationRegistration:
        self.publication_calls.append(kwargs)
        self.status = kwargs["status"]
        self.public_slug = kwargs["public_slug"]
        return InformationPublicationRegistration(
            publication_id=self.publication_id,
            governed_resource_id=str(self.version.governed_resource_id),
            resource_type="document_version",
            resource_id=self.version.document_version_id,
            source_version=self.version.document_version_id,
            public_slug=self.public_slug,
            policy_binding_id=self.policy_binding_id,
            policy_hash=self.policy_hash,
            status=self.status,
            published_at=(
                "2026-07-13T12:30:00.000Z" if self.status in {"PUBLISHED", "REVOKED"} else None
            ),
            revoked_at=(
                "2026-07-13T13:30:00.000Z" if self.status == "REVOKED" else None
            ),
        )

    def public_decide(self, **kwargs) -> dict[str, Any]:
        self.decision_calls.append(kwargs)
        if self.outage:
            raise GovernanceUnavailable("central policy unavailable")
        allowed = self.decision_mode == "ALLOW" and self.status == "PUBLISHED"
        publication = None
        if allowed:
            publication = {
                "id": self.publication_id,
                "application": "AKB",
                "resourceType": "document_version",
                "resourceId": self.version.document_version_id,
                "sourceVersion": self.version.document_version_id,
                "publicSlug": self.public_slug,
                "policyBindingId": self.policy_binding_id,
                "policyHash": (
                    f"sha256:{'f' * 64}" if self.mismatch else self.policy_hash
                ),
                "publishedAt": "2026-07-13T12:30:00.000Z",
                **self.publication_extra,
            }
        return {
            "decision": "ALLOW" if allowed else "DENY",
            "decisionId": f"pdec-{len(self.decision_calls)}",
            "reasonCodes": ["PUBLIC_POLICY_ALLOW" if allowed else "PUBLICATION_INACTIVE"],
            "obligations": ["AUDIT_ACCESS"],
            "policyVersion": self.decision_policy_version,
            "publication": publication,
            **self.decision_extra,
        }


def _install_governance(monkeypatch, version: DocumentVersion) -> CentralGovernanceStub:
    central = CentralGovernanceStub(version)
    real_settings = api_module.get_settings()
    settings = real_settings.model_copy(
        update={"public_delivery_internal_token": INTERNAL_TOKEN}
    )
    monkeypatch.setattr(api_module, "get_settings", lambda: settings)
    monkeypatch.setattr(api_module, "governance_client", lambda _settings: central)
    monkeypatch.setattr(permissions_module, "get_settings", lambda: settings)
    monkeypatch.setattr(permissions_module, "governance_client", lambda _settings: central)
    return central


def _publish(client) -> httpx.Response:
    return client.put(
        "/api/v1/documents/doc_public_guide/versions/ver_public_guide_1/publication",
        headers=_publisher_headers(),
        json={
            "status": "PUBLISHED",
            "publicSlug": PUBLIC_SLUG,
            "publicDescription": "Approved public summary only.",
            "reason": "Approved for organization-wide public delivery",
        },
    )


def _manage_document_headers() -> dict[str, str]:
    return _publisher_headers(capabilities="akb:manage_document")


def _public_only_headers(
    *,
    capabilities: str = "akb:chat",
    scopes: str = "public",
) -> dict[str, str]:
    return {
        "X-AKL-Subject": "user-logistics-default",
        "X-AKL-Roles": "stratos_user",
        "X-STRATOS-Capabilities": capabilities,
        "X-STRATOS-Scopes": scopes,
        "X-STRATOS-Organization-ID": "org_stratos",
    }


def _public_rag_filter(client, document: Document, version: DocumentVersion):
    return client.post(
        "/api/v1/authz/filter-documents",
        headers=_public_only_headers(),
        json={
            "subject_id": "user-logistics-default",
            "action": "rag.query",
            "candidate_document_ids": [document.document_id],
            "candidate_policy_hashes": {
                document.document_id: [document.policy_hash],
            },
            "candidate_document_versions": {
                document.document_id: [version.document_version_id],
            },
        },
    )


def test_public_only_rag_requires_exact_local_publication_and_fresh_central_allow(
    client,
    db_session,
    monkeypatch,
) -> None:
    document, version = _seed_public_version(db_session)
    document.document_type = "contract"
    db_session.commit()
    central = _install_governance(monkeypatch, version)
    assert _publish(client).status_code == 200

    allowed = _public_rag_filter(client, document, version)
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["allowed_document_ids"] == [document.document_id]
    assert central.decision_calls[-1] == {
        "public_slug": PUBLIC_SLUG,
        "operation": "public_read",
    }

    central.mismatch = True
    mismatch = _public_rag_filter(client, document, version)
    assert mismatch.status_code == 200, mismatch.text
    assert mismatch.json()["allowed_document_ids"] == []
    assert mismatch.json()["denied_document_ids"] == [document.document_id]

    central.mismatch = False
    central.outage = True
    unavailable = _public_rag_filter(client, document, version)
    assert unavailable.status_code == 503
    assert unavailable.json()["error"]["code"] == "public_policy_decision_unavailable"


def test_oidc_public_projection_runtime_uses_exact_public_contract_not_generic_scope_pdp(
    client,
    db_session,
    monkeypatch,
) -> None:
    document, version = _seed_public_version(db_session)
    central = _install_governance(monkeypatch, version)
    assert _publish(client).status_code == 200
    db_session.expire_all()
    document = db_session.execute(
        select(Document)
        .where(Document.document_id == document.document_id)
        .options(
            selectinload(Document.versions),
            selectinload(Document.publications),
        )
    ).scalar_one()
    oidc_settings = permissions_module.get_settings().model_copy(
        update={"auth_mode": "oidc"}
    )
    monkeypatch.setattr(permissions_module, "get_settings", lambda: oidc_settings)
    principal = Principal(
        subject_id="user-public",
        roles={"stratos_user"},
        groups=set(),
        capabilities={"akb:chat", "akb:read_document"},
        scopes={"public", "organization_unit:logistics"},
        organization_id="org_stratos",
        dynamic_access_loaded=True,
        bearer_token="verified-user-token",
    )
    context = context_for_principal(principal)

    public_local = evaluate_document_access(context, "rag.query", document)
    public_runtime = evaluate_runtime_document_access(
        principal,
        "rag.query",
        document,
        public_local,
    )

    assert public_runtime.allowed is True
    assert public_runtime.constraints["public_version_ids"] == [
        version.document_version_id
    ]
    # CentralGovernanceStub intentionally has no generic decide() method: the
    # positive path proves the production OIDC runtime does not call it.
    assert central.decision_calls == [{
        "public_slug": PUBLIC_SLUG,
        "operation": "public_read",
    }]

    central.mismatch = True
    public_mismatch_local = evaluate_document_access(context, "rag.query", document)
    public_mismatch_runtime = evaluate_runtime_document_access(
        principal,
        "rag.query",
        document,
        public_mismatch_local,
    )
    document_read_local = evaluate_document_access(context, "document.read", document)
    document_read_runtime = evaluate_runtime_document_access(
        principal,
        "document.read",
        document,
        document_read_local,
    )

    assert public_mismatch_runtime.allowed is False
    assert public_mismatch_runtime.reason_codes == ("PUBLICATION_INACTIVE",)
    assert document_read_runtime.allowed is False
    assert document_read_runtime.reason_codes == ("PUBLIC_PROJECTION_REQUIRED",)
    assert len(central.decision_calls) == 2


def test_public_only_rag_denies_draft_and_revoked_publications(
    client,
    db_session,
    monkeypatch,
) -> None:
    document, version = _seed_public_version(db_session)
    central = _install_governance(monkeypatch, version)
    draft = client.put(
        f"/api/v1/documents/{document.document_id}/versions/"
        f"{version.document_version_id}/publication",
        headers=_publisher_headers(capabilities="akb:assign_policy"),
        json={
            "status": "DRAFT",
            "publicSlug": PUBLIC_SLUG,
            "reason": "Prepare public publication",
        },
    )
    assert draft.status_code == 200, draft.text
    assert _public_rag_filter(client, document, version).json()["allowed_document_ids"] == []

    # A terminal revoke is tested from a separate exact version lifecycle.
    db_session.query(DocumentPublication).delete()
    db_session.commit()
    central.status = "PUBLISHED"
    assert _publish(client).status_code == 200
    revoked = client.put(
        f"/api/v1/documents/{document.document_id}/versions/"
        f"{version.document_version_id}/publication",
        headers=_publisher_headers(capabilities="akb:publish_public"),
        json={"status": "REVOKED", "reason": "Withdraw public source"},
    )
    assert revoked.status_code == 200, revoked.text
    assert _public_rag_filter(client, document, version).json()["allowed_document_ids"] == []


def test_public_only_scope_never_exposes_full_document_registry_views(
    client,
    db_session,
    monkeypatch,
) -> None:
    document, version = _seed_public_version(db_session)
    _install_governance(monkeypatch, version)
    assert _publish(client).status_code == 200
    headers = _public_only_headers(capabilities="akb:chat,akb:read_document")

    listing = client.get("/api/v1/documents", headers=headers)
    detail = client.get(f"/api/v1/documents/{document.document_id}", headers=headers)
    summary = client.get("/api/v1/documents/metadata-summary", headers=headers)
    rag_summary = client.get("/api/v1/documents/rag-metadata-summary", headers=headers)

    assert listing.status_code == 200
    assert listing.json()["items"] == []
    assert detail.status_code == 403
    assert "PUBLIC_PROJECTION_REQUIRED" in detail.json()["error"]["details"]["reason_codes"]
    assert summary.status_code == 200
    assert summary.json()["total_visible_documents"] == 0
    assert rag_summary.status_code == 200
    assert rag_summary.json()["total_visible_documents"] == 1


def test_public_scope_mixed_with_unrelated_scope_still_uses_exact_public_version(
    client,
    db_session,
    monkeypatch,
) -> None:
    document, published_version = _seed_public_version(db_session)
    central = _install_governance(monkeypatch, published_version)
    assert _publish(client).status_code == 200
    other_version = DocumentVersion(
        document_version_id="ver_public_guide_unpublished",
        document_id=document.document_id,
        version_label="2.0",
        status="valid",
        organization_id="org_stratos",
        policy_binding_id=document.policy_binding_id,
        policy_version=document.policy_version,
        policy_hash=document.policy_hash,
        policy_summary=document.policy_summary,
        governed_resource_id="gir_akb_document_version_public_guide_2",
        governed_source_version="ver_public_guide_unpublished",
        governed_parent_resource_id=document.governed_resource_id,
        governance_scope_type="organization",
        governance_scope_id="org_stratos",
        governance_registration_status="REGISTERED",
        governance_registered_at=datetime.now(timezone.utc),
        source_file_uri="s3://akl-documents/internal/governance-guide-draft.pdf",
        file_hash=f"sha256:{'b' * 64}",
        published_at=datetime.now(timezone.utc),
    )
    db_session.add(other_version)
    db_session.commit()
    headers = _public_only_headers(scopes="public,organization_unit:logistics")

    exact = client.post(
        "/api/v1/authz/filter-documents",
        headers=headers,
        json={
            "subject_id": "user-logistics-default",
            "action": "rag.query",
            "candidate_document_ids": [document.document_id],
            "candidate_policy_hashes": {document.document_id: [document.policy_hash]},
            "candidate_document_versions": {
                document.document_id: [published_version.document_version_id],
            },
        },
    )
    unpublished = client.post(
        "/api/v1/authz/filter-documents",
        headers=headers,
        json={
            "subject_id": "user-logistics-default",
            "action": "rag.query",
            "candidate_document_ids": [document.document_id],
            "candidate_policy_hashes": {document.document_id: [document.policy_hash]},
            "candidate_document_versions": {
                document.document_id: [other_version.document_version_id],
            },
        },
    )
    full_document = client.get(
        f"/api/v1/documents/{document.document_id}",
        headers=_public_only_headers(
            capabilities="akb:chat,akb:read_document",
            scopes="public,organization_unit:logistics",
        ),
    )

    assert exact.status_code == 200, exact.text
    assert exact.json()["allowed_document_ids"] == [document.document_id]
    assert unpublished.status_code == 200, unpublished.text
    assert unpublished.json()["allowed_document_ids"] == []
    assert full_document.status_code == 403
    assert "PUBLIC_PROJECTION_REQUIRED" in full_document.json()["error"]["details"][
        "reason_codes"
    ]


def test_public_only_intelligence_scope_uses_only_active_published_version(
    client,
    db_session,
    monkeypatch,
) -> None:
    document, published_version = _seed_public_version(db_session)
    _install_governance(monkeypatch, published_version)
    assert _publish(client).status_code == 200
    attempt = IngestionAttempt(
        document_id=document.document_id,
        document_version_id=published_version.document_version_id,
        ingestion_job_id="ing_public_scope",
        ingestion_status="INDEXED",
    )
    db_session.add(attempt)
    db_session.commit()
    correlation_id = "corr-public-intelligence-scope"
    issued = client.post(
        "/api/v1/intelligence/authorization",
        headers={
            **_public_only_headers(),
            "X-Request-ID": correlation_id,
            "X-Correlation-ID": correlation_id,
        },
        json={
            "document_ids": [document.document_id],
            "correlation_id": correlation_id,
            "idempotency_key": "intelligence:public:published",
        },
    )

    assert issued.status_code == 200, issued.text
    assert issued.json()["documents"] == [
        {
            "document_id": document.document_id,
            "document_version_id": published_version.document_version_id,
            "policy_hash": document.policy_hash,
        }
    ]

    unpublished = DocumentVersion(
        document_version_id="ver_public_guide_unpublished_scope",
        document_id=document.document_id,
        version_label="2.0",
        status="valid",
        organization_id="org_stratos",
        policy_binding_id=document.policy_binding_id,
        policy_version=document.policy_version,
        policy_hash=document.policy_hash,
        policy_summary=document.policy_summary,
        governed_resource_id="gir_akb_document_version_public_scope_2",
        governed_source_version="ver_public_guide_unpublished_scope",
        governed_parent_resource_id=document.governed_resource_id,
        governance_scope_type="organization",
        governance_scope_id="org_stratos",
        governance_registration_status="REGISTERED",
        governance_registered_at=datetime.now(timezone.utc),
        source_file_uri="s3://akl-documents/public/unpublished-scope.pdf",
        file_hash=f"sha256:{'b' * 64}",
        published_at=datetime.now(timezone.utc),
    )
    db_session.add(unpublished)
    db_session.commit()
    attempt.document_version_id = unpublished.document_version_id
    db_session.commit()
    rejected = client.post(
        "/api/v1/intelligence/authorization",
        headers={
            **_public_only_headers(),
            "X-Request-ID": "corr-public-intelligence-unpublished",
            "X-Correlation-ID": "corr-public-intelligence-unpublished",
        },
        json={
            "document_ids": [document.document_id],
            "correlation_id": "corr-public-intelligence-unpublished",
            "idempotency_key": "intelligence:public:unpublished",
        },
    )

    assert rejected.status_code == 409
    assert rejected.json()["error"]["code"] == "intelligence_scope_empty"


def test_active_publication_blocks_archive_and_logical_delete_until_revoke(
    client,
    db_session,
    monkeypatch,
) -> None:
    document, version = _seed_public_version(db_session)
    _install_governance(monkeypatch, version)
    assert _publish(client).status_code == 200

    archive_endpoint = (
        f"/api/v1/documents/{document.document_id}/versions/"
        f"{version.document_version_id}/archive"
    )
    archive_while_published = client.post(
        archive_endpoint,
        headers=_manage_document_headers(),
    )
    delete_while_published = client.delete(
        f"/api/v1/documents/{document.document_id}",
        headers=_manage_document_headers(),
    )

    assert archive_while_published.status_code == 409
    assert (
        archive_while_published.json()["error"]["code"]
        == "publication_lifecycle_active"
    )
    assert delete_while_published.status_code == 409
    assert (
        delete_while_published.json()["error"]["code"]
        == "publication_lifecycle_active"
    )
    db_session.refresh(document)
    db_session.refresh(version)
    assert document.status == "valid"
    assert version.status == "valid"
    assert (
        db_session.query(AuditEvent)
        .filter(
            AuditEvent.event_type.in_(
                {"document.version.archived", "document.deleted"}
            )
        )
        .count()
        == 0
    )

    revoked = client.put(
        f"/api/v1/documents/{document.document_id}/versions/"
        f"{version.document_version_id}/publication",
        headers=_publisher_headers(capabilities="akb:publish_public"),
        json={"status": "REVOKED", "reason": "Archive the source record"},
    )
    assert revoked.status_code == 200, revoked.text
    assert revoked.json()["status"] == "REVOKED"

    archived = client.post(archive_endpoint, headers=_manage_document_headers())
    deleted = client.delete(
        f"/api/v1/documents/{document.document_id}",
        headers=_manage_document_headers(),
    )
    assert archived.status_code == 200, archived.text
    assert archived.json()["status"] == "archived"
    assert deleted.status_code == 204, deleted.text


def test_draft_publication_also_blocks_archive_and_logical_delete(
    client,
    db_session,
    monkeypatch,
) -> None:
    document, version = _seed_public_version(db_session)
    _install_governance(monkeypatch, version)
    draft = client.put(
        f"/api/v1/documents/{document.document_id}/versions/"
        f"{version.document_version_id}/publication",
        headers=_publisher_headers(capabilities="akb:assign_policy"),
        json={
            "status": "DRAFT",
            "publicSlug": PUBLIC_SLUG,
            "reason": "Prepare public publication",
        },
    )
    assert draft.status_code == 200, draft.text
    assert draft.json()["status"] == "DRAFT"

    archived = client.post(
        f"/api/v1/documents/{document.document_id}/versions/"
        f"{version.document_version_id}/archive",
        headers=_manage_document_headers(),
    )
    deleted = client.delete(
        f"/api/v1/documents/{document.document_id}",
        headers=_manage_document_headers(),
    )
    assert archived.status_code == 409
    assert archived.json()["error"]["code"] == "publication_lifecycle_active"
    assert deleted.status_code == 409
    assert deleted.json()["error"]["code"] == "publication_lifecycle_active"


def _assert_no_sensitive_public_fields(value: Any) -> None:
    forbidden_keys = {
        "source_file_uri",
        "sourceFileUri",
        "storage_uri",
        "chunks",
        "embeddings",
        "rag",
        "prompt",
        "answer",
        "extracted_text",
        "change_summary",
        "metadata",
    }
    if isinstance(value, dict):
        assert not forbidden_keys.intersection(value)
        for inner in value.values():
            _assert_no_sensitive_public_fields(inner)
    elif isinstance(value, list):
        for inner in value:
            _assert_no_sensitive_public_fields(inner)
    elif isinstance(value, str):
        assert "s3://" not in value
        assert "internal_note" not in value
        assert "internal change summary" not in value


def test_publish_requires_interactive_bearer_and_both_capabilities(
    client,
    db_session,
    monkeypatch,
) -> None:
    _, version = _seed_public_version(db_session)
    central = _install_governance(monkeypatch, version)
    without_bearer = _publisher_headers()
    without_bearer.pop("Authorization")

    bearer_required = client.put(
        f"/api/v1/documents/doc_public_guide/versions/{version.document_version_id}/publication",
        headers=without_bearer,
        json={
            "status": "PUBLISHED",
            "publicSlug": PUBLIC_SLUG,
            "reason": "Publish",
        },
    )
    capability_required = client.put(
        f"/api/v1/documents/doc_public_guide/versions/{version.document_version_id}/publication",
        headers=_publisher_headers(capabilities="akb:assign_policy"),
        json={
            "status": "PUBLISHED",
            "publicSlug": PUBLIC_SLUG,
            "reason": "Publish",
        },
    )

    assert bearer_required.status_code == 403
    assert bearer_required.json()["error"]["code"] == "interactive_publication_required"
    assert capability_required.status_code == 403
    assert capability_required.json()["error"]["code"] == "publication_capability_missing"
    assert central.publication_calls == []


def test_exact_version_publication_is_immutable_audited_and_sanitized(
    client,
    db_session,
    monkeypatch,
) -> None:
    _, version = _seed_public_version(db_session)
    central = _install_governance(monkeypatch, version)

    published = _publish(client)

    assert published.status_code == 200, published.text
    body = published.json()
    assert body["document_version_id"] == version.document_version_id
    assert body["central_publication_id"] == central.publication_id
    assert body["status"] == "PUBLISHED"
    assert "source_file_uri" not in body
    assert "public_snapshot" not in body
    assert central.publication_calls[0]["credential_token"] == "interactive-publisher-token"
    assert central.publication_calls[0]["resource_type"] == "document_version"
    assert central.publication_calls[0]["resource_id"] == version.document_version_id
    assert central.publication_calls[0]["source_version"] == version.document_version_id

    publication = db_session.query(DocumentPublication).one()
    assert publication.source_version == version.document_version_id
    assert publication.public_snapshot["description"] == "Approved public summary only."
    assert publication.public_snapshot["file"] == {
        "filename": "governance-guide.pdf",
        "mimeType": "application/pdf",
        "sizeBytes": 321,
        "sha256": SOURCE_HASH,
    }
    audit = (
        db_session.query(AuditEvent)
        .filter(AuditEvent.event_type == "document.publication.published")
        .one()
    )
    assert audit.actor_id == "user-publisher"
    assert audit.event_metadata["reason"] == "Approved for organization-wide public delivery"
    assert SOURCE_URI not in str(audit.event_metadata)

    document = db_session.get(Document, "doc_public_guide")
    document.title = "Changed internal title after publication"
    db_session.commit()
    idempotent = _publish(client)
    assert idempotent.status_code == 200, idempotent.text
    db_session.refresh(publication)
    assert publication.public_snapshot["title"] == "Public governance guide"

    mutation = client.put(
        f"/api/v1/documents/doc_public_guide/versions/{version.document_version_id}/publication",
        headers=_publisher_headers(),
        json={
            "status": "PUBLISHED",
            "publicSlug": "a-different-public-slug",
            "reason": "Attempt to mutate",
        },
    )
    assert mutation.status_code == 409
    assert mutation.json()["error"]["code"] == "published_version_immutable"


def test_revoke_requires_only_publish_capability_and_keeps_scope_rule(
    client,
    db_session,
    monkeypatch,
) -> None:
    _, version = _seed_public_version(db_session)
    central = _install_governance(monkeypatch, version)
    assert _publish(client).status_code == 200
    endpoint = (
        f"/api/v1/documents/doc_public_guide/versions/{version.document_version_id}/publication"
    )

    assign_only = client.put(
        endpoint,
        headers=_publisher_headers(capabilities="akb:assign_policy"),
        json={"status": "REVOKED", "reason": "Public approval withdrawn"},
    )
    publish_only = client.put(
        endpoint,
        headers=_publisher_headers(capabilities="akb:publish_public"),
        json={"status": "REVOKED", "reason": "Public approval withdrawn"},
    )

    assert assign_only.status_code == 403
    assert assign_only.json()["error"]["code"] == "publication_capability_missing"
    assert publish_only.status_code == 200, publish_only.text
    assert publish_only.json()["status"] == "REVOKED"
    assert [call["status"] for call in central.publication_calls] == ["PUBLISHED", "REVOKED"]


def test_every_public_read_rechecks_central_policy_and_never_leaks_storage(
    client,
    db_session,
    monkeypatch,
) -> None:
    _, version = _seed_public_version(db_session)
    central = _install_governance(monkeypatch, version)
    assert _publish(client).status_code == 200

    first = client.get(f"/api/v1/public/documents/{PUBLIC_SLUG}")
    second = client.get(f"/api/v1/public/documents/{PUBLIC_SLUG}")

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert [call["operation"] for call in central.decision_calls] == [
        "public_read",
        "public_read",
    ]
    assert first.headers["cache-control"] == "no-store"
    assert first.json()["snapshot"]["title"] == "Public governance guide"
    assert first.json()["snapshot"]["file"]["sha256"] == SOURCE_HASH
    _assert_no_sensitive_public_fields(first.json())

    source_without_internal_credential = client.get(
        f"/api/v1/internal/public/documents/{PUBLIC_SLUG}/source"
    )
    assert source_without_internal_credential.status_code == 401
    assert len(central.decision_calls) == 2

    source_resolution = client.get(
        f"/api/v1/internal/public/documents/{PUBLIC_SLUG}/source",
        headers={"X-AKB-Public-Delivery-Token": INTERNAL_TOKEN},
    )
    assert source_resolution.status_code == 200, source_resolution.text
    assert source_resolution.json()["source_file_uri"] == SOURCE_URI
    assert source_resolution.json()["sha256"] == SOURCE_HASH
    assert central.decision_calls[-1]["operation"] == "public_download"

    public_audit_events = (
        db_session.query(AuditEvent)
        .filter(AuditEvent.event_type == "public.document.allow")
        .all()
    )
    assert len(public_audit_events) == 2
    assert sum(event.occurrence_count for event in public_audit_events) == 3
    assert sorted(event.occurrence_count for event in public_audit_events) == [1, 2]
    assert all(SOURCE_URI not in str(event.event_metadata) for event in public_audit_events)


def test_public_audit_uses_deterministic_windows_and_prunes_only_anonymous_events(
    client,
    db_session,
    monkeypatch,
) -> None:
    _, version = _seed_public_version(db_session)
    _install_governance(monkeypatch, version)
    assert _publish(client).status_code == 200
    fixed_now = datetime(2026, 7, 13, 15, 30, 5, tzinfo=timezone.utc)
    monkeypatch.setattr(api_module, "utcnow", lambda: fixed_now)

    assert client.get(f"/api/v1/public/documents/{PUBLIC_SLUG}").status_code == 200
    assert client.get(f"/api/v1/public/documents/{PUBLIC_SLUG}").status_code == 200
    first_window = (
        db_session.query(AuditEvent)
        .filter(AuditEvent.event_type == "public.document.allow")
        .one()
    )
    assert first_window.occurrence_count == 2
    assert first_window.event_metadata["aggregation_window_started_at"] == "2026-07-13T15:30:00Z"

    fixed_now += timedelta(seconds=60)
    assert client.get(f"/api/v1/public/documents/{PUBLIC_SLUG}").status_code == 200
    windows = (
        db_session.query(AuditEvent)
        .filter(AuditEvent.event_type == "public.document.allow")
        .order_by(AuditEvent.created_at)
        .all()
    )
    assert [event.occurrence_count for event in windows] == [2, 1]

    old_anonymous = AuditEvent(
        audit_event_id="audit_old_anonymous_public",
        actor_id="anonymous:public",
        event_type="public.document.allow",
        resource_type="document_publication",
        resource_id="pub_old",
        severity="info",
        event_metadata={},
        created_at=fixed_now - timedelta(days=10),
        last_seen_at=fixed_now - timedelta(days=10),
    )
    old_authenticated = AuditEvent(
        audit_event_id="audit_old_authenticated",
        actor_id="user-audited",
        event_type="document.read",
        resource_type="document",
        resource_id="doc_old",
        severity="info",
        event_metadata={},
        created_at=fixed_now - timedelta(days=10),
        last_seen_at=fixed_now - timedelta(days=10),
    )
    db_session.add_all([old_anonymous, old_authenticated])
    old_anonymous_id = old_anonymous.audit_event_id
    old_authenticated_id = old_authenticated.audit_event_id
    db_session.commit()
    deleted = api_module._prune_public_delivery_audit(
        db_session,
        now=fixed_now,
        retention_days=1,
        interval_seconds=3600,
        force=True,
    )
    db_session.commit()
    assert deleted == 1
    assert db_session.get(AuditEvent, old_anonymous_id) is None
    assert db_session.get(AuditEvent, old_authenticated_id) is not None


def test_public_delivery_fails_closed_on_outage_mismatch_tamper_and_revoke(
    client,
    db_session,
    monkeypatch,
) -> None:
    _, version = _seed_public_version(db_session)
    central = _install_governance(monkeypatch, version)
    assert _publish(client).status_code == 200

    central.outage = True
    outage = client.get(f"/api/v1/public/documents/{PUBLIC_SLUG}")
    assert outage.status_code == 503
    assert outage.json()["error"]["code"] == "public_policy_decision_unavailable"

    central.outage = False
    central.mismatch = True
    mismatch = client.get(f"/api/v1/public/documents/{PUBLIC_SLUG}")
    assert mismatch.status_code == 404
    central.mismatch = False

    publication = db_session.query(DocumentPublication).one()
    publication.public_snapshot = {
        **publication.public_snapshot,
        "title": "Tampered title",
    }
    db_session.commit()
    tampered = client.get(f"/api/v1/public/documents/{PUBLIC_SLUG}")
    assert tampered.status_code == 404

    # Restore the immutable snapshot solely to exercise the independent central revoke gate.
    publication.public_snapshot = {
        **publication.public_snapshot,
        "title": "Public governance guide",
    }
    db_session.commit()
    revoked = client.put(
        f"/api/v1/documents/doc_public_guide/versions/{version.document_version_id}/publication",
        headers=_publisher_headers(),
        json={"status": "REVOKED", "reason": "Public approval withdrawn"},
    )
    assert revoked.status_code == 200, revoked.text
    assert revoked.json()["status"] == "REVOKED"
    after_revoke = client.get(f"/api/v1/public/documents/{PUBLIC_SLUG}")
    assert after_revoke.status_code == 404
    assert central.decision_calls[-1]["operation"] == "public_read"


def test_public_download_decision_is_fresh_and_invalid_response_fails_closed(
    client,
    db_session,
    monkeypatch,
) -> None:
    _, version = _seed_public_version(db_session)
    central = _install_governance(monkeypatch, version)
    assert _publish(client).status_code == 200

    central.public_decide = lambda **_kwargs: {"decision": "ALLOW"}  # type: ignore[method-assign]
    response = client.get(f"/api/v1/public/documents/{PUBLIC_SLUG}")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "public_policy_decision_invalid"


def test_public_decision_rejects_stale_policy_version_and_foreign_or_extra_values(
    client,
    db_session,
    monkeypatch,
) -> None:
    _, version = _seed_public_version(db_session)
    central = _install_governance(monkeypatch, version)
    assert _publish(client).status_code == 200

    central.decision_policy_version = "information-policy-1.9.9"
    stale_version = client.get(f"/api/v1/public/documents/{PUBLIC_SLUG}")
    assert stale_version.status_code == 404

    central.decision_policy_version = central.policy_version
    central.mismatch = True
    foreign_hash = client.get(f"/api/v1/public/documents/{PUBLIC_SLUG}")
    assert foreign_hash.status_code == 404

    central.mismatch = False
    central.decision_extra = {"unexpected": "must be rejected"}
    extra_root_key = client.get(f"/api/v1/public/documents/{PUBLIC_SLUG}")
    assert extra_root_key.status_code == 503
    assert extra_root_key.json()["error"]["code"] == "public_policy_decision_invalid"

    central.decision_extra = {}
    central.publication_extra = {"unexpected": "must be rejected"}
    extra_publication_key = client.get(f"/api/v1/public/documents/{PUBLIC_SLUG}")
    assert extra_publication_key.status_code == 503
    assert extra_publication_key.json()["error"]["code"] == "public_policy_decision_invalid"


def test_registry_public_endpoint_returns_429_before_repeating_central_work(
    client,
    db_session,
    monkeypatch,
) -> None:
    _, version = _seed_public_version(db_session)
    central = _install_governance(monkeypatch, version)
    assert _publish(client).status_code == 200
    settings = api_module.get_settings().model_copy(
        update={
            "registry_public_rate_per_client_slug": 1,
            "registry_public_rate_global": 10,
            "registry_public_concurrency_per_client": 2,
            "registry_public_concurrency_global": 4,
        }
    )
    limiter = PublicDeliveryLimiter(settings)
    monkeypatch.setattr(api_module, "public_delivery_limiter", lambda _settings: limiter)

    first = client.get(f"/api/v1/public/documents/{PUBLIC_SLUG}")
    limited = client.get(f"/api/v1/public/documents/{PUBLIC_SLUG}")

    assert first.status_code == 200, first.text
    assert limited.status_code == 429
    assert limited.headers["retry-after"] == "60"
    assert limited.json()["error"]["code"] == "public_rate_limited"
    assert [call["operation"] for call in central.decision_calls] == ["public_read"]
