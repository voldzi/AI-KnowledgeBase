import pytest
from sqlalchemy import func, select

from app.models import Document, DocumentProfileRootRevision, DocumentProfileVersionSnapshot
from document_profile_fixtures import verified_profile_authority, root_request, version_request


def test_native_http_create_and_version_persist_exact_profiles(client, admin_headers, db_session, verified_profile_authority):
    response = client.post("/api/v1/documents",json=root_request(),headers=admin_headers)
    assert response.status_code == 201,response.text
    document = response.json()
    assert document["document_profile"]["metadataRevision"] == document["current_root_metadata_revision"]
    response = client.post(f"/api/v1/documents/{document['document_id']}/versions",json=version_request(document),headers=admin_headers)
    assert response.status_code == 201,response.text
    version = response.json()
    assert version["root_snapshot_hash"] == document["current_root_snapshot_hash"]
    assert version["document_profile_snapshot"]["sourceLineage"]["sourceVersion"] == version["document_version_id"]
    assert db_session.scalar(select(func.count()).select_from(DocumentProfileRootRevision)) == 1
    assert db_session.scalar(select(func.count()).select_from(DocumentProfileVersionSnapshot)) == 1


@pytest.mark.parametrize("mode",["missing","deny","stale","wrong-owner","unsupported"])
def test_root_central_profile_failure_leaves_no_document(client,admin_headers,db_session,verified_profile_authority,mode):
    verified_profile_authority.mode = mode
    response = client.post("/api/v1/documents",json=root_request(),headers=admin_headers)
    assert response.status_code == 503,response.text
    assert db_session.scalar(select(func.count()).select_from(Document)) == 0
    assert db_session.scalar(select(func.count()).select_from(DocumentProfileRootRevision)) == 0


def test_missing_profile_is_not_filled_even_for_mock_admin(client,admin_headers,db_session):
    payload=root_request();payload.pop("document_profile")
    response=client.post("/api/v1/documents",json=payload,headers=admin_headers)
    assert response.status_code == 422,response.text
    assert db_session.scalar(select(func.count()).select_from(Document)) == 0


@pytest.mark.parametrize("mutation",["profile","receipt","revision","owner","invalid-hash"])
def test_native_version_incomplete_source_never_reaches_central_write(client,admin_headers,db_session,verified_profile_authority,mutation):
    document=client.post("/api/v1/documents",json=root_request(),headers=admin_headers).json()
    payload=version_request(document)
    if mutation == "profile": payload.pop("document_profile")
    elif mutation == "receipt": payload["file"].pop("intake_receipt")
    elif mutation == "revision": payload["document_profile"]["expected_root_metadata_revision"] = "stale"
    elif mutation == "invalid-hash":
        from document_intake_fixtures import _intake_receipt
        payload["file_hash"]=payload["file"]["sha256"]="sha256:abc"
        payload["file"]["intake_receipt"]=_intake_receipt(document["document_id"],payload,session="invalid-hash")
    elif mutation == "owner":
        stored=db_session.get(Document,document["document_id"]);stored.owner_id="unverified-owner";db_session.commit()
    before=sum(method == "PUT" for method, _, _ in verified_profile_authority.requests)
    response=client.post(f"/api/v1/documents/{document['document_id']}/versions",json=payload,headers=admin_headers)
    assert response.status_code in {403,409,422},response.text
    assert sum(method == "PUT" for method, _, _ in verified_profile_authority.requests) == before
    assert db_session.scalar(select(func.count()).select_from(DocumentProfileVersionSnapshot)) == 0


