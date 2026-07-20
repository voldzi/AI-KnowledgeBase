from types import SimpleNamespace

from app.access_governance import StratosGovernanceClient
from app.config import Settings
from app.information_policy import (
    InformationPolicyBinding,
    IntegrationEnvelope,
    canonical_policy_hash,
)
from app.models import (
    AuditEvent,
    DocumentFile,
    DocumentVersion,
    ExternalDocumentRef,
    IngestionAttempt,
)
from app.permissions import SubjectContext, evaluate_document_access


ACTOR = "actor-budget-owner-123"
SECOND_ACTOR = "actor-budget-manager-456"
CONTRACT_ID = "contract-budget-123"
FINANCIAL_SCOPE = "budget:section-it"
PARENT_RESOURCE = "gres-budget-contract-123"
EXTERNAL_REF = f"contract:{CONTRACT_ID}:document:signed"
FILE_HASH = f"sha256:{'a' * 64}"
FILE_HASH_2 = f"sha256:{'b' * 64}"


def test_budget_governance_client_preserves_explicit_null_classification(monkeypatch):
    policy = _policy()
    policy["tlp"] = None
    binding = InformationPolicyBinding.model_validate(policy)
    raw_envelope = _envelope()
    raw_envelope["policyHash"] = canonical_policy_hash(binding)
    raw_envelope["classification"]["tlp"] = None
    envelope = IntegrationEnvelope.model_validate(raw_envelope)
    captured: dict = {}
    response = {
        "id": "gres-budget-document-123",
        "application": "AKB",
        "resourceType": "document",
        "resourceId": "doc-budget-123",
        "sourceVersion": "document-v1",
        "parentId": PARENT_RESOURCE,
        "scope": {"type": "budget_scope", "id": FINANCIAL_SCOPE},
        "isActive": True,
        "policyAssignment": "INHERITED",
        "explicitPolicyBindingId": None,
        "inheritedFromResourceId": PARENT_RESOURCE,
        "effectivePolicy": {
            "policyBindingId": binding.policy_binding_id,
            "policyVersion": binding.policy_version,
            "policyHash": canonical_policy_hash(binding),
            "originatorId": binding.originator_id,
            "originator": binding.originator_id,
            "issuedAt": "2026-07-20T00:00:00Z",
            "reviewAt": None,
        },
        "registeredBySubjectId": "service:akb",
        "confirmedBySubjectId": "service:akb",
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
            return SimpleNamespace(status_code=200, json=lambda: response)

    monkeypatch.setattr("app.access_governance.httpx.Client", Client)
    settings = Settings(
        AKL_ENV="test",
        AKL_AUTH_MODE="mock",
        AKL_STRATOS_BUDGET_AKB_RESOURCES_URL=(
            "https://stratos.example/api/v1/integrations/budget/akb/resources"
        ),
        AKB_POLICY_SERVICE_TOKEN="budget-policy-token",
    )
    StratosGovernanceClient(settings).register_budget_akb_resource(
        resource_type="document",
        resource_id="doc-budget-123",
        source_version="document-v1",
        title="Smlouva",
        parent_id=PARENT_RESOURCE,
        inherited_from_resource_id=PARENT_RESOURCE,
        scope={"type": "budget_scope", "id": FINANCIAL_SCOPE},
        envelope=envelope,
        binding=binding,
        reason="test exact lineage",
    )

    classification = captured["json"]["integrationEnvelope"]["classification"]
    assert classification == {
        "handlingClass": "INTERNAL",
        "legalClassification": "NONE",
        "tlp": None,
        "pap": None,
    }
    assert "sourceResource" not in captured["json"]["integrationEnvelope"]


def _policy(scope_id: str = FINANCIAL_SCOPE) -> dict:
    return {
        "schemaVersion": "stratos-information-policy-2",
        "policyBindingId": "pb_budget_upload_12345678",
        "policyVersion": "information-policy-2.0.0",
        "handlingClass": "INTERNAL",
        "legalClassification": "NONE",
        "tlp": "TLP:GREEN",
        "pap": None,
        "contentCategories": ["CONTRACTUAL", "FINANCIAL"],
        "audience": {
            "organizationId": "org_stratos",
            "scopeType": "budget_scope",
            "scopeIds": [scope_id],
            "recipientSubjectIds": [],
        },
        "obligations": ["AUDIT_ACCESS"],
        "originatorId": ACTOR,
        "issuedAt": "2026-07-20T00:00:00Z",
        "reviewAt": None,
    }


def _envelope(file_hash: str = FILE_HASH, *, actor: str = ACTOR) -> dict:
    binding = InformationPolicyBinding.model_validate(_policy())
    return {
        "schemaVersion": "stratos-integration-envelope-1",
        "organizationId": "org_stratos",
        "sourceSystem": "STRATOS_BUDGET",
        "externalRef": EXTERNAL_REF,
        "actor": {"type": "person", "subjectId": actor},
        "correlationId": "corr-budget-upload-123",
        "idempotencyKey": "idem-budget-upload-123",
        "policyBindingId": binding.policy_binding_id,
        "policyVersion": binding.policy_version,
        "policyHash": canonical_policy_hash(binding),
        "classification": {
            "handlingClass": "INTERNAL",
            "legalClassification": "NONE",
            "tlp": "TLP:GREEN",
            "pap": None,
        },
        "payload": {
            "contractId": CONTRACT_ID,
            "financialScopeKey": FINANCIAL_SCOPE,
            "fileHash": file_hash,
        },
    }


def _service_headers(*, roles: str = "service_ingestion") -> dict[str, str]:
    return {
        "Authorization": "Bearer budget-transport-token",
        "X-AKL-Subject": "service-account-stratos-akb-service",
        "X-AKL-Service-Client-ID": "stratos-akb-service",
        "X-AKL-Roles": roles,
        "X-Correlation-ID": "corr-budget-upload-123",
    }


def _preflight_payload(
    file_hash: str = FILE_HASH,
    filename: str = "smlouva.pdf",
    *,
    actor: str = ACTOR,
    title: str = "Smlouva o provozu IT služeb",
    contract_number: str = "S-2023-001",
    contract_name: str = "Smlouva o provozu IT služeb",
) -> dict:
    return {
        "tenant_id": "org_stratos",
        "external_system": "STRATOS_BUDGET",
        "external_ref": EXTERNAL_REF,
        "entity_type": "Contract",
        "entity_id": CONTRACT_ID,
        "document_type": "contract",
        "title": title,
        "classification": "internal",
        "information_policy": _policy(),
        "integration_envelope": _envelope(file_hash, actor=actor),
        "owner": {"user_id": actor, "display_name": "Správce smlouvy"},
        "tags": ["contract", "historical-import"],
        "metadata": {
            "contract_id": CONTRACT_ID,
            "contract_number": contract_number,
            "contract_name": contract_name,
            "financial_scope_key": FINANCIAL_SCOPE,
            "contract_status": "EXPIRED",
            "contract_start_date": "2023-01-01",
            "contract_end_date": "2025-12-31",
            "lifecycle": "ARCHIVED",
            "documentType": "CONTRACT_ARCHIVE",
            "document_type": "CONTRACT_ARCHIVE",
            "batch_manifest_id": "budget-contract-documents-2026-07-20",
            "batch_entries_sha256": f"sha256:{'c' * 64}",
            "release_revision": "d" * 40,
        },
        "source_location": {
            "kind": "uploaded_file",
            "file_name": filename,
            "content_type": "application/pdf",
            "sha256": file_hash,
            "repository": "Budget & Contract",
            "path": EXTERNAL_REF,
            "version": file_hash,
        },
        "governance_scope": {"type": "budget_scope", "id": FINANCIAL_SCOPE},
        "parent_governed_resource_id": PARENT_RESOURCE,
    }


def _version_payload(file_hash: str = FILE_HASH, *, actor: str = ACTOR) -> dict:
    filename = "smlouva.pdf" if file_hash == FILE_HASH else "smlouva-v2.pdf"
    uri = f"s3://akl-documents/budget/{filename}"
    return {
        "external_ref": EXTERNAL_REF,
        "version_label": "contract-file-v1",
        "valid_from": "2023-01-01",
        "valid_to": "2025-12-31",
        "source_file_uri": uri,
        "source_location": {
            "kind": "object_storage",
            "uri": uri,
            "file_name": filename,
            "content_type": "application/pdf",
            "sha256": file_hash,
            "repository": "Budget & Contract",
            "path": EXTERNAL_REF,
            "version": file_hash,
        },
        "file_hash": file_hash,
        "change_summary": "Historický import smlouvy",
        "upload_mode": "historical_batch",
        "original_file_name": filename,
        "batch_lineage": {
            "batch_manifest_id": "budget-contract-documents-2026-07-20",
            "batch_entries_sha256": f"sha256:{'c' * 64}",
            "release_revision": "d" * 40,
        },
        "contract_status": "EXPIRED",
        "contract_start_date": "2023-01-01",
        "contract_end_date": "2025-12-31",
        "information_policy": _policy(),
        "integration_envelope": _envelope(file_hash, actor=actor),
        "governance_scope": {"type": "budget_scope", "id": FINANCIAL_SCOPE},
        "parent_governed_resource_id": PARENT_RESOURCE,
        "file": {
            "filename": filename,
            "mime_type": "application/pdf",
            "size_bytes": 12345,
            "sha256": file_hash,
        },
    }


def _create_document_and_version(client) -> tuple[dict, dict]:
    created = client.post(
        "/api/v1/integrations/stratos-budget-upload/external-documents/upsert",
        json=_preflight_payload(),
        headers=_service_headers(),
    )
    assert created.status_code == 201, created.text
    version = client.put(
        "/api/v1/integrations/stratos-budget-upload/documents/"
        f"{created.json()['document']['document_id']}/versions",
        json=_version_payload(),
        headers=_service_headers(),
    )
    assert version.status_code == 201, version.text
    return created.json(), version.json()


def test_budget_bridge_is_exact_idempotent_and_service_audited(
    client, db_session, admin_headers
) -> None:
    created, version_created = _create_document_and_version(client)
    document = created["document"]
    external = created["external_document"]
    version = version_created["version"]
    assert created["created"] is True
    assert document["owner_id"] == ACTOR
    assert document["governance_scope_type"] == "budget_scope"
    assert document["governance_scope_id"] == FINANCIAL_SCOPE
    assert document["governed_parent_resource_id"] == PARENT_RESOURCE
    assert document["metadata"]["lifecycle"] == "ARCHIVED"
    assert "integration_envelope" not in document["metadata"]
    assert "sha256" not in document["metadata"]["external"]["source_location"]
    assert version_created["created"] is True
    assert version_created["external_document"]["document"]["status"] == "valid"
    assert version["status"] == "valid"
    assert version["governed_parent_resource_id"] == document["governed_resource_id"]
    assert (
        version["source_location"]["stratos_budget_upload"]
        ["integration_envelope"]["payload"]["fileHash"]
        == FILE_HASH
    )
    assert version["source_location"]["stratos_budget_upload"]["upload_mode"] == "historical_batch"
    assert version["source_location"]["stratos_budget_upload"]["original_file_name"] == "smlouva.pdf"
    assert version["source_location"]["stratos_budget_upload"]["contract_status"] == "EXPIRED"
    assert version["source_location"]["stratos_budget_upload"]["contract_start_date"] == "2023-01-01"
    assert version["source_location"]["stratos_budget_upload"]["contract_end_date"] == "2025-12-31"

    stored_document = db_session.get(
        ExternalDocumentRef, external["external_document_id"]
    ).document
    allowed = evaluate_document_access(
        SubjectContext(
            subject_id="budget-reader-it",
            roles=set(),
            groups=set(),
            capabilities={"akb:chat"},
            scopes={f"budget_scope:{FINANCIAL_SCOPE}"},
            organization_id="org_stratos",
            identity_active=True,
            membership_active=True,
            application_access_active=True,
            access_v2=True,
        ),
        "rag.query",
        stored_document,
    )
    denied = evaluate_document_access(
        SubjectContext(
            subject_id="budget-reader-other",
            roles=set(),
            groups=set(),
            capabilities={"akb:chat"},
            scopes={"budget_scope:budget:section-logistics"},
            organization_id="org_stratos",
            identity_active=True,
            membership_active=True,
            application_access_active=True,
            access_v2=True,
        ),
        "rag.query",
        stored_document,
    )
    assert allowed.allowed is True
    assert denied.allowed is False
    assert denied.reason_codes == ("SCOPE_MISMATCH",)
    assert (
        version["source_location"]["stratos_budget_upload"]["batch_lineage"]
        ["batch_manifest_id"]
        == "budget-contract-documents-2026-07-20"
    )
    stored_file = db_session.query(DocumentFile).filter_by(file_id=version["file_id"]).one()
    assert stored_file.uploaded_by == ACTOR

    document_replay = client.post(
        "/api/v1/integrations/stratos-budget-upload/external-documents/upsert",
        json=_preflight_payload(),
        headers=_service_headers(),
    )
    assert document_replay.status_code == 200, document_replay.text
    assert document_replay.json()["created"] is False
    assert document_replay.json()["document"]["document_id"] == document["document_id"]

    version_replay = client.put(
        "/api/v1/integrations/stratos-budget-upload/documents/"
        f"{document['document_id']}/versions",
        json={
            **_version_payload(),
            "source_file_uri": "s3://akl-documents/budget/retry/smlouva.pdf",
            "source_location": {
                **_version_payload()["source_location"],
                "uri": "s3://akl-documents/budget/retry/smlouva.pdf",
                "storage_ref": "budget/retry/smlouva.pdf",
                "captured_at": "2026-07-20T12:00:00Z",
            },
        },
        headers=_service_headers(),
    )
    assert version_replay.status_code == 200, version_replay.text
    assert version_replay.json()["created"] is False
    assert version_replay.json()["version"]["document_version_id"] == version["document_version_id"]
    assert version_replay.json()["version"]["file_id"] == version["file_id"]
    assert db_session.query(DocumentVersion).count() == 1
    assert db_session.query(DocumentFile).count() == 1

    stored_only = client.patch(
        "/api/v1/integrations/stratos-budget-upload/external-documents/"
        f"{external['external_document_id']}/current",
        json={
            "document_id": document["document_id"],
            "expected_current_document_version_id": None,
            "expected_current_ingestion_job_id": None,
            "document_version_id": version["document_version_id"],
            "file_id": version["file_id"],
            "ingestion_job_id": None,
            "ingestion_status": "VERSION_CREATED",
            "external_ref": EXTERNAL_REF,
            "information_policy": _policy(),
            "integration_envelope": _envelope(),
            "governance_scope": {"type": "budget_scope", "id": FINANCIAL_SCOPE},
            "parent_governed_resource_id": PARENT_RESOURCE,
        },
        headers=_service_headers(),
    )
    assert stored_only.status_code == 200, stored_only.text
    current = stored_only.json()["external_document"]["external_document"]
    assert current["current_document_version_id"] == version["document_version_id"]
    assert current["current_file_id"] == version["file_id"]
    assert current["current_ingestion_job_id"] is None
    assert current["current_ingestion_status"] == "VERSION_CREATED"

    status_response = client.get(
        f"/api/v1/integrations/stratos-budget-upload/documents/{document['document_id']}/status",
        headers=_service_headers(),
    )
    assert status_response.status_code == 200, status_response.text
    assert status_response.json()["items"][0]["current_ingestion_status"] == "VERSION_CREATED"
    assert status_response.json()["ingestion_attempt"] is None

    generic_version = client.post(
        f"/api/v1/documents/{document['document_id']}/versions",
        json={
            "version_label": "forged",
            "source_file_uri": "s3://akl-documents/budget/forged.pdf",
            "file_hash": FILE_HASH,
        },
        headers=admin_headers,
    )
    assert generic_version.status_code == 409
    assert generic_version.json()["error"]["code"] == "stratos_budget_upload_dedicated_route_required"

    generic_current = client.patch(
        f"/api/v1/external-documents/{external['external_document_id']}/current",
        json={"current_document_version_id": version["document_version_id"]},
        headers=admin_headers,
    )
    assert generic_current.status_code == 409
    assert generic_current.json()["error"]["code"] == "stratos_budget_upload_dedicated_route_required"


def test_budget_bridge_allows_another_authorized_actor_to_update_descriptive_metadata_and_add_version(
    client, db_session
) -> None:
    created, first_version_created = _create_document_and_version(client)
    document = created["document"]
    first_version = first_version_created["version"]

    corrected_payload = _preflight_payload(
        FILE_HASH_2,
        "smlouva-opravena.pdf",
        actor=SECOND_ACTOR,
        title="S-2023-001A – Opravený název smlouvy",
        contract_number="S-2023-001A",
        contract_name="Opravený název smlouvy",
    )
    corrected_payload["metadata"]["batch_manifest_id"] = "budget-contract-documents-correction"
    corrected_payload["metadata"]["batch_entries_sha256"] = f"sha256:{'e' * 64}"
    corrected_payload["metadata"]["release_revision"] = "f" * 40
    corrected = client.post(
        "/api/v1/integrations/stratos-budget-upload/external-documents/upsert",
        json=corrected_payload,
        headers=_service_headers(),
    )
    assert corrected.status_code == 200, corrected.text
    corrected_document = corrected.json()["document"]
    assert corrected.json()["created"] is False
    assert corrected_document["document_id"] == document["document_id"]
    assert corrected_document["owner_id"] == ACTOR
    assert corrected_document["title"] == "S-2023-001A – Opravený název smlouvy"
    assert corrected_document["metadata"]["contract_number"] == "S-2023-001A"
    assert corrected_document["metadata"]["contract_name"] == "Opravený název smlouvy"
    replay_audit = (
        db_session.query(AuditEvent)
        .filter(AuditEvent.event_type == "external_document.stratos_budget_replayed")
        .order_by(AuditEvent.created_at.desc())
        .first()
    )
    assert replay_audit is not None
    assert replay_audit.event_metadata["descriptive_fields_updated"] == [
        "contract_name",
        "contract_number",
        "title",
    ]

    second_version_payload = _version_payload(FILE_HASH_2, actor=SECOND_ACTOR)
    second_version_payload["version_label"] = "contract-file-v2"
    second_version_payload["batch_lineage"] = {
        "batch_manifest_id": "budget-contract-documents-correction",
        "batch_entries_sha256": f"sha256:{'e' * 64}",
        "release_revision": "f" * 40,
    }
    second_version = client.put(
        "/api/v1/integrations/stratos-budget-upload/documents/"
        f"{document['document_id']}/versions",
        json=second_version_payload,
        headers=_service_headers(),
    )
    assert second_version.status_code == 201, second_version.text
    created_version = second_version.json()["version"]
    assert created_version["document_version_id"] != first_version["document_version_id"]
    stored_file = (
        db_session.query(DocumentFile)
        .filter_by(file_id=created_version["file_id"])
        .one()
    )
    assert stored_file.uploaded_by == SECOND_ACTOR
    stored_first_version = (
        db_session.query(DocumentVersion)
        .filter_by(document_version_id=first_version["document_version_id"])
        .one()
    )
    assert (
        stored_first_version.source_location["stratos_budget_upload"]["batch_lineage"]
        ["batch_manifest_id"]
        == "budget-contract-documents-2026-07-20"
    )
    assert (
        created_version["source_location"]["stratos_budget_upload"]["batch_lineage"]
        ["batch_manifest_id"]
        == "budget-contract-documents-correction"
    )

    replay_with_other_batch = _version_payload()
    replay_with_other_batch["batch_lineage"] = second_version_payload["batch_lineage"]
    replay = client.put(
        "/api/v1/integrations/stratos-budget-upload/documents/"
        f"{document['document_id']}/versions",
        json=replay_with_other_batch,
        headers=_service_headers(),
    )
    assert replay.status_code == 409, replay.text
    assert replay.json()["error"]["code"] == "stratos_budget_upload_version_payload_conflict"
    assert db_session.query(DocumentVersion).count() == 2


def test_budget_bridge_enforces_service_role_scope_parent_and_replay_conflicts(
    client
) -> None:
    missing_role = client.post(
        "/api/v1/integrations/stratos-budget-upload/external-documents/upsert",
        json=_preflight_payload(),
        headers=_service_headers(roles="reader"),
    )
    assert missing_role.status_code == 403
    assert missing_role.json()["error"]["code"] == "service_route_forbidden"

    invalid_external_ref = _preflight_payload()
    invalid_external_ref["external_ref"] = "contract:another-contract:document:signed"
    invalid_external_ref["integration_envelope"]["externalRef"] = (
        "contract:another-contract:document:signed"
    )
    invalid_ref_response = client.post(
        "/api/v1/integrations/stratos-budget-upload/external-documents/upsert",
        json=invalid_external_ref,
        headers=_service_headers(),
    )
    assert invalid_ref_response.status_code == 422

    wrong_scope = _preflight_payload()
    other_scope = "budget:section-economic"
    wrong_scope["governance_scope"] = {"type": "budget_scope", "id": other_scope}
    wrong_scope["integration_envelope"]["payload"]["financialScopeKey"] = other_scope
    wrong_scope["metadata"]["financial_scope_key"] = other_scope
    scope_response = client.post(
        "/api/v1/integrations/stratos-budget-upload/external-documents/upsert",
        json=wrong_scope,
        headers=_service_headers(),
    )
    assert scope_response.status_code == 422

    created, version_created = _create_document_and_version(client)
    document = created["document"]
    external = created["external_document"]
    version = version_created["version"]

    parent_conflict = _preflight_payload()
    parent_conflict["parent_governed_resource_id"] = "gres-budget-other-contract"
    parent_response = client.post(
        "/api/v1/integrations/stratos-budget-upload/external-documents/upsert",
        json=parent_conflict,
        headers=_service_headers(),
    )
    assert parent_response.status_code == 409
    assert parent_response.json()["error"]["code"] == "stratos_budget_upload_lineage_conflict"

    version_hash_conflict = _version_payload(FILE_HASH_2)
    hash_response = client.put(
        "/api/v1/integrations/stratos-budget-upload/documents/"
        f"{document['document_id']}/versions",
        json=version_hash_conflict,
        headers=_service_headers(),
    )
    assert hash_response.status_code == 409
    assert hash_response.json()["error"]["code"] == "stratos_budget_upload_version_hash_conflict"

    invalid_pair = client.patch(
        "/api/v1/integrations/stratos-budget-upload/external-documents/"
        f"{external['external_document_id']}/current",
        json={
            "document_id": document["document_id"],
            "expected_current_document_version_id": None,
            "document_version_id": version["document_version_id"],
            "file_id": version["file_id"],
            "ingestion_job_id": None,
            "ingestion_status": "INGESTING",
            "external_ref": EXTERNAL_REF,
            "information_policy": _policy(),
            "integration_envelope": _envelope(),
            "governance_scope": {"type": "budget_scope", "id": FINANCIAL_SCOPE},
            "parent_governed_resource_id": PARENT_RESOURCE,
        },
        headers=_service_headers(),
    )
    assert invalid_pair.status_code == 422


def test_budget_bridge_accepts_global_financial_scope(client) -> None:
    payload = _preflight_payload()
    global_policy = _policy("budget-global")
    payload["information_policy"] = global_policy
    payload["integration_envelope"]["policyHash"] = canonical_policy_hash(
        InformationPolicyBinding.model_validate(global_policy)
    )
    payload["governance_scope"] = {"type": "budget_scope", "id": "budget-global"}
    payload["integration_envelope"]["payload"]["financialScopeKey"] = "budget-global"
    payload["metadata"]["financial_scope_key"] = "budget-global"

    created = client.post(
        "/api/v1/integrations/stratos-budget-upload/external-documents/upsert",
        json=payload,
        headers=_service_headers(),
    )
    assert created.status_code == 201, created.text
    assert created.json()["document"]["governance_scope_id"] == "budget-global"


def test_budget_document_lifecycle_can_only_advance_to_archived(client) -> None:
    current_payload = _preflight_payload()
    current_payload["metadata"].update(
        {
            "lifecycle": "CURRENT",
            "documentType": "CONTRACT_PDF",
            "document_type": "CONTRACT_PDF",
        }
    )
    for field in (
        "batch_manifest_id",
        "batch_entries_sha256",
        "release_revision",
    ):
        current_payload["metadata"].pop(field)
    current_payload["tags"] = ["contract"]
    created = client.post(
        "/api/v1/integrations/stratos-budget-upload/external-documents/upsert",
        json=current_payload,
        headers=_service_headers(),
    )
    assert created.status_code == 201, created.text
    assert created.json()["document"]["metadata"]["lifecycle"] == "CURRENT"

    archived_payload = _preflight_payload()
    archived_payload["tags"] = ["contract"]
    archived = client.post(
        "/api/v1/integrations/stratos-budget-upload/external-documents/upsert",
        json=archived_payload,
        headers=_service_headers(),
    )
    assert archived.status_code == 200, archived.text
    assert archived.json()["document"]["metadata"]["lifecycle"] == "ARCHIVED"

    reversed_lifecycle = client.post(
        "/api/v1/integrations/stratos-budget-upload/external-documents/upsert",
        json=current_payload,
        headers=_service_headers(),
    )
    assert reversed_lifecycle.status_code == 409, reversed_lifecycle.text
    assert (
        reversed_lifecycle.json()["error"]["code"]
        == "stratos_budget_upload_lifecycle_conflict"
    )


def test_budget_bridge_attaches_only_authoritative_ingestion_job(client) -> None:
    created, version_created = _create_document_and_version(client)
    document = created["document"]
    external = created["external_document"]
    version = version_created["version"]
    activated = client.patch(
        "/api/v1/integrations/stratos-budget-upload/external-documents/"
        f"{external['external_document_id']}/current",
        json={
            "document_id": document["document_id"],
            "expected_current_document_version_id": None,
            "expected_current_ingestion_job_id": None,
            "document_version_id": version["document_version_id"],
            "file_id": version["file_id"],
            "ingestion_job_id": "job-budget-123",
            "ingestion_status": "INGESTING",
            "external_ref": EXTERNAL_REF,
            "information_policy": _policy(),
            "integration_envelope": _envelope(),
            "governance_scope": {"type": "budget_scope", "id": FINANCIAL_SCOPE},
            "parent_governed_resource_id": PARENT_RESOURCE,
        },
        headers=_service_headers(),
    )
    assert activated.status_code == 200, activated.text
    current = activated.json()["external_document"]["external_document"]
    assert current["current_ingestion_job_id"] == "job-budget-123"
    assert current["current_ingestion_status"] == "INGESTING"

    premature_indexed = client.patch(
        "/api/v1/integrations/stratos-budget-upload/external-documents/"
        f"{external['external_document_id']}/current",
        json={
            "document_id": document["document_id"],
            "expected_current_document_version_id": None,
            "expected_current_ingestion_job_id": "job-budget-123",
            "document_version_id": version["document_version_id"],
            "file_id": version["file_id"],
            "ingestion_job_id": "job-budget-123",
            "ingestion_status": "INDEXED",
            "external_ref": EXTERNAL_REF,
            "information_policy": _policy(),
            "integration_envelope": _envelope(),
            "governance_scope": {"type": "budget_scope", "id": FINANCIAL_SCOPE},
            "parent_governed_resource_id": PARENT_RESOURCE,
        },
        headers=_service_headers(),
    )
    assert premature_indexed.status_code == 409
    assert premature_indexed.json()["error"]["code"] == "stratos_budget_ingestion_status_authority_conflict"

    stored_ref = client.get(
        f"/api/v1/integrations/stratos-budget-upload/documents/{document['document_id']}/status",
        headers=_service_headers(),
    )
    assert stored_ref.status_code == 200
    assert stored_ref.json()["ingestion_attempt"]["ingestion_status"] == "QUEUED"
    assert stored_ref.json()["items"][0]["current_ingestion_status"] == "INGESTING"
    assert (
        client.get(
            f"/api/v1/integrations/stratos-budget-upload/documents/{document['document_id']}/status",
            headers={
                **_service_headers(),
                "X-AKL-Service-Client-ID": "aiip-document-service",
                "X-AKL-Subject": "service-account-aiip-document-service",
                "X-AKL-Roles": "service_aiip_document",
            },
        ).status_code
        == 403
    )

    persisted = client.app  # keep the test client alive through ORM assertions above
    assert persisted is not None


def test_archived_batch_can_mint_only_exact_indexing_proof_without_budget_mutation(
    client, db_session
) -> None:
    created, version_created = _create_document_and_version(client)
    document = created["document"]
    external = created["external_document"]
    version = version_created["version"]
    idempotency_key = (
        f"confirm:{external['external_document_id']}:{version['document_version_id']}"
    )

    issued = client.post(
        "/api/v1/integrations/stratos-budget-upload/documents/"
        f"{document['document_id']}/versions/{version['document_version_id']}"
        "/ingestion-authorization",
        json={
            "action": "document.ingest",
            "correlation_id": "corr-budget-upload-123",
            "idempotency_key": idempotency_key,
        },
        headers=_service_headers(),
    )
    assert issued.status_code == 200, issued.text
    assert issued.json()["confirmed_subject_id"] == ACTOR
    assert issued.json()["document_id"] == document["document_id"]
    assert issued.json()["document_version_id"] == version["document_version_id"]
    assert issued.json()["idempotency_key"] == idempotency_key

    stored_external = db_session.get(
        ExternalDocumentRef, external["external_document_id"]
    )
    assert stored_external is not None
    assert stored_external.current_document_version_id is None
    assert stored_external.current_ingestion_job_id is None
    assert (
        db_session.query(IngestionAttempt)
        .filter(IngestionAttempt.document_id == document["document_id"])
        .one_or_none()
        is None
    )

    reindex = client.post(
        "/api/v1/integrations/stratos-budget-upload/documents/"
        f"{document['document_id']}/versions/{version['document_version_id']}"
        "/ingestion-authorization",
        json={
            "action": "document.reindex",
            "correlation_id": "corr-budget-upload-123",
            "idempotency_key": idempotency_key,
        },
        headers=_service_headers(),
    )
    assert reindex.status_code == 403
    assert (
        reindex.json()["error"]["code"]
        == "stratos_budget_historical_ingestion_forbidden"
    )

    arbitrary_key = client.post(
        "/api/v1/integrations/stratos-budget-upload/documents/"
        f"{document['document_id']}/versions/{version['document_version_id']}"
        "/ingestion-authorization",
        json={
            "action": "document.ingest",
            "correlation_id": "corr-budget-upload-123",
            "idempotency_key": "confirm:another-document:another-version",
        },
        headers=_service_headers(),
    )
    assert arbitrary_key.status_code == 403


def test_current_batch_can_mint_indexing_proof_but_invalid_lifecycle_cannot(
    client, db_session
) -> None:
    current_payload = _preflight_payload()
    current_payload["metadata"] = {
        **current_payload["metadata"],
        "contract_status": "ACTIVE",
        "lifecycle": "CURRENT",
        "documentType": "CONTRACT_PDF",
        "document_type": "CONTRACT_PDF",
    }
    created = client.post(
        "/api/v1/integrations/stratos-budget-upload/external-documents/upsert",
        json=current_payload,
        headers=_service_headers(),
    )
    assert created.status_code == 201, created.text
    version_payload = _version_payload()
    version_payload["contract_status"] = "ACTIVE"
    version_created = client.put(
        "/api/v1/integrations/stratos-budget-upload/documents/"
        f"{created.json()['document']['document_id']}/versions",
        json=version_payload,
        headers=_service_headers(),
    )
    assert version_created.status_code == 201, version_created.text
    document = created.json()["document"]
    external = created.json()["external_document"]
    version = version_created.json()["version"]
    idempotency_key = (
        f"confirm:{external['external_document_id']}:{version['document_version_id']}"
    )
    route = (
        "/api/v1/integrations/stratos-budget-upload/documents/"
        f"{document['document_id']}/versions/{version['document_version_id']}"
        "/ingestion-authorization"
    )
    request = {
        "action": "document.ingest",
        "correlation_id": "corr-budget-upload-123",
        "idempotency_key": idempotency_key,
    }
    issued = client.post(route, json=request, headers=_service_headers())
    assert issued.status_code == 200, issued.text

    stored_external = db_session.get(
        ExternalDocumentRef, external["external_document_id"]
    )
    assert stored_external is not None
    stored_external.document.document_metadata = {
        **stored_external.document.document_metadata,
        "lifecycle": "INVALID",
    }
    db_session.commit()
    denied = client.post(route, json=request, headers=_service_headers())
    assert denied.status_code == 403
    assert (
        denied.json()["error"]["code"]
        == "stratos_budget_historical_ingestion_forbidden"
    )


def test_new_service_only_version_clears_predecessor_ingestion_state(
    client,
) -> None:
    created, first_version_created = _create_document_and_version(client)
    document = created["document"]
    external = created["external_document"]
    first_version = first_version_created["version"]

    activated = client.patch(
        "/api/v1/integrations/stratos-budget-upload/external-documents/"
        f"{external['external_document_id']}/current",
        json={
            "document_id": document["document_id"],
            "expected_current_document_version_id": None,
            "expected_current_ingestion_job_id": None,
            "document_version_id": first_version["document_version_id"],
            "file_id": first_version["file_id"],
            "ingestion_job_id": "job-budget-v1",
            "ingestion_status": "INGESTING",
            "external_ref": EXTERNAL_REF,
            "information_policy": _policy(),
            "integration_envelope": _envelope(),
            "governance_scope": {"type": "budget_scope", "id": FINANCIAL_SCOPE},
            "parent_governed_resource_id": PARENT_RESOURCE,
        },
        headers=_service_headers(),
    )
    assert activated.status_code == 200, activated.text

    second_preflight = client.post(
        "/api/v1/integrations/stratos-budget-upload/external-documents/upsert",
        json=_preflight_payload(FILE_HASH_2, "smlouva-v2.pdf"),
        headers=_service_headers(),
    )
    assert second_preflight.status_code == 200, second_preflight.text
    assert second_preflight.json()["created"] is False
    assert (
        second_preflight.json()["document"]["document_id"]
        == document["document_id"]
    )

    second_payload = _version_payload(FILE_HASH_2)
    second_payload["version_label"] = "contract-file-v2"
    second_version_created = client.put(
        "/api/v1/integrations/stratos-budget-upload/documents/"
        f"{document['document_id']}/versions",
        json=second_payload,
        headers=_service_headers(),
    )
    assert second_version_created.status_code == 201, second_version_created.text
    second_version = second_version_created.json()["version"]
    assert (
        second_version["source_location"]["stratos_budget_upload"]
        ["integration_envelope"]["payload"]["fileHash"]
        == FILE_HASH_2
    )

    stale_job = client.patch(
        "/api/v1/integrations/stratos-budget-upload/external-documents/"
        f"{external['external_document_id']}/current",
        json={
            "document_id": document["document_id"],
            "expected_current_document_version_id": first_version["document_version_id"],
            "expected_current_ingestion_job_id": None,
            "document_version_id": second_version["document_version_id"],
            "file_id": second_version["file_id"],
            "ingestion_job_id": None,
            "ingestion_status": "VERSION_CREATED",
            "external_ref": EXTERNAL_REF,
            "information_policy": _policy(),
            "integration_envelope": _envelope(FILE_HASH_2),
            "governance_scope": {"type": "budget_scope", "id": FINANCIAL_SCOPE},
            "parent_governed_resource_id": PARENT_RESOURCE,
        },
        headers=_service_headers(),
    )
    assert stale_job.status_code == 409, stale_job.text
    assert stale_job.json()["error"]["code"] == "stratos_budget_upload_current_job_cas_conflict"

    reconciled = client.patch(
        "/api/v1/integrations/stratos-budget-upload/external-documents/"
        f"{external['external_document_id']}/current",
        json={
            "document_id": document["document_id"],
            "expected_current_document_version_id": first_version["document_version_id"],
            "expected_current_ingestion_job_id": "job-budget-v1",
            "document_version_id": second_version["document_version_id"],
            "file_id": second_version["file_id"],
            "ingestion_job_id": None,
            "ingestion_status": "VERSION_CREATED",
            "external_ref": EXTERNAL_REF,
            "information_policy": _policy(),
            "integration_envelope": _envelope(FILE_HASH_2),
            "governance_scope": {"type": "budget_scope", "id": FINANCIAL_SCOPE},
            "parent_governed_resource_id": PARENT_RESOURCE,
        },
        headers=_service_headers(),
    )
    assert reconciled.status_code == 200, reconciled.text
    current = reconciled.json()["external_document"]["external_document"]
    assert current["current_document_version_id"] == second_version["document_version_id"]
    assert current["current_file_id"] == second_version["file_id"]
    assert current["current_ingestion_job_id"] is None
    assert current["current_ingestion_status"] == "VERSION_CREATED"

    projected = client.get(
        f"/api/v1/integrations/stratos-budget-upload/documents/{document['document_id']}/status",
        headers=_service_headers(),
    )
    assert projected.status_code == 200, projected.text
    assert projected.json()["ingestion_attempt"] is None
