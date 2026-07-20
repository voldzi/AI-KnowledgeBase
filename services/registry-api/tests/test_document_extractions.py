from __future__ import annotations

from app.information_policy import InformationPolicyBinding, canonical_policy_hash


def _external_payload(**overrides):
    payload = {
        "tenant_id": "tenant-a",
        "external_system": "STRATOS_PROJECTFLOW",
        "external_ref": "contract:256-2022-S:main",
        "entity_type": "Contract",
        "entity_id": "contract-uuid",
        "document_type": "contract",
        "title": "Smlouva 256-2022-S",
        "classification": "internal",
        "owner": {"user_id": "user_owner"},
    }
    payload.update(overrides)
    return payload


def _document_with_version(client, admin_headers, *, tenant_id="tenant-a", version_label="1.0"):
    created = client.post(
        "/api/v1/external-documents/upsert",
        headers=admin_headers,
        json=_external_payload(tenant_id=tenant_id),
    )
    assert created.status_code == 200, created.text
    document_id = created.json()["document"]["document_id"]
    version = client.post(
        f"/api/v1/documents/{document_id}/versions",
        headers=admin_headers,
        json={
            "version_label": version_label,
            "source_file_uri": f"s3://akl-documents/contracts/{version_label}.pdf",
            "file_hash": "sha256:" + "a" * 64,
        },
    )
    assert version.status_code == 201, version.text
    return document_id, version.json()["document_version_id"]


def _extraction_payload(document_id: str, document_version_id: str, **overrides):
    payload = {
        "tenant_id": "tenant-a",
        "external_system": "STRATOS_PROJECTFLOW",
        "external_ref": "contract:256-2022-S:main",
        "entity_type": "Contract",
        "entity_id": "contract-uuid",
        "document_id": document_id,
        "document_version_id": document_version_id,
        "profile": "contract_financial_v1",
        "profile_version": "1",
        "status": "PROPOSED",
        "classification": "internal",
        "requested_by": "budget-user",
        "result": {
            "proposals": [
                {
                    "field": "contract_number",
                    "proposed_value": "256-2022-S",
                    "citation": {"document_id": document_id, "document_version_id": document_version_id},
                }
            ],
            "source_chunk_ids": ["chunk_contract_1"],
        },
        "missing_information": [],
        "warnings": [],
    }
    payload.update(overrides)
    return payload


def test_document_extraction_store_is_idempotent_for_same_version(client, admin_headers):
    document_id, version_id = _document_with_version(client, admin_headers)

    first = client.post(
        "/api/v1/document-extractions",
        headers=admin_headers,
        json=_extraction_payload(document_id, version_id),
    )
    second = client.post(
        "/api/v1/document-extractions",
        headers=admin_headers,
        json=_extraction_payload(document_id, version_id, warnings=["SHOULD_NOT_REPLACE"]),
    )

    assert first.status_code == 201, first.text
    assert second.status_code == 200, second.text
    assert second.json()["created"] is False
    assert second.json()["extraction"]["extraction_id"] == first.json()["extraction"]["extraction_id"]
    assert second.json()["extraction"]["warnings"] == []


def test_document_extraction_supersedes_previous_version(client, admin_headers):
    document_id, version_one = _document_with_version(client, admin_headers, version_label="1.0")
    version_two = client.post(
        f"/api/v1/documents/{document_id}/versions",
        headers=admin_headers,
        json={
            "version_label": "2.0",
            "source_file_uri": "s3://akl-documents/contracts/2.0.pdf",
            "file_hash": "sha256:" + "b" * 64,
        },
    )
    assert version_two.status_code == 201, version_two.text

    first = client.post(
        "/api/v1/document-extractions",
        headers=admin_headers,
        json=_extraction_payload(document_id, version_one),
    )
    second = client.post(
        "/api/v1/document-extractions",
        headers=admin_headers,
        json=_extraction_payload(document_id, version_two.json()["document_version_id"]),
    )
    fetched_first = client.get(
        f"/api/v1/document-extractions/{first.json()['extraction']['extraction_id']}",
        headers=admin_headers,
    )

    assert second.status_code == 201, second.text
    assert fetched_first.status_code == 200, fetched_first.text
    assert fetched_first.json()["status"] == "SUPERSEDED"


