import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app import api
from app.auth import Principal
from app.database import Base
from app.document_admission import EXPLICIT_DOCUMENT_TLP_VALUES, require_document_admission_policy
from app.information_policy import InformationPolicyBinding, canonical_policy_hash
from app.models import Document, DocumentVersion
from app.permissions import context_for_principal, evaluate_document_access, evaluate_runtime_document_access
from app.schemas import Action
from document_policy_fixtures import admitted_policy
from document_profile_fixtures import profiled_document_request, profiled_version_request, verified_profile_authority
pytestmark = pytest.mark.usefixtures("verified_profile_authority")
from test_stratos_budget_upload_bridge import _preflight_payload, _service_headers


def document_request(policy=None):
    return profiled_document_request({
        "title": "Explicitly classified document", "document_type": "manual",
        "owner_id": "user_owner", "information_policy": policy if policy is not None else admitted_policy(),
    })


def snapshot(db):
    return {table.name: repr(db.execute(select(table)).all()) for table in Base.metadata.sorted_tables}


@pytest.mark.parametrize("tlp", sorted(EXPLICIT_DOCUMENT_TLP_VALUES))
def test_accepts_each_explicit_tlp_without_changing_policy_hash(client, admin_headers, tlp):
    binding = admitted_policy(tlp=tlp)
    expected = canonical_policy_hash(InformationPolicyBinding.model_validate(binding))
    response = client.post("/api/v1/documents", json=document_request(binding), headers=admin_headers)
    assert response.status_code == 201, response.text
    assert response.json()["policy_summary"]["tlp"] == tlp
    assert response.json()["policy_hash"] == expected


@pytest.mark.parametrize("mode", ["missing", "null", "empty", "unknown"])
def test_admin_cannot_admit_a_document_without_explicit_tlp(client, db_session, admin_headers, mode):
    binding = admitted_policy()
    if mode == "missing":
        binding.pop("tlp")
    else:
        binding["tlp"] = {"null": None, "empty": "", "unknown": "TLP:BLUE"}[mode]
    before = snapshot(db_session)
    response = client.post("/api/v1/documents", json=document_request(binding), headers=admin_headers)
    assert response.status_code == 422, response.text
    assert snapshot(db_session) == before


def test_shared_policy_still_parses_null_but_document_admission_never_approves_it():
    binding = InformationPolicyBinding.model_validate(admitted_policy(tlp=None))
    assert binding.tlp is None
    with pytest.raises(HTTPException) as failure:
        require_document_admission_policy(binding)
    assert failure.value.status_code == 422
    assert failure.value.detail["error"]["code"] == "document_tlp_required"


def test_create_cannot_omit_the_whole_policy(client, db_session, admin_headers):
    payload = document_request()
    payload.pop("information_policy")
    before = snapshot(db_session)
    assert client.post("/api/v1/documents", json=payload, headers=admin_headers).status_code == 422
    assert snapshot(db_session) == before


def test_budget_service_cannot_admit_null_tlp_even_with_matching_envelope(client, db_session):
    payload = _preflight_payload()
    payload["information_policy"]["tlp"] = None
    payload["integration_envelope"]["classification"]["tlp"] = None
    payload["integration_envelope"]["policyHash"] = canonical_policy_hash(
        InformationPolicyBinding.model_validate(payload["information_policy"])
    )
    before = snapshot(db_session)
    response = client.post("/api/v1/integrations/stratos-budget-upload/external-documents/upsert",
                           json=payload, headers=_service_headers())
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation_error"
    assert snapshot(db_session) == before


@pytest.mark.parametrize("replacement", [None, admitted_policy(tlp=None)])
def test_patch_cannot_clear_or_replace_tlp_with_null(client, db_session, admin_headers, replacement):
    created = client.post("/api/v1/documents", json=document_request(), headers=admin_headers).json()
    before = snapshot(db_session)
    response = client.patch(f"/api/v1/documents/{created['document_id']}",
                            json={"information_policy": replacement}, headers=admin_headers)
    assert response.status_code == 422, response.text
    assert snapshot(db_session) == before


