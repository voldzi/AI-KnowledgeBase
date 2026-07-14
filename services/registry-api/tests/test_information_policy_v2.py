from __future__ import annotations

from app.information_policy import (
    InformationPolicyBinding,
    anonymous_public_eligible,
    canonical_policy_hash,
)
from app.models import Document, DocumentVersion


def policy(
    *,
    binding_id: str = "pol_testbinding01",
    scope_type: str = "organization",
    scope_ids: list[str] | None = None,
) -> dict:
    return {
        "schemaVersion": "stratos-information-policy-2",
        "policyBindingId": binding_id,
        "policyVersion": "information-policy-2.0.0",
        "handlingClass": "INTERNAL",
        "legalClassification": "NONE",
        "tlp": None,
        "pap": None,
        "contentCategories": ["CONTRACTUAL"],
        "audience": {
            "organizationId": "org_stratos",
            "scopeType": scope_type,
            "scopeIds": scope_ids or [],
            "recipientSubjectIds": [],
        },
        "obligations": ["AUDIT_ACCESS", "NO_EXTERNAL_AI"],
        "originatorId": "user_owner",
        "issuedAt": "2026-07-12T10:00:00Z",
        "reviewAt": None,
    }


def v2_headers(*, subject: str, capabilities: str, scopes: str = "organization") -> dict[str, str]:
    return {
        "X-AKL-Subject": subject,
        "X-AKL-Roles": "stratos_user",
        "X-STRATOS-Capabilities": capabilities,
        "X-STRATOS-Scopes": scopes,
        "X-STRATOS-Organization-ID": "org_stratos",
    }


def create_document(client, *, information_policy: dict | None = None):
    return client.post(
        "/api/v1/documents",
        headers=v2_headers(subject="user_owner", capabilities="akb:upload,akb:manage_document"),
        json={
            "title": "Policy V2 test",
            "document_type": "contract",
            "owner_id": "user_owner",
            "gestor_unit": "finance",
            "classification": "internal",
            "tags": ["policy-v2"],
            "information_policy": information_policy,
        },
    )


def test_policy_binding_id_accepts_registry_and_central_namespaces() -> None:
    assert InformationPolicyBinding.model_validate(policy(binding_id="pol_registrybinding01")).policy_binding_id == "pol_registrybinding01"
    assert InformationPolicyBinding.model_validate(policy(binding_id="pb_budget_projectflow_12345678")).policy_binding_id == "pb_budget_projectflow_12345678"



def test_v2_document_and_version_store_immutable_policy_snapshot(client) -> None:
    binding = policy()
    created = create_document(client, information_policy=binding)
    assert created.status_code == 201, created.text
    document = created.json()
    expected_hash = canonical_policy_hash(InformationPolicyBinding.model_validate(binding))
    assert document["organization_id"] == "org_stratos"
    assert document["policy_binding_id"] == binding["policyBindingId"]
    assert document["policy_version"] == "information-policy-2.0.0"
    assert document["policy_hash"] == expected_hash
    assert document["classification"] == "internal"

    version = client.post(
        f"/api/v1/documents/{document['document_id']}/versions",
        headers=v2_headers(subject="user_owner", capabilities="akb:upload", scopes="organization"),
        json={
            "version_label": "1.0",
            "source_file_uri": "s3://akl-documents/policy-v2/test.pdf",
            "file_hash": f"sha256:{'a' * 64}",
        },
    )
    assert version.status_code == 201, version.text
    assert version.json()["policy_hash"] == expected_hash
    assert version.json()["policy_summary"] == document["policy_summary"]


def test_v2_upload_requires_policy_binding(client) -> None:
    response = create_document(client, information_policy=None)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "policy_unavailable"


def test_classified_and_unknown_obligation_are_rejected_before_create(client) -> None:
    classified = policy()
    classified["legalClassification"] = "D"
    response = create_document(client, information_policy=classified)
    assert response.status_code == 422

    unknown = policy()
    unknown["obligations"] = ["SEND_ANYWHERE"]
    response = create_document(client, information_policy=unknown)
    assert response.status_code == 422


def test_capability_and_scope_are_both_required(client) -> None:
    created = create_document(client, information_policy=policy()).json()
    document_id = created["document_id"]

    missing_capability = client.get(
        f"/api/v1/documents/{document_id}",
        headers=v2_headers(subject="user_reader", capabilities="akb:access"),
    )
    assert missing_capability.status_code == 403
    assert "CAPABILITY_MISSING" in missing_capability.json()["error"]["details"]["reason_codes"]

    wrong_scope = client.get(
        f"/api/v1/documents/{document_id}",
        headers=v2_headers(subject="user_reader", capabilities="akb:read_document", scopes="project:other"),
    )
    assert wrong_scope.status_code == 403
    assert "SCOPE_MISMATCH" in wrong_scope.json()["error"]["details"]["reason_codes"]


