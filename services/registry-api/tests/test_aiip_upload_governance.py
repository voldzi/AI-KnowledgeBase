from types import SimpleNamespace

import pytest

from app.access_governance import GovernanceInvalidResponse, StratosGovernanceClient
from app.config import Settings
from app.information_policy import (
    InformationPolicyBinding,
    IntegrationEnvelope,
    canonical_policy_hash,
)
from app.models import DocumentFile


ACTOR = "actor-aiip-123"
SOURCE_ID = "gres-aiip-source-123"
IDEA_ID = "idea-aiip-123"
EXTERNAL_REF = f"aiip:idea:{IDEA_ID}:requirement-card"
SOURCE_VERSION = "idea-aiip-123-v1"
FILE_HASH = f"sha256:{'d' * 64}"
FILE_HASH_2 = f"sha256:{'e' * 64}"
AUTHORITATIVE_POLICY_HASH = f"sha256:{'f' * 64}"


def _policy() -> dict:
    return {
        "schemaVersion": "stratos-information-policy-2",
        "policyBindingId": "pb_aiip_upload_12345678",
        "policyVersion": "information-policy-2.0.0",
        "handlingClass": "INTERNAL",
        "legalClassification": "NONE",
        "tlp": "TLP:GREEN",
        "pap": None,
        "contentCategories": ["AUDIT"],
        "audience": {
            "organizationId": "org_stratos",
            "scopeType": "organization",
            "scopeIds": [],
            "recipientSubjectIds": [],
        },
        "obligations": ["AUDIT_ACCESS"],
        "originatorId": ACTOR,
        "issuedAt": "2026-07-14T00:00:00Z",
        "reviewAt": None,
    }


def _envelope(
    file_hash: str = FILE_HASH,
    policy_hash: str | None = None,
) -> dict:
    binding = InformationPolicyBinding.model_validate(_policy())
    return {
        "schemaVersion": "stratos-integration-envelope-1",
        "organizationId": "org_stratos",
        "sourceSystem": "STRATOS_AIIP",
        "externalRef": EXTERNAL_REF,
        "actor": {"type": "person", "subjectId": ACTOR},
        "sourceResource": {
            "governedResourceId": SOURCE_ID,
            "application": "AIIP",
            "resourceType": "idea",
            "resourceId": IDEA_ID,
            "sourceVersion": SOURCE_VERSION,
            "scope": {"type": "own", "ownerSubjectId": ACTOR},
        },
        "correlationId": "corr-aiip-upload-123",
        "idempotencyKey": "idem-aiip-upload-123",
        "policyBindingId": binding.policy_binding_id,
        "policyVersion": binding.policy_version,
        "policyHash": policy_hash or canonical_policy_hash(binding),
        "classification": {
            "handlingClass": "INTERNAL",
            "legalClassification": "NONE",
            "tlp": "TLP:GREEN",
            "pap": None,
        },
        "payload": {
            "operation": "document_upload",
            "entityType": "InnovationRequest",
            "entityId": IDEA_ID,
            "sourceDocumentId": f"/ideas/{IDEA_ID}/documents/source",
            "sha256": file_hash,
        },
    }


def _service_headers() -> dict[str, str]:
    return {
        "Authorization": "Bearer aiip-transport-token",
        "X-AIIP-Actor-Authorization": "Bearer current-actor-token",
        "X-AKL-Subject": "service-account-aiip-document-service",
        "X-AKL-Service-Client-ID": "aiip-document-service",
        "X-AKL-Roles": "service_aiip_document",
        "X-Correlation-ID": "corr-aiip-upload-123",
    }


def _ingestion_service_headers() -> dict[str, str]:
    return {
        "X-AKL-Subject": "service-account-svc-ingestion",
        "X-AKL-Service-Client-ID": "svc-ingestion",
        "X-AKL-Roles": "service_ingestion",
        "X-Correlation-ID": "corr-aiip-upload-123",
    }