def test_document_extraction_tenant_is_part_of_identity(client, admin_headers):
    doc_a, ver_a = _document_with_version(client, admin_headers, tenant_id="tenant-a")
    doc_b, ver_b = _document_with_version(
        client,
        admin_headers,
        tenant_id="tenant-b",
        version_label="tenant-b-1.0",
    )

    first = client.post(
        "/api/v1/document-extractions",
        headers=admin_headers,
        json=_extraction_payload(doc_a, ver_a, tenant_id="tenant-a"),
    )
    second = client.post(
        "/api/v1/document-extractions",
        headers=admin_headers,
        json=_extraction_payload(doc_b, ver_b, tenant_id="tenant-b"),
    )

    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert first.json()["extraction"]["extraction_id"] != second.json()["extraction"]["extraction_id"]


def test_document_extraction_feedback_updates_status(client, admin_headers):
    document_id, version_id = _document_with_version(client, admin_headers)
    stored = client.post(
        "/api/v1/document-extractions",
        headers=admin_headers,
        json=_extraction_payload(document_id, version_id),
    )
    extraction_id = stored.json()["extraction"]["extraction_id"]

    feedback = client.post(
        f"/api/v1/document-extractions/{extraction_id}/feedback",
        headers=admin_headers,
        json={
            "field": "contract_number",
            "ai_value": "256-2022-S",
            "final_value": "256-2022-S",
            "decision": "accepted",
            "reason": "Matches Budget value",
            "actor": "budget-approver",
            "source_app": "STRATOS_PROJECTFLOW",
            "source_entity_id": "contract-uuid",
            "correlation_id": "corr-budget-feedback",
        },
    )

    assert feedback.status_code == 201, feedback.text
    assert feedback.json()["feedback"]["decision"] == "accepted"
    assert feedback.json()["extraction"]["status"] == "ACCEPTED_IN_SOURCE_APP"


def test_document_extraction_feedback_rejected_updates_status(client, admin_headers):
    document_id, version_id = _document_with_version(client, admin_headers)
    stored = client.post(
        "/api/v1/document-extractions",
        headers=admin_headers,
        json=_extraction_payload(document_id, version_id),
    )
    extraction_id = stored.json()["extraction"]["extraction_id"]

    feedback = client.post(
        f"/api/v1/document-extractions/{extraction_id}/feedback",
        headers=admin_headers,
        json={
            "field": "contract_number",
            "ai_value": "256-2022-S",
            "final_value": None,
            "decision": "rejected",
            "reason": "Wrong source contract",
            "actor": "budget-approver",
            "source_app": "STRATOS_PROJECTFLOW",
            "source_entity_id": "contract-uuid",
        },
    )

    assert feedback.status_code == 201, feedback.text
    assert feedback.json()["feedback"]["decision"] == "rejected"
    assert feedback.json()["extraction"]["status"] == "REJECTED_IN_SOURCE_APP"


def test_document_extraction_feedback_edited_updates_status(client, admin_headers):
    document_id, version_id = _document_with_version(client, admin_headers)
    stored = client.post(
        "/api/v1/document-extractions",
        headers=admin_headers,
        json=_extraction_payload(document_id, version_id),
    )
    extraction_id = stored.json()["extraction"]["extraction_id"]

    feedback = client.post(
        f"/api/v1/document-extractions/{extraction_id}/feedback",
        headers=admin_headers,
        json={
            "field": "contract_number",
            "ai_value": "256-2022-S",
            "final_value": "256/2022/S",
            "decision": "edited",
            "reason": "Budget canonical format",
            "actor": "budget-approver",
            "source_app": "STRATOS_PROJECTFLOW",
            "source_entity_id": "contract-uuid",
        },
    )

    assert feedback.status_code == 201, feedback.text
    assert feedback.json()["feedback"]["decision"] == "edited"
    assert feedback.json()["extraction"]["status"] == "ACCEPTED_IN_SOURCE_APP"


