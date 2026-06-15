from __future__ import annotations


def _external_payload(**overrides):
    payload = {
        "tenant_id": "tenant-a",
        "external_system": "STRATOS_BUDGET",
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
        "external_system": "STRATOS_BUDGET",
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
            "source_app": "STRATOS_BUDGET",
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
            "source_app": "STRATOS_BUDGET",
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
            "source_app": "STRATOS_BUDGET",
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
            "source_app": "STRATOS_PROJECTFLOW",
            "source_entity_id": "contract-uuid",
        },
    )

    assert feedback.status_code == 409