def _preflight_payload(policy_hash: str | None = None) -> dict:
    return {
        "tenant_id": "org_stratos",
        "external_system": "STRATOS_AIIP",
        "external_ref": EXTERNAL_REF,
        "entity_type": "InnovationRequest",
        "entity_id": IDEA_ID,
        "document_type": "ai_intake",
        "title": "AIIP governed source",
        "classification": "internal",
        "information_policy": _policy(),
        "integration_envelope": _envelope(policy_hash=policy_hash),
        "governance_scope": {"type": "own", "ownerSubjectId": ACTOR},
        "tags": ["aiip"],
        "source_location": {
            "kind": "uploaded_file",
            "file_name": "source.pdf",
            "content_type": "application/pdf",
            "sha256": FILE_HASH,
            "repository": "AIIP",
            "path": f"/ideas/{IDEA_ID}/documents/source",
            "version": "1",
        },
    }


def test_dedicated_aiip_upload_persists_only_authoritative_actor_and_lineage(
    client, db_session, admin_headers
) -> None:
    first = client.post(
        "/api/v1/integrations/aiip-upload/external-documents/upsert",
        json=_preflight_payload(),
        headers=_service_headers(),
    )
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["created"] is True
    confirmation = body["governance_confirmation"]
    assert confirmation["parent_source_resource"]["governed_resource_id"] == SOURCE_ID
    assert confirmation["parent_source_resource"]["resource_id"] == IDEA_ID
    assert confirmation["governed_resource"]["resource_type"] == "document"
    assert confirmation["governed_resource"]["resource_id"] == body["document"]["document_id"]
    assert confirmation["governed_resource"]["source_version"] == SOURCE_VERSION
    assert confirmation["governed_resource"]["parent_id"] == SOURCE_ID
    assert confirmation["governed_resource"]["registered_by_subject_id"] == ACTOR
    assert confirmation["governed_resource"]["confirmed_by_subject_id"] == ACTOR
    assert body["document"]["owner_id"] == ACTOR
    assert body["document"]["gestor_unit"] is None
    assert {item["role"] for item in body["document"]["assignments"]} == {"owner"}
    assert body["document"]["governance_scope_owner_subject_id"] == ACTOR

    replay = client.post(
        "/api/v1/integrations/aiip-upload/external-documents/upsert",
        json=_preflight_payload(),
        headers=_service_headers(),
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["created"] is False
    assert replay.json()["document"]["document_id"] == body["document"]["document_id"]

    version_payload = {
        "version_label": "aiip-file-v1",
        "valid_from": "2026-07-14",
        "source_file_uri": "s3://akl-documents/aiip/source.pdf",
        "source_location": {
            "kind": "object_storage",
            "uri": "s3://akl-documents/aiip/source.pdf",
            "file_name": "source.pdf",
            "sha256": FILE_HASH,
            "path": f"/ideas/{IDEA_ID}/documents/source",
        },
        "file_hash": FILE_HASH,
        "change_summary": "AIIP upload",
        "information_policy": _policy(),
        "integration_envelope": _envelope(FILE_HASH),
        "governance_scope": {"type": "own", "ownerSubjectId": ACTOR},
        "file": {
            "filename": "source.pdf",
            "mime_type": "application/pdf",
            "size_bytes": 123,
            "sha256": FILE_HASH,
        },
    }
    version_response = client.put(
        f"/api/v1/integrations/aiip-upload/documents/{body['document']['document_id']}/versions",
        json=version_payload,
        headers=_service_headers(),
    )
    assert version_response.status_code == 200, version_response.text
    version_body = version_response.json()
    assert version_body["created"] is True
    version = version_body["version"]
    assert version_body["governance_confirmation"]["governed_resource"]["resource_type"] == "document-version"
    assert version_body["governance_confirmation"]["governed_resource"]["resource_id"] == version["document_version_id"]
    assert version_body["governance_confirmation"]["governed_resource"]["source_version"] == FILE_HASH
    assert version_body["governance_confirmation"]["governed_resource"]["parent_id"] == confirmation["governed_resource"]["id"]
    assert (
        version_body["external_document"]["external_document"]["current_document_version_id"]
        is None
    )
    stored_file = db_session.query(DocumentFile).filter_by(file_id=version["file_id"]).one()
    assert stored_file.uploaded_by == ACTOR

    version_replay = client.put(
        f"/api/v1/integrations/aiip-upload/documents/{body['document']['document_id']}/versions",
        json=version_payload,
        headers=_service_headers(),
    )
    assert version_replay.status_code == 200, version_replay.text
    assert version_replay.json()["created"] is False
    assert version_replay.json()["version"]["document_version_id"] == version["document_version_id"]

    generic_version = client.post(
        f"/api/v1/documents/{body['document']['document_id']}/versions",
        json={
            "version_label": "forged-generic-version",
            "source_file_uri": "s3://akl-documents/aiip/forged.pdf",
            "file_hash": FILE_HASH,
        },
        headers=admin_headers,
    )
    assert generic_version.status_code == 409
    assert generic_version.json()["error"]["code"] == "aiip_upload_dedicated_route_required"

    generic_establish_current = client.patch(
        f"/api/v1/documents/{body['document']['document_id']}/external-references/current",
        json={
            "current_document_version_id": version["document_version_id"],
            "current_ingestion_job_id": "job-forged-generic-current",
            "current_ingestion_status": "INDEXED",
        },
        headers=admin_headers,
    )
    assert generic_establish_current.status_code == 409
    assert generic_establish_current.json()["error"]["code"] == "aiip_upload_dedicated_route_required"

    file_metadata_conflict = client.put(
        f"/api/v1/integrations/aiip-upload/documents/{body['document']['document_id']}/versions",
        json={
            **version_payload,
            "file": {**version_payload["file"], "filename": "forged-name.pdf"},
        },
        headers=_service_headers(),
    )
    assert file_metadata_conflict.status_code == 409
    assert file_metadata_conflict.json()["error"]["code"] == "aiip_upload_version_payload_conflict"

    current_response = client.patch(
        f"/api/v1/integrations/aiip-upload/external-documents/{body['external_document']['external_document_id']}/current",
        json={
            "document_id": body["document"]["document_id"],
            "expected_current_document_version_id": None,
            "document_version_id": version["document_version_id"],
            "file_id": version["file_id"],
            "ingestion_job_id": "job-aiip-123",
            "ingestion_status": "INGESTING",
            "information_policy": _policy(),
            "integration_envelope": _envelope(FILE_HASH),
            "governance_scope": {"type": "own", "ownerSubjectId": ACTOR},
        },
        headers=_service_headers(),
    )
    assert current_response.status_code == 200, current_response.text
    assert current_response.json()["updated"] is True
    ref = current_response.json()["external_document"]["external_document"]
    assert ref["current_document_version_id"] == version["document_version_id"]
    assert ref["current_ingestion_job_id"] == "job-aiip-123"

    premature_indexed = client.patch(
        f"/api/v1/integrations/aiip-upload/external-documents/{body['external_document']['external_document_id']}/current",
        json={
            "document_id": body["document"]["document_id"],
            "expected_current_document_version_id": None,
            "document_version_id": version["document_version_id"],
            "file_id": version["file_id"],
            "ingestion_job_id": "job-aiip-123",
            "ingestion_status": "INDEXED",
            "information_policy": _policy(),
            "integration_envelope": _envelope(FILE_HASH),
            "governance_scope": {"type": "own", "ownerSubjectId": ACTOR},
        },
        headers=_service_headers(),
    )
    assert premature_indexed.status_code == 409
    assert (
        premature_indexed.json()["error"]["code"]
        == "aiip_ingestion_status_authority_conflict"
    )

    for authoritative_status in ("INGESTING", "INDEXED"):
        transitioned = client.patch(
            f"/api/v1/documents/{body['document']['document_id']}/external-references/current",
            json={
                "current_document_version_id": version["document_version_id"],
                "expected_current_ingestion_job_id": "job-aiip-123",
                "current_ingestion_job_id": "job-aiip-123",
                "current_ingestion_status": authoritative_status,
            },
            headers=_ingestion_service_headers(),
        )
        assert transitioned.status_code == 200, transitioned.text

    current_replay = client.patch(
        f"/api/v1/integrations/aiip-upload/external-documents/{body['external_document']['external_document_id']}/current",
        json={
            "document_id": body["document"]["document_id"],
            "expected_current_document_version_id": None,
            "document_version_id": version["document_version_id"],
            "file_id": version["file_id"],
            "ingestion_job_id": "job-aiip-123",
            "ingestion_status": "INDEXED",
            "information_policy": _policy(),
            "integration_envelope": _envelope(FILE_HASH),
            "governance_scope": {"type": "own", "ownerSubjectId": ACTOR},
        },
        headers=_service_headers(),
    )
    assert current_replay.status_code == 200, current_replay.text
    assert current_replay.json()["updated"] is False
    assert (
        current_replay.json()["external_document"]["external_document"]["current_ingestion_status"]
        == "INDEXED"
    )

    generic_external_current = client.patch(
        f"/api/v1/external-documents/{body['external_document']['external_document_id']}/current",
        json={
            "current_document_version_id": version["document_version_id"],
            "current_ingestion_status": "INDEXED",
        },
        headers=admin_headers,
    )
    assert generic_external_current.status_code == 409
    assert generic_external_current.json()["error"]["code"] == "aiip_upload_dedicated_route_required"

    aiip_service_status_bypass = client.patch(
        f"/api/v1/documents/{body['document']['document_id']}/external-references/current",
        json={
            "current_document_version_id": version["document_version_id"],
            "current_ingestion_job_id": "job-aiip-service-bypass",
            "current_ingestion_status": "INDEXED",
        },
        headers=_service_headers(),
    )
    assert aiip_service_status_bypass.status_code == 403
    assert aiip_service_status_bypass.json()["error"]["code"] == "service_route_forbidden"

    status_only = client.patch(
        f"/api/v1/documents/{body['document']['document_id']}/external-references/current",
        json={
            "current_document_version_id": version["document_version_id"],
            "expected_current_ingestion_job_id": "job-aiip-123",
            "current_ingestion_job_id": "job-aiip-status-only",
            "current_ingestion_status": "QUEUED",
        },
        headers=_ingestion_service_headers(),
    )
    assert status_only.status_code == 200, status_only.text
    assert status_only.json()["items"][0]["current_document_version_id"] == version["document_version_id"]
    assert status_only.json()["items"][0]["current_ingestion_job_id"] == "job-aiip-status-only"
    assert status_only.json()["items"][0]["current_ingestion_status"] == "QUEUED"

    forbidden_status_lineage = client.patch(
        f"/api/v1/documents/{body['document']['document_id']}/external-references/current",
        json={
            "current_document_version_id": version["document_version_id"],
            "current_file_id": version["file_id"],
            "current_ingestion_status": "INDEXED",
        },
        headers=admin_headers,
    )
    assert forbidden_status_lineage.status_code == 409
    assert forbidden_status_lineage.json()["error"]["code"] == "aiip_upload_dedicated_route_required"

    version_payload_2 = {
        **version_payload,
        "version_label": "aiip-file-v2",
        "source_file_uri": "s3://akl-documents/aiip/source-v2.pdf",
        "source_location": {
            "kind": "object_storage",
            "uri": "s3://akl-documents/aiip/source-v2.pdf",
            "file_name": "source-v2.pdf",
            "sha256": FILE_HASH_2,
            "path": f"/ideas/{IDEA_ID}/documents/source",
        },
        "file_hash": FILE_HASH_2,
        "integration_envelope": _envelope(FILE_HASH_2),
        "file": {
            "filename": "source-v2.pdf",
            "mime_type": "application/pdf",
            "size_bytes": 456,
            "sha256": FILE_HASH_2,
        },
    }
    version_response_2 = client.put(
        f"/api/v1/integrations/aiip-upload/documents/{body['document']['document_id']}/versions",
        json=version_payload_2,
        headers=_service_headers(),
    )
    assert version_response_2.status_code == 200, version_response_2.text
    version_2 = version_response_2.json()["version"]
    assert (
        version_response_2.json()["external_document"]["external_document"]["current_document_version_id"]
        == version["document_version_id"]
    )

    stale_current = client.patch(
        f"/api/v1/integrations/aiip-upload/external-documents/{body['external_document']['external_document_id']}/current",
        json={
            "document_id": body["document"]["document_id"],
            "expected_current_document_version_id": None,
            "document_version_id": version_2["document_version_id"],
            "file_id": version_2["file_id"],
            "ingestion_job_id": "job-aiip-456",
            "ingestion_status": "INGESTING",
            "information_policy": _policy(),
            "integration_envelope": _envelope(FILE_HASH_2),
            "governance_scope": {"type": "own", "ownerSubjectId": ACTOR},
        },
        headers=_service_headers(),
    )
    assert stale_current.status_code == 409
    assert stale_current.json()["error"]["code"] == "aiip_upload_current_cas_conflict"

    advanced_current = client.patch(
        f"/api/v1/integrations/aiip-upload/external-documents/{body['external_document']['external_document_id']}/current",
        json={
            "document_id": body["document"]["document_id"],
            "expected_current_document_version_id": version["document_version_id"],
            "document_version_id": version_2["document_version_id"],
            "file_id": version_2["file_id"],
            "ingestion_job_id": "job-aiip-456",
            "ingestion_status": "INGESTING",
            "information_policy": _policy(),
            "integration_envelope": _envelope(FILE_HASH_2),
            "governance_scope": {"type": "own", "ownerSubjectId": ACTOR},
        },
        headers=_service_headers(),
    )
    assert advanced_current.status_code == 200, advanced_current.text
    assert advanced_current.json()["updated"] is True
    assert (
        advanced_current.json()["external_document"]["external_document"]["current_document_version_id"]
        == version_2["document_version_id"]
    )

    stored_version = stored_file.document_version
    stored_version.governed_parent_resource_id = "forged-parent"
    db_session.commit()
    tampered_replay = client.put(
        f"/api/v1/integrations/aiip-upload/documents/{body['document']['document_id']}/versions",
        json=version_payload,
        headers=_service_headers(),
    )
    assert tampered_replay.status_code == 409
    assert tampered_replay.json()["error"]["code"] == "aiip_upload_version_lineage_conflict"


def test_dedicated_aiip_upload_preserves_central_registry_hash(client) -> None:
    response = client.post(
        "/api/v1/integrations/aiip-upload/external-documents/upsert",
        json=_preflight_payload(AUTHORITATIVE_POLICY_HASH),
        headers=_service_headers(),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["document"]["policy_hash"] == AUTHORITATIVE_POLICY_HASH
    assert (
        body["governance_confirmation"]["document_policy_hash"]
        == AUTHORITATIVE_POLICY_HASH
    )


def test_dedicated_aiip_upload_rejects_broad_or_forged_transport(client) -> None:
    assistance_identity = {
        **_service_headers(),
        "X-AKL-Subject": "service-account-aiip-service",
        "X-AKL-Service-Client-ID": "aiip-service",
        "X-AKL-Roles": "service_aiip",
    }
    wrong_service = client.post(
        "/api/v1/integrations/aiip-upload/external-documents/upsert",
        json=_preflight_payload(),
        headers=assistance_identity,
    )
    assert wrong_service.status_code == 403
    assert wrong_service.json()["error"]["code"] == "untrusted_service_identity"

    missing_actor = client.post(
        "/api/v1/integrations/aiip-upload/external-documents/upsert",
        json=_preflight_payload(),
        headers={
            key: value
            for key, value in _service_headers().items()
            if key != "X-AIIP-Actor-Authorization"
        },
    )
    assert missing_actor.status_code == 401
    assert missing_actor.json()["error"]["code"] == "aiip_actor_authorization_required"

    same_token = {
        **_service_headers(),
        "X-AIIP-Actor-Authorization": "Bearer aiip-transport-token",
    }
    conflict = client.post(
        "/api/v1/integrations/aiip-upload/external-documents/upsert",
        json=_preflight_payload(),
        headers=same_token,
    )
    assert conflict.status_code == 403
    assert conflict.json()["error"]["code"] == "aiip_actor_service_conflict"

    metadata = client.post(
        "/api/v1/integrations/aiip-upload/external-documents/upsert",
        json={**_preflight_payload(), "metadata": {"authorization": "forbidden"}},
        headers=_service_headers(),
    )
    assert metadata.status_code == 422


def test_dedicated_aiip_upload_schema_rejects_unknown_assignment_and_lineage_fields(
    client,
) -> None:
    unknown_payload = _preflight_payload()
    unknown_payload["integration_envelope"]["payload"]["unexpected"] = True
    caller_assignment = {**_preflight_payload(), "gestor_unit": "caller-controlled"}
    mismatched_entity = _preflight_payload()
    mismatched_entity["integration_envelope"]["payload"]["entityId"] = "another-idea"
    broad_document_type = {**_preflight_payload(), "document_type": "directive"}

    for payload in (
        unknown_payload,
        caller_assignment,
        mismatched_entity,
        broad_document_type,
    ):
        response = client.post(
            "/api/v1/integrations/aiip-upload/external-documents/upsert",
            json=payload,
            headers=_service_headers(),
        )
        assert response.status_code == 422, response.text


def test_central_aiip_akb_client_uses_separate_credentials_and_exact_echo(monkeypatch) -> None:
    binding = InformationPolicyBinding.model_validate(_policy())
    envelope = IntegrationEnvelope.model_validate(
        _envelope(policy_hash=AUTHORITATIVE_POLICY_HASH)
    )
    scope = {"type": "own", "ownerSubjectId": ACTOR}
    captured = {}
    response = {
        "id": "gres-akb-document-123",
        "application": "AKB",
        "resourceType": "document",
        "resourceId": "doc-aiip-123",
        "sourceVersion": SOURCE_VERSION,
        "title": "AIIP governed source",
        "parentId": SOURCE_ID,
        "scope": scope,
        "isActive": True,
        "policyAssignment": "INHERITED",
        "explicitPolicyBindingId": None,
        "inheritedFromResourceId": SOURCE_ID,
        "effectivePolicy": {
            "policyBindingId": binding.policy_binding_id,
            "policyVersion": binding.policy_version,
            "policyHash": AUTHORITATIVE_POLICY_HASH,
            "originatorId": binding.originator_id,
            "originator": binding.originator_id,
            "issuedAt": "2026-07-14T00:00:00Z",
            "reviewAt": None,
        },
        "registeredBySubjectId": ACTOR,
        "confirmedBySubjectId": ACTOR,
        "correlation_id": envelope.correlation_id,
        "idempotency_key": envelope.idempotency_key,
    }

    class Client:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def request(self, method, url, **kwargs):
            captured.update(method=method, url=url, **kwargs)
            return SimpleNamespace(status_code=200, json=lambda: dict(response))

    monkeypatch.setattr("app.access_governance.httpx.Client", Client)
    settings = Settings(
        AKL_ENV="test",
        AKL_AUTH_MODE="mock",
        AKL_STRATOS_AIIP_AKB_RESOURCES_URL="https://stratos.example/api/v1/integrations/aiip/akb/resources",
        AKB_AIIP_INGEST_SERVICE_TOKEN="dedicated-akb-ingest-token",
    )
    registration = StratosGovernanceClient(settings).register_aiip_akb_resource(
        actor_token="fresh-person-token",
        resource_type="document",
        resource_id="doc-aiip-123",
        source_version=SOURCE_VERSION,
        title="AIIP governed source",
        parent_id=SOURCE_ID,
        scope=scope,
        envelope=envelope,
        binding=binding,
        reason="test exact lineage",
    )
    assert registration.confirmed_by_subject_id == ACTOR
    assert registration.policy_hash == AUTHORITATIVE_POLICY_HASH
    assert captured["headers"]["Authorization"] == "Bearer dedicated-akb-ingest-token"
    assert captured["headers"]["X-AIIP-Actor-Authorization"] == "Bearer fresh-person-token"
    assert "fresh-person-token" not in str(captured["json"])

    response["parentId"] = "forged-parent"
    with pytest.raises(GovernanceInvalidResponse):
        StratosGovernanceClient(settings).register_aiip_akb_resource(
            actor_token="fresh-person-token",
            resource_type="document",
            resource_id="doc-aiip-123",
            source_version=SOURCE_VERSION,
            title="AIIP governed source",
            parent_id=SOURCE_ID,
            scope=scope,
            envelope=envelope,
            binding=binding,
            reason="reject forged lineage",
        )

    response["parentId"] = SOURCE_ID
    response["registeredBySubjectId"] = "different-subject"
    replay_registration = StratosGovernanceClient(settings).register_aiip_akb_resource(
        actor_token="fresh-person-token",
        resource_type="document",
        resource_id="doc-aiip-123",
        source_version=SOURCE_VERSION,
        title="AIIP governed source",
        parent_id=SOURCE_ID,
        scope=scope,
        envelope=envelope,
        binding=binding,
        reason="accept immutable historical registrar with a fresh confirmer",
    )
    assert replay_registration.registered_by_subject_id == "different-subject"
    assert replay_registration.confirmed_by_subject_id == ACTOR