def test_version_inherits_explicit_tlp_but_rejects_explicit_null_binding(client, db_session, admin_headers):
    document = client.post("/api/v1/documents", json=document_request(), headers=admin_headers).json()
    path = f"/api/v1/documents/{document['document_id']}/versions"
    payload = profiled_version_request(document, {"version_label": "one", "source_file_uri": "s3://test/fixture.pdf"})
    accepted = client.post(path, json=payload, headers=admin_headers)
    assert accepted.status_code == 201, accepted.text
    assert accepted.json()["policy_summary"]["tlp"] == "TLP:CLEAR"
    before = snapshot(db_session)
    denied = client.post(path, json={**payload, "version_label": "two", "information_policy": admitted_policy(tlp=None)}, headers=admin_headers)
    assert denied.status_code == 422, denied.text
    assert snapshot(db_session) == before


@pytest.mark.parametrize("operation", ["approve", "publish", "budget_activate"])
@pytest.mark.parametrize("broken", ["document", "version"])
def test_activation_never_reuses_incomplete_stored_policy(db_session, operation, broken):
    document = Document(document_id="doc_policy_gate", title="Gate", document_type="manual",
                        status="approved", owner_id="user_owner", classification="internal",
                        policy_summary=admitted_policy())
    version = DocumentVersion(document_version_id="ver_policy_gate", document=document,
                              version_label="one", source_file_uri="s3://test/fixture.pdf",
                              status="valid", policy_summary=admitted_policy())
    setattr(document if broken == "document" else version, "policy_summary", admitted_policy(tlp=None))
    db_session.add(document)
    db_session.commit()
    before = snapshot(db_session)
    with pytest.raises(HTTPException) as failure:
        if operation == "approve":
            api._approve_document_for_publication(db_session, document, version, actor_id="user_owner")
        elif operation == "publish":
            api._publish_version(db_session, document=document, version=version, actor_id="user_owner")
        else:
            api._activate_budget_version_for_retrieval(db_session, document=document, version=version,
                actor_id="service:akb", owner_subject_id="user_owner", allow_supersede=False)
    assert failure.value.status_code == 409
    assert snapshot(db_session) == before


@pytest.mark.parametrize("action", [Action.document_read, Action.rag_query, Action.document_ingest,
                                    Action.document_version_create, Action.document_version_publish, Action.rag_export])
def test_missing_tlp_never_receives_admin_or_service_content_permission(action):
    document = Document(document_id="doc_invalid", title="Invalid", document_type="manual",
                        owner_id="user_owner", classification="internal", status="valid",
                        policy_summary=admitted_policy(tlp=None))
    admin = Principal("user_admin", {"admin"}, set())
    decision = evaluate_document_access(context_for_principal(admin), action.value, document)
    assert not decision.allowed
    assert "DOCUMENT_TLP_REQUIRED" in decision.reason_codes
    service = Principal("service:akb", {"service_ingestion"}, set(), service_identity=True)
    assert not evaluate_runtime_document_access(service, action.value, document).allowed


@pytest.mark.parametrize("label", [None, *sorted(EXPLICIT_DOCUMENT_TLP_VALUES)])
def test_employee_and_official_public_projection_require_explicit_clear(label):
    from app.official_public_sources import official_public_source_policy
    from app.permissions import SubjectContext, _employee_directive_source_allows

    policy = admitted_policy(tlp=label)
    binding = InformationPolicyBinding.model_validate(policy)
    coordinates = {
        "organization_id": "org_stratos", "policy_summary": policy,
        "policy_binding_id": binding.policy_binding_id, "policy_version": binding.policy_version,
        "policy_hash": canonical_policy_hash(binding), "status": "valid",
    }
    document = Document(document_id="doc_directive", title="Directive", document_type="directive",
                        owner_id="user_owner", classification="internal", **coordinates)
    version = DocumentVersion(document_version_id="ver_directive", document=document, version_label="1",
                              source_file_uri="s3://test/directive.pdf", **coordinates)
    context = SubjectContext(subject_id="employee", roles=set(), groups=set(),
                             scopes={"recipient_set:employee-directives"}, access_v2=True, capabilities={"akb:chat"},
                             organization_id="org_stratos", identity_active=True, membership_active=True,
                             application_access_active=True)
    assert _employee_directive_source_allows(context, "rag.query", document, version) is (label == "TLP:CLEAR")
    public = {**policy, "handlingClass": "PUBLIC", "contentCategories": ["PUBLIC_INFORMATION"]}
    assert official_public_source_policy(InformationPolicyBinding.model_validate(public)) is (label == "TLP:CLEAR")