def test_financial_area_scope_isolates_it_from_logistics(client, db_session) -> None:
    created = create_document(
        client,
        information_policy=policy(scope_type="organization_unit", scope_ids=["it"]),
    )
    assert created.status_code == 201, created.text
    document_id = created.json()["document_id"]

    logistics = client.get(
        f"/api/v1/documents/{document_id}",
        headers=v2_headers(
            subject="user-logistics",
            capabilities="akb:read_document",
            scopes="organization_unit:logistics",
        ),
    )
    it = client.get(
        f"/api/v1/documents/{document_id}",
        headers=v2_headers(
            subject="user-it",
            capabilities="akb:read_document",
            scopes="organization_unit:it",
        ),
    )

    assert logistics.status_code == 403
    assert "SCOPE_MISMATCH" in logistics.json()["error"]["details"]["reason_codes"]
    assert it.status_code == 200

    version_response = client.post(
        f"/api/v1/documents/{document_id}/versions",
        headers=v2_headers(
            subject="user_owner",
            capabilities="akb:upload,akb:manage_document",
            scopes="organization,organization_unit:it",
        ),
        json={
            "version_label": "1.0",
            "source_file_uri": "s3://akl-documents/it/restricted-budget.pdf",
            "file_hash": f"sha256:{'e' * 64}",
        },
    )
    assert version_response.status_code == 201, version_response.text
    version_id = version_response.json()["document_version_id"]
    stored_document = db_session.get(Document, document_id)
    stored_version = db_session.get(DocumentVersion, version_id)
    stored_document.status = "valid"
    stored_version.status = "valid"
    db_session.commit()

    public_default = client.post(
        "/api/v1/authz/filter-documents",
        headers=v2_headers(
            subject="user-logistics-default",
            capabilities="akb:chat",
            scopes="public",
        ),
        json={
            "subject_id": "user-logistics-default",
            "action": "rag.query",
            "candidate_document_ids": [document_id],
            "candidate_policy_hashes": {document_id: [created.json()["policy_hash"]]},
            "candidate_document_versions": {document_id: [version_id]},
        },
    )
    assert public_default.status_code == 200, public_default.text
    assert public_default.json()["allowed_document_ids"] == []
    assert public_default.json()["denied_document_ids"] == [document_id]


def test_central_organization_scope_with_id_allows_document_version(client) -> None:
    document = create_document(client, information_policy=policy()).json()

    response = client.post(
        f"/api/v1/documents/{document['document_id']}/versions",
        headers=v2_headers(
            subject="user_owner",
            capabilities="akb:upload,akb:manage_document",
            scopes="organization:org_stratos",
        ),
        json={
            "version_label": "1.0",
            "source_file_uri": "s3://akl-documents/policy-v2/central-scope.pdf",
            "file_hash": f"sha256:{'c' * 64}",
        },
    )

    assert response.status_code == 201, response.text


def test_tlp_red_requires_explicit_recipient(client) -> None:
    binding = policy(scope_type="recipient_set")
    binding.update({"tlp": "TLP:RED", "originatorId": "originator"})
    binding["audience"]["recipientSubjectIds"] = ["user_recipient"]
    created = create_document(client, information_policy=binding)
    assert created.status_code == 201, created.text
    document_id = created.json()["document_id"]

    denied = client.get(
        f"/api/v1/documents/{document_id}",
        headers=v2_headers(subject="user_other", capabilities="akb:read_document"),
    )
    assert denied.status_code == 403

    allowed = client.get(
        f"/api/v1/documents/{document_id}",
        headers=v2_headers(
            subject="user_recipient",
            capabilities="akb:read_document",
            scopes="organization",
        ),
    )
    assert allowed.status_code == 200