def test_budget_profiles_keep_accountable_owner_distinct_from_upload_actor(client, db_session, verified_profile_authority):
    from document_profile_fixtures import root_profile
    from test_stratos_budget_upload_bridge import _preflight_payload, _version_payload, _service_headers, _intake_receipt, CONTRACT_ID, PARENT_RESOURCE
    root = _preflight_payload()
    root["document_profile"] = root_profile(profile_id="akb.contract", owner="accountable_contract_owner")
    root["document_profile"]["provenance"] = {"sourceSystem":"STRATOS_BUDGET", "sourceRecordId":CONTRACT_ID,
                                             "sourceGovernedResourceId":PARENT_RESOURCE}
    root["owner"]["user_id"] = "accountable_contract_owner"
    result = client.post("/api/v1/integrations/stratos-budget-upload/external-documents/upsert",json=root,headers=_service_headers())
    assert result.status_code == 201,result.text
    document = result.json()["document"]
    assert document["owner_id"] == "accountable_contract_owner"
    payload = _version_payload(document=document)
    payload["document_profile"] = {
        "expected_root_metadata_revision":document["current_root_metadata_revision"],
        "lifecycle":{"mode":"fixed_interval","effectiveFrom":payload["valid_from"],"effectiveTo":payload["valid_to"],
            "recordedOn":None,"reviewAt":"2027-09-05","reviewRuleId":"akb.review.annual","retentionRuleId":"akb.retention.organizational-record"},
        "domain_evidence":{"family":"contract","contractReference":CONTRACT_ID,"partyReferences":["contract-party-one","contract-party-two"],
                           "executionStatus":"signed","executionEvidenceReference":"signed-source-contract"}}
    payload["file"]["intake_receipt"] = _intake_receipt(document["document_id"],payload,session="explicit-profile-test")
    result = client.put(f"/api/v1/integrations/stratos-budget-upload/documents/{document['document_id']}/versions",
                        json=payload,headers=_service_headers())
    assert result.status_code == 201,result.text
    snapshot = result.json()["version"]["document_profile_snapshot"]
    assert snapshot["sourceLineage"]["sourceVersion"] == payload["file_hash"]
    assert db_session.scalar(select(func.count()).select_from(DocumentProfileVersionSnapshot)) == 1


def test_fresh_read_and_activation_deny_revoked_profile_without_status_change(client, admin_headers, db_session, verified_profile_authority):
    from app import api
    from fastapi import HTTPException
    from app.models import DocumentVersion
    created=client.post("/api/v1/documents",json=root_request(),headers=admin_headers).json()
    response=client.post(f"/api/v1/documents/{created['document_id']}/versions",json=version_request(created),headers=admin_headers)
    assert response.status_code == 201,response.text
    version=db_session.get(DocumentVersion,response.json()["document_version_id"])
    document=db_session.get(Document,created["document_id"])
    verified_profile_authority.mode="deny"
    assert client.get(f"/api/v1/documents/{document.document_id}",headers=admin_headers).status_code == 403
    with pytest.raises(HTTPException) as failure:
        api._approve_document_for_publication(db_session,document,version,actor_id="user_admin")
    assert failure.value.status_code == 503
    assert version.status == "draft"
    assert document.status == "draft"


def test_exact_version_metadata_revalidates_profile_for_person_and_service(
    client, admin_headers, verified_profile_authority, monkeypatch,
):
    from test_ingestion_authorization import _ingestion_service_headers

    created = client.post("/api/v1/documents", json=root_request(), headers=admin_headers).json()
    response = client.post(f"/api/v1/documents/{created['document_id']}/versions",
                           json=version_request(created), headers=admin_headers)
    assert response.status_code == 201, response.text
    path = f"/api/v1/documents/{created['document_id']}/versions/{response.json()['document_version_id']}"
    service_headers = _ingestion_service_headers("corr-test")
    assert client.get(path, headers=admin_headers).status_code == 200
    assert client.get(path, headers=service_headers).status_code == 200
    original_transport = verified_profile_authority._request

    def revoke_exact_version(method, url, token, body, **kwargs):
        result = original_transport(method, url, token, body, **kwargs)
        if method == "POST" and body["documentAdmission"]["versionSnapshot"] is not None:
            result["documentAdmission"]["decision"] = "DENY"
        return result

    monkeypatch.setattr(verified_profile_authority, "_request", revoke_exact_version)
    # The root remains approved; its proof cannot stand in for the separately
    # revoked exact version, including service metadata transport.
    assert client.get(f"/api/v1/documents/{created['document_id']}", headers=admin_headers).status_code == 200
    for headers in (admin_headers, service_headers):
        denied = client.get(path, headers=headers)
        assert denied.status_code == 503, denied.text
        assert "source_file_uri" not in denied.json()
    assert client.get(f"/api/v1/documents/{created['document_id']}/versions", headers=admin_headers).status_code == 503