@pytest.mark.parametrize("mode", ["legacy", "public"])
def test_exact_candidate_filter_cannot_bypass_version_tlp(mode):
    from app.permissions import Decision, SubjectContext

    document = Document(document_id="doc_candidate", title="Candidate", document_type="manual",
                        owner_id="user_owner", classification="internal", status="valid",
                        policy_summary=admitted_policy(), policy_hash="sha256:fixture")
    version = DocumentVersion(document_version_id="ver_candidate", document=document, version_label="1",
                              source_file_uri="s3://test/source.pdf", status="valid",
                              policy_summary=admitted_policy(tlp=None), policy_hash=document.policy_hash)
    decision = Decision(True, "Approved root", {"public_version_ids": [version.document_version_id]} if mode == "public" else {})
    context = SubjectContext(subject_id="admin", roles={"admin"}, groups=set(), access_v2=False, capabilities=set(), scopes=set(),
                             organization_id="org_stratos", identity_active=True, membership_active=True,
                             application_access_active=True)
    assert api._allowed_candidate_document_versions(
        context=context, decision=decision, document=document,
        candidate_hashes={document.policy_hash}, candidate_versions={version.document_version_id},
        versions_by_id={version.document_version_id: version}, action="rag.query",
    ) == set()


@pytest.mark.parametrize("policy", [None, admitted_policy(tlp=None)])
def test_external_import_has_no_null_policy_exception(client, db_session, admin_headers, policy):
    from test_external_documents import _external_payload

    before = snapshot(db_session)
    response = client.post("/api/v1/external-documents/upsert", headers=admin_headers,
                           json=_external_payload(information_policy=policy))
    assert response.status_code == 422, response.text
    assert snapshot(db_session) == before


def test_corrupt_stored_version_cannot_be_submitted_for_review(client, db_session, admin_headers):
    document = client.post("/api/v1/documents", json=document_request(), headers=admin_headers).json()
    version = client.post(f"/api/v1/documents/{document['document_id']}/versions", headers=admin_headers,
                          json=profiled_version_request(document, {"version_label": "1", "source_file_uri": "s3://test/source.pdf"})).json()
    stored = db_session.get(DocumentVersion, version["document_version_id"])
    stored.policy_summary = admitted_policy(tlp=None)
    db_session.commit()
    before = snapshot(db_session)
    response = client.post(f"/api/v1/documents/{document['document_id']}/versions/{stored.document_version_id}/submit-review",
                           headers=admin_headers, json={})
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "document_tlp_required"
    assert snapshot(db_session) == before


def test_incomplete_document_can_be_withdrawn_without_read_or_reactivation(client, db_session, admin_headers):
    document = client.post("/api/v1/documents", json=document_request(), headers=admin_headers).json()
    stored = db_session.get(Document, document["document_id"])
    stored.policy_summary = admitted_policy(tlp=None)
    db_session.commit()
    response = client.delete(f"/api/v1/documents/{stored.document_id}", headers=admin_headers)
    assert response.status_code == 204, response.text
    db_session.refresh(stored)
    assert stored.status == "cancelled"
    assert stored.policy_summary["tlp"] is None
    assert not evaluate_document_access(context_for_principal(Principal("admin", {"admin"}, set())), "document.read", stored).allowed


def test_live_and_published_document_admission_schema_are_equivalent():
    from copy import deepcopy
    from pathlib import Path
    import yaml
    from app.main import app

    published = yaml.safe_load((Path(__file__).parents[1] / "openapi.yaml").read_text())["components"]["schemas"]
    live = app.openapi()["components"]["schemas"]
    strict = deepcopy(published["DocumentInformationPolicyBinding"])
    strict["allOf"][0] = published["InformationPolicyBinding"]
    assert strict == live["DocumentInformationPolicyBinding"]
    assert {"type": "null"} in published["InformationPolicyBinding"]["properties"]["tlp"]["anyOf"]
    for name in ("DocumentCreate", "DocumentPatch", "ExternalDocumentUpsertRequest", "DocumentVersionCreate",
                 "StratosBudgetUploadExternalDocumentUpsertRequest", "StratosBudgetUploadDocumentVersionCreate",
                 "StratosBudgetUploadExternalDocumentCurrentUpdateRequest"):
        assert published[name]["properties"]["information_policy"] == live[name]["properties"]["information_policy"]
        assert published[name].get("required") == live[name].get("required")