def test_own_governed_scope_is_immutable_and_bound_to_canonical_owner(client) -> None:
    binding = policy(scope_type="recipient_set")
    binding["audience"]["recipientSubjectIds"] = ["user_owner"]
    created = client.post(
        "/api/v1/documents",
        headers=v2_headers(
            subject="user_owner",
            capabilities="akb:upload,akb:manage_document,akb:read_document",
            scopes="own",
        ),
        json={
            "title": "Private owner document",
            "document_type": "contract",
            "owner_id": "user_owner",
            "classification": "internal",
            "information_policy": binding,
            "governance_scope": {
                "type": "own",
                "ownerSubjectId": "user_owner",
            },
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["governance_scope_type"] == "own"
    assert body["governance_scope_id"] is None
    assert body["governance_scope_owner_subject_id"] == "user_owner"

    owner = client.get(
        f"/api/v1/documents/{body['document_id']}",
        headers=v2_headers(
            subject="user_owner",
            capabilities="akb:read_document",
            scopes="own",
        ),
    )
    assert owner.status_code == 200, owner.text

    other_own = client.get(
        f"/api/v1/documents/{body['document_id']}",
        headers=v2_headers(
            subject="user_other",
            capabilities="akb:read_document",
            scopes="own",
        ),
    )
    organization_admin = client.get(
        f"/api/v1/documents/{body['document_id']}",
        headers=v2_headers(
            subject="user_admin",
            capabilities="akb:read_document",
            scopes="organization",
        ),
    )
    assert other_own.status_code == 403
    assert organization_admin.status_code == 403

    version = client.post(
        f"/api/v1/documents/{body['document_id']}/versions",
        headers=v2_headers(
            subject="user_owner",
            capabilities="akb:upload,akb:manage_document",
            scopes="own",
        ),
        json={
            "version_label": "1.0",
            "source_file_uri": "s3://akl-documents/private/owner.pdf",
            "file_hash": f"sha256:{'f' * 64}",
        },
    )
    assert version.status_code == 201, version.text
    assert version.json()["governance_scope_type"] == "own"
    assert version.json()["governance_scope_owner_subject_id"] == "user_owner"


def test_own_governed_scope_rejects_forged_owner(client) -> None:
    binding = policy(scope_type="recipient_set")
    binding["audience"]["recipientSubjectIds"] = ["user_victim"]
    response = client.post(
        "/api/v1/documents",
        headers=v2_headers(
            subject="user_attacker",
            capabilities="akb:upload,akb:manage_document",
            scopes="own",
        ),
        json={
            "title": "Forged private document",
            "document_type": "contract",
            "owner_id": "user_attacker",
            "classification": "internal",
            "information_policy": binding,
            "governance_scope": {
                "type": "own",
                "ownerSubjectId": "user_victim",
            },
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "governance_scope_owner_mismatch"


def test_stale_or_revoked_vector_version_is_filtered(client, db_session) -> None:
    document = create_document(client, information_policy=policy()).json()
    version_response = client.post(
        f"/api/v1/documents/{document['document_id']}/versions",
        headers=v2_headers(
            subject="user_owner",
            capabilities="akb:upload,akb:manage_document",
        ),
        json={
            "version_label": "1.0",
            "source_file_uri": "s3://akl-documents/policy-v2/vector.pdf",
            "file_hash": f"sha256:{'d' * 64}",
        },
    )
    assert version_response.status_code == 201, version_response.text
    version_id = version_response.json()["document_version_id"]
    stored_document = db_session.get(Document, document["document_id"])
    stored_version = db_session.get(DocumentVersion, version_id)
    stored_document.status = "valid"
    stored_version.status = "valid"
    db_session.commit()
    headers = v2_headers(subject="user_reader", capabilities="akb:chat")
    stale = client.post(
        "/api/v1/authz/filter-documents",
        headers=headers,
        json={
            "subject_id": "user_reader",
            "action": "rag.query",
            "candidate_document_ids": [document["document_id"]],
            "candidate_policy_hashes": {document["document_id"]: [f"sha256:{'b' * 64}"]},
            "candidate_document_versions": {document["document_id"]: [version_id]},
        },
    )
    assert stale.status_code == 200
    assert stale.json()["allowed_document_ids"] == []
    assert stale.json()["denied_document_ids"] == [document["document_id"]]

    allowed = client.post(
        "/api/v1/authz/filter-documents",
        headers=headers,
        json={
            "subject_id": "user_reader",
            "action": "rag.query",
            "candidate_document_ids": [document["document_id"]],
            "candidate_policy_hashes": {document["document_id"]: [document["policy_hash"]]},
            "candidate_document_versions": {document["document_id"]: [version_id]},
        },
    )
    assert allowed.json()["allowed_document_ids"] == [document["document_id"]]

    stored_version.status = "archived"
    db_session.commit()
    revoked = client.post(
        "/api/v1/authz/filter-documents",
        headers=headers,
        json={
            "subject_id": "user_reader",
            "action": "rag.query",
            "candidate_document_ids": [document["document_id"]],
            "candidate_policy_hashes": {document["document_id"]: [document["policy_hash"]]},
            "candidate_document_versions": {document["document_id"]: [version_id]},
        },
    )
    assert revoked.json()["allowed_document_ids"] == []
    assert revoked.json()["denied_document_ids"] == [document["document_id"]]


def test_stratos_admin_without_akb_capability_cannot_read_content(client) -> None:
    document = create_document(client, information_policy=policy()).json()
    response = client.get(
        f"/api/v1/documents/{document['document_id']}",
        headers={
            "X-AKL-Subject": "global_admin",
            "X-AKL-Roles": "stratos_admin",
            "X-STRATOS-Scopes": "organization",
        },
    )
    assert response.status_code == 403
    assert "CAPABILITY_MISSING" in response.json()["error"]["details"]["reason_codes"]


def test_organization_audience_is_never_anonymous_true_public() -> None:
    organization_policy = policy()
    organization_policy["handlingClass"] = "PUBLIC"
    organization_policy["contentCategories"] = ["PUBLIC_INFORMATION"]
    organization_binding = InformationPolicyBinding.model_validate(organization_policy)

    public_policy = policy(scope_type="public")
    public_policy["handlingClass"] = "PUBLIC"
    public_policy["contentCategories"] = ["PUBLIC_INFORMATION"]
    public_policy["tlp"] = "TLP:CLEAR"
    public_policy["pap"] = "PAP:CLEAR"
    public_policy["obligations"] = ["AUDIT_ACCESS"]
    public_binding = InformationPolicyBinding.model_validate(public_policy)

    assert anonymous_public_eligible(organization_binding) is False
    assert anonymous_public_eligible(public_binding) is True