def test_document_extraction_feedback_rejects_wrong_source_app(client, admin_headers):
    document_id, version_id = _document_with_version(client, admin_headers)
    stored = client.post(
        "/api/v1/document-extractions",
        headers=admin_headers,
        json=_extraction_payload(document_id, version_id),
    )

    feedback = client.post(
        f"/api/v1/document-extractions/{stored.json()['extraction']['extraction_id']}/feedback",
        headers=admin_headers,
        json={
            "field": "contract_number",
            "ai_value": "256-2022-S",
            "final_value": "256-2022-S",
            "decision": "rejected",
            "actor": "budget-approver",
            "source_app": "STRATOS_ARCHFLOW",
            "source_entity_id": "contract-uuid",
        },
    )

    assert feedback.status_code == 409


def test_budget_contract_extraction_and_feedback_use_dedicated_bridge(client, admin_headers):
    actor = "budget-owner-extraction"
    contract_id = "contract-extraction-123"
    external_ref = f"contract:{contract_id}:document:signed"
    financial_scope = "budget:section-it"
    file_hash = f"sha256:{'e' * 64}"
    policy = {
        "schemaVersion": "stratos-information-policy-2",
        "policyBindingId": "pb_budget_extract_12345678",
        "policyVersion": "information-policy-2.0.0",
        "handlingClass": "INTERNAL",
        "legalClassification": "NONE",
        "tlp": "TLP:GREEN",
        "pap": None,
        "contentCategories": ["CONTRACTUAL", "FINANCIAL"],
        "audience": {
            "organizationId": "org_stratos",
            "scopeType": "budget_scope",
            "scopeIds": [financial_scope],
            "recipientSubjectIds": [],
        },
        "obligations": ["AUDIT_ACCESS"],
        "originatorId": actor,
        "issuedAt": "2026-07-20T00:00:00Z",
        "reviewAt": None,
    }
    binding = InformationPolicyBinding.model_validate(policy)
    envelope = {
        "schemaVersion": "stratos-integration-envelope-1",
        "organizationId": "org_stratos",
        "sourceSystem": "STRATOS_BUDGET",
        "externalRef": external_ref,
        "actor": {"type": "person", "subjectId": actor},
        "correlationId": "corr-budget-extraction-123",
        "idempotencyKey": "idem-budget-extraction-123",
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
            "contractId": contract_id,
            "financialScopeKey": financial_scope,
            "fileHash": file_hash,
        },
    }
    service_headers = {
        "Authorization": "Bearer budget-extraction-transport",
        "X-AKL-Subject": "service-account-stratos-akb-service",
        "X-AKL-Service-Client-ID": "stratos-akb-service",
        "X-AKL-Roles": "service_ingestion",
        "X-Correlation-ID": "corr-budget-extraction-123",
    }
    created = client.post(
        "/api/v1/integrations/stratos-budget-upload/external-documents/upsert",
        headers=service_headers,
        json={
            "tenant_id": "org_stratos",
            "external_system": "STRATOS_BUDGET",
            "external_ref": external_ref,
            "entity_type": "Contract",
            "entity_id": contract_id,
            "document_type": "contract",
            "title": "Historická smlouva s měsíčními platbami",
            "classification": "internal",
            "information_policy": policy,
            "integration_envelope": envelope,
            "owner": {"user_id": actor, "display_name": "Ředitel IT"},
            "tags": ["contract", "historical-import"],
            "metadata": {
                "contract_id": contract_id,
                "contract_number": "S-2023-042",
                "contract_name": "Podpora informačního systému",
                "financial_scope_key": financial_scope,
                "lifecycle": "ARCHIVED",
                "contract_status": "EXPIRED",
                "contract_start_date": "2023-01-01",
                "contract_end_date": "2025-12-31",
                "documentType": "CONTRACT_ARCHIVE",
                "document_type": "CONTRACT_ARCHIVE",
                "batch_manifest_id": "historical-contracts-2026-07-20",
                "batch_entries_sha256": f"sha256:{'f' * 64}",
                "release_revision": "a" * 40,
            },
            "source_location": {
                "kind": "uploaded_file",
                "file_name": "smlouva-2023-042.pdf",
                "content_type": "application/pdf",
                "sha256": file_hash,
                "repository": "Budget & Contract",
                "path": external_ref,
                "version": file_hash,
            },
            "governance_scope": {"type": "budget_scope", "id": financial_scope},
            "parent_governed_resource_id": "gres-budget-contract-extraction",
        },
    )
    assert created.status_code == 201, created.text
    document_id = created.json()["document"]["document_id"]
    version = client.put(
        f"/api/v1/integrations/stratos-budget-upload/documents/{document_id}/versions",
        headers=service_headers,
        json={
            "external_ref": external_ref,
            "version_label": "contract-file-v1",
            "valid_from": "2023-01-01",
            "valid_to": "2024-12-31",
            "source_file_uri": "s3://akl-documents/budget/smlouva-2023-042.pdf",
            "source_location": {
                "kind": "object_storage",
                "uri": "s3://akl-documents/budget/smlouva-2023-042.pdf",
                "file_name": "smlouva-2023-042.pdf",
                "content_type": "application/pdf",
                "sha256": file_hash,
                "repository": "Budget & Contract",
                "path": external_ref,
                "version": file_hash,
            },
            "file_hash": file_hash,
            "change_summary": "Historická archivní verze",
            "upload_mode": "historical_batch",
            "original_file_name": "smlouva-2023-042.pdf",
            "batch_lineage": {
                "batch_manifest_id": "historical-contracts-2026-07-20",
                "batch_entries_sha256": f"sha256:{'f' * 64}",
                "release_revision": "a" * 40,
            },
            "contract_status": "EXPIRED",
            "contract_start_date": "2023-01-01",
            "contract_end_date": "2025-12-31",
            "information_policy": policy,
            "integration_envelope": envelope,
            "governance_scope": {"type": "budget_scope", "id": financial_scope},
            "parent_governed_resource_id": "gres-budget-contract-extraction",
            "file": {
                "filename": "smlouva-2023-042.pdf",
                "mime_type": "application/pdf",
                "size_bytes": 2048,
                "sha256": file_hash,
            },
        },
    )
    assert version.status_code == 201, version.text
    version_id = version.json()["version"]["document_version_id"]

    extraction_payload = {
        "tenant_id": "org_stratos",
        "external_system": "STRATOS_BUDGET",
        "external_ref": external_ref,
        "entity_type": "Contract",
        "entity_id": contract_id,
        "document_id": document_id,
        "document_version_id": version_id,
        "profile": "contract_financial_v1",
        "profile_version": "1",
        "status": "PROPOSED",
        "classification": "internal",
        "requested_by": actor,
        "result": {
            "proposals": [
                {
                    "field": "payment_frequency",
                    "proposed_value": "MONTHLY",
                    "citation": {
                        "document_id": document_id,
                        "document_version_id": version_id,
                    },
                },
                {
                    "field": "annual_expense",
                    "proposed_value": "1200000",
                    "citation": {
                        "document_id": document_id,
                        "document_version_id": version_id,
                    },
                },
            ],
            "source_chunk_ids": ["chunk_budget_payment_terms_1"],
        },
        "missing_information": [],
        "warnings": [],
    }
    stored = client.post(
        "/api/v1/document-extractions",
        headers=admin_headers,
        json=extraction_payload,
    )
    replayed = client.post(
        "/api/v1/document-extractions",
        headers=admin_headers,
        json=extraction_payload,
    )
    assert stored.status_code == 201, stored.text
    assert replayed.status_code == 200, replayed.text
    assert replayed.json()["created"] is False

    extraction_id = stored.json()["extraction"]["extraction_id"]
    feedback = client.post(
        f"/api/v1/document-extractions/{extraction_id}/feedback",
        headers=admin_headers,
        json={
            "field": "annual_expense",
            "ai_value": "1200000",
            "final_value": "1200000",
            "decision": "accepted",
            "reason": "Součet dvanácti měsíčních plateb odpovídá smlouvě.",
            "actor": "budget-approver",
            "source_app": "STRATOS_BUDGET",
            "source_entity_id": contract_id,
            "correlation_id": "corr-budget-extraction-feedback",
        },
    )
    assert feedback.status_code == 201, feedback.text
    assert feedback.json()["feedback"]["decision"] == "accepted"
    assert feedback.json()["extraction"]["status"] == "ACCEPTED_IN_SOURCE_APP"
