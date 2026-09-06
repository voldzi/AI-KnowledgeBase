from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from sqlalchemy import select, func
from app import source_intake as intake
from app.auth import Principal, get_current_principal
from app.models import Document, DocumentVersion
from app.access_governance import GovernanceDenied
from document_profile_fixtures import root_profile, version_request, verified_profile_authority
from document_policy_fixtures import admitted_policy
from document_intake_fixtures import _intake_receipt


def request_body(source="STRATOS_PROJECTFLOW", entity="project"):
    is_project = source == "STRATOS_PROJECTFLOW"
    policy = admitted_policy()
    policy.update(originatorId="user_owner")
    policy["obligations"] = ["AUDIT_ACCESS"]
    profile = root_profile()
    record = "project-1" if entity == "project" else "record-1"
    profile["provenance"] = {"sourceSystem":source, "sourceRecordId":record, "sourceGovernedResourceId":"gres_source_1"}
    ref = "project:project-1" if is_project else "archflow-need:record-1"
    if is_project and entity != "project": ref += f":{'status-report' if entity == 'status_report' else entity}:{record}"
    draft = version_request({"document_id":"unused", "current_root_metadata_revision":"unused"})["document_profile"]
    draft.pop("expected_root_metadata_revision")
    return {"document": {"external_system":source,"external_ref":ref+":document:attachment-1",
        "source_document_id":"attachment-1","project_id":"project-1" if is_project else None,
        "entity_type":entity,"entity_id":record,"document_type":"knowledge_base_article", "title":"Project source note",
        "information_policy":policy,"owner":{"user_id":"user_owner"},"gestor_unit":"unit_knowledge",
        "document_profile":profile,"parent_governed_resource_id":"gres_source_1",
        "governance_scope":{"type":"project","id":"project-1"} if is_project else {"type":"organization","id":"org_stratos"}},
        "file":{"file_name":"fixture.pdf","file_size":23,"file_type":"application/pdf","sha256":"sha256:"+"a"*64},
        "source_revision":"source-revision-1", "version_label":"1", "version_profile":draft,
        "actor_subject_id":"user_admin", "correlation_id":"corr-test"}


@pytest.mark.parametrize("source,entity", [("STRATOS_PROJECTFLOW","project"),("STRATOS_PROJECTFLOW","task"),("STRATOS_PROJECTFLOW","status_report"),("STRATOS_ARCHFLOW","need")])
def test_source_contracts(source, entity):
    assert intake.SourcePrepare.model_validate(request_body(source, entity)).document.external_system == source


@pytest.mark.parametrize("mutation", ["no_tlp","wrong_source","wrong_ref","wrong_parent","wrong_scope","budget","metadata","storage","missing_author","missing_owner"])
def test_invalid_source_contract(mutation):
    raw = request_body(); doc = raw["document"]
    if mutation == "no_tlp": doc["information_policy"]["tlp"] = None
    if mutation == "wrong_source": doc["document_profile"]["provenance"]["sourceSystem"] = "AKB"
    if mutation == "wrong_ref": doc["external_ref"] += "-other"
    if mutation == "wrong_parent": doc["parent_governed_resource_id"] = "other"
    if mutation == "wrong_scope": doc["governance_scope"]["id"] = "other-project"
    if mutation == "budget": doc["external_system"] = "STRATOS_BUDGET"
    if mutation == "metadata": doc["metadata"] = {"role":"admin"}
    if mutation == "storage": doc["akb_source_uri"] = "s3://unverified/file"
    if mutation == "missing_author": doc["document_profile"]["authorship"] = []
    if mutation == "missing_owner": doc["document_profile"]["accountability"].pop("ownerSubjectId")
    with pytest.raises(ValidationError): intake.SourcePrepare.model_validate(raw)


@pytest.fixture
def source_runtime(client, monkeypatch, verified_profile_authority):
    state = SimpleNamespace(mode="allow", requests=[])
    service = Principal("service-projectflow", {"service_ingestion"}, set(), service_identity=True,
        service_client_id="stratos-projectflow-akb-service")
    client.app.dependency_overrides[get_current_principal] = lambda: service
    monkeypatch.setattr(intake, "get_authenticated_principal", lambda request, settings: Principal("user_admin", {"admin"}, set(), bearer_token="test-person"))
    settings = intake.get_settings()
    monkeypatch.setattr(settings,"stratos_source_intake_authority_url","https://source-authority.invalid/authorize")
    def transport(method, url, token, body, **kwargs):
        state.requests.append((deepcopy(body), kwargs))
        if state.mode == "deny": raise GovernanceDenied("denied")
        return {"schema_version":"stratos-source-intake-authorization-1", "allowed":True,
            "nonce":"wrong" if state.mode == "nonce" else body["nonce"],
            "request_hash":"wrong" if state.mode == "hash" else body["request_hash"],
            "expires_at":(datetime.now(timezone.utc)+timedelta(seconds=-1 if state.mode == "expired" else 30)).isoformat()}
    monkeypatch.setattr(intake,"governance_client",lambda _:SimpleNamespace(_request=transport))
    state.service = service
    return state


HEADERS={"Authorization":"Bearer test-service", "X-STRATOS-Actor-Authorization":"Bearer test-person", "X-Correlation-ID":"corr-test"}
BASE="/api/v1/integrations/stratos-source-intake"


def prepare(client):
    response = client.post(BASE+"/prepare",json=request_body(),headers=HEADERS)
    assert response.status_code == 200, response.text
    return response.json()


def confirmation(prepared):
    doc = prepared["external_document"]["document"]
    raw=request_body()
    payload={"external_document_id":prepared["external_document"]["external_document"]["external_document_id"],
        "document_profile":prepared["document_profile"],"file":raw["file"],"source_revision":raw["source_revision"],
        "version_label":"1", "actor_subject_id":"user_admin", "registered_by_subject_id":"service-projectflow",
        "correlation_id":"corr-test", "policy_hash":doc["policy_hash"],"source_file_uri":"s3://akb/source-fixture.pdf",
        "expected_current_document_version_id":None}
    receipt_input={"source_file_uri":payload["source_file_uri"],"file_hash":raw["file"]["sha256"],"file":{
        "filename":"fixture.pdf","mime_type":"application/pdf","size_bytes":23,"sha256":raw["file"]["sha256"]}}
    payload["upload_receipt"] = _intake_receipt(doc["document_id"],receipt_input,session="source-session-1")
    return doc["document_id"], payload


def test_source_prepare_and_confirm_replay(client, db_session, source_runtime):
    prepared=prepare(client)
    replay=prepare(client)
    assert replay["external_document"] == {**prepared["external_document"], "created":False}
    assert replay["document_profile"] == prepared["document_profile"]
    assert db_session.scalar(select(func.count()).select_from(Document)) == 1
    docid,payload=confirmation(prepared)
    first=client.post(BASE+f"/documents/{docid}/confirm",json=payload,headers=HEADERS)
    assert first.status_code in {200,201},first.text
    second=client.post(BASE+f"/documents/{docid}/confirm",json=payload,headers=HEADERS)
    assert second.status_code==200,second.text
    assert first.json()["version"]["document_version_id"]==second.json()["version"]["document_version_id"]
    assert second.json()["version"]["idempotent_replay"] is True
    assert db_session.scalar(select(func.count()).select_from(DocumentVersion)) == 1
    assert source_runtime.requests[-1][0]["stage"]=="confirm"
    assert source_runtime.requests[-1][1]["extra_headers"]["X-STRATOS-Actor-Authorization"]=="Bearer test-person"


@pytest.mark.parametrize("mode,status",[("deny",403),("nonce",503),("hash",503),("expired",503)])
def test_source_denial_has_no_writes(client,db_session,source_runtime,mode,status):
    source_runtime.mode=mode
    response=client.post(BASE+"/prepare",json=request_body(),headers=HEADERS)
    assert response.status_code==status,response.text
    assert db_session.scalar(select(func.count()).select_from(Document)) == 0


def test_cross_source_service_denied_before_authority(client,source_runtime):
    response=client.post(BASE+"/prepare",json=request_body("STRATOS_ARCHFLOW","need"),headers=HEADERS)
    assert response.status_code==403,response.text
    assert source_runtime.requests==[]


def test_revoke_between_prepare_confirm_does_not_create_version(client,db_session,source_runtime):
    docid,payload=confirmation(prepare(client))
    source_runtime.mode="deny"
    response=client.post(BASE+f"/documents/{docid}/confirm",json=payload,headers=HEADERS)
    assert response.status_code==403,response.text
    assert db_session.scalar(select(func.count()).select_from(DocumentVersion)) == 0


@pytest.mark.parametrize("source,entity", [("STRATOS_PROJECTFLOW","task"),("STRATOS_PROJECTFLOW","status_report"),("STRATOS_ARCHFLOW","need")])
def test_other_source_entities_use_same_verified_engine(client,db_session,source_runtime,source,entity):
    from dataclasses import replace
    client.app.dependency_overrides[get_current_principal] = lambda: replace(source_runtime.service, service_client_id=intake.SOURCE_CLIENTS[source])
    prepared=client.post(BASE+"/prepare",json=request_body(source,entity),headers=HEADERS)
    assert prepared.status_code==200,prepared.text
    docid,payload=confirmation(prepared.json())
    result=client.post(BASE+f"/documents/{docid}/confirm",json=payload,headers=HEADERS)
    assert result.status_code==200,result.text
    assert result.json()["version"]["status"]=="draft"
    status=client.post(BASE+f"/documents/{docid}/status",json={"actor_subject_id":"user_admin","correlation_id":"corr-test"},headers=HEADERS)
    assert status.status_code==200,status.text
    assert status.json()["document_version_id"]==result.json()["version"]["document_version_id"]
    assert status.json()["ingestion_status"]=="VERSION_CREATED"


def test_changed_bytes_cannot_replace_source_revision(client,db_session,source_runtime):
    docid,payload=confirmation(prepare(client))
    first=client.post(BASE+f"/documents/{docid}/confirm",json=payload,headers=HEADERS)
    assert first.status_code==200,first.text
    payload["source_file_uri"]="s3://akb/changed.pdf"
    payload["file"]["sha256"]="sha256:"+"b"*64
    payload["upload_receipt"]=_intake_receipt(docid,{"source_file_uri":payload["source_file_uri"],"file_hash":payload["file"]["sha256"],
        "file":{"filename":"fixture.pdf","mime_type":"application/pdf","size_bytes":23,"sha256":payload["file"]["sha256"]}},session="other-session")
    changed=client.post(BASE+f"/documents/{docid}/confirm",json=payload,headers=HEADERS)
    assert changed.status_code==409,changed.text
    assert db_session.scalar(select(func.count()).select_from(DocumentVersion)) == 1


def test_generic_routes_cannot_bypass_source_authority(client,source_runtime):
    prepared=prepare(client);docid=prepared["external_document"]["document"]["document_id"]
    client.app.dependency_overrides[get_current_principal]=lambda:Principal("user_admin",{"admin"},set())
    generic=intake.SourceDocument.model_validate(request_body()["document"]).registration().model_dump(mode="json")
    assert client.post("/api/v1/external-documents/upsert",json=generic,headers=HEADERS).status_code==409
    raw=version_request(prepared["external_document"]["document"])
    assert client.post(f"/api/v1/documents/{docid}/versions",json=raw,headers=HEADERS).status_code==409


@pytest.mark.parametrize("field,value", [("sourceSystem", "AKB"), ("sourceRecordId", "other-record"), ("sourceGovernedResourceId", "other-parent")])
def test_metadata_cannot_erase_or_rebind_source(client, db_session, source_runtime, field, value):
    document = prepare(client)["external_document"]["document"]
    client.app.dependency_overrides[get_current_principal] = lambda: Principal("user_admin", {"admin"}, set())
    profile = request_body()["document"]["document_profile"]
    original = deepcopy(profile["provenance"])
    profile["provenance"][field] = value
    if field == "sourceSystem":
        profile["provenance"] = {"sourceSystem": value, "sourceRecordId": None, "sourceGovernedResourceId": None}
    response = client.patch(f"/api/v1/documents/{document['document_id']}", json={
        "document_profile": profile,
        "expected_root_metadata_revision": document["current_root_metadata_revision"],
    }, headers=HEADERS)
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "source_provenance_immutable"
    db_session.expire_all()
    stored = db_session.get(Document, document["document_id"])
    assert stored.current_profile_revision.payload["provenance"] == original


@pytest.mark.parametrize("header",[None,"Bearer test-service"])
def test_absent_or_reused_actor_token_denied(client,source_runtime,header):
    headers=dict(HEADERS)
    if header is None: headers.pop("X-STRATOS-Actor-Authorization")
    else: headers["X-STRATOS-Actor-Authorization"]=header
    response=client.post(BASE+"/prepare",json=request_body(),headers=headers)
    assert response.status_code==401,response.text
    assert source_runtime.requests==[]


def test_authority_wire_payload_matches_delivered_schema(client,source_runtime):
    import json
    from pathlib import Path
    prepare(client)
    contract=json.loads((Path(__file__).parents[3]/'contracts/stratos/source-document-intake/stratos-authority.openapi.json').read_text())
    wire=source_runtime.requests[0][0]
    assert set(wire)==set(contract['components']['schemas']['SourceIntakeAuthorityRequest']['required'])
    assert 'policyBindingId' in wire['document']['information_policy']
    assert 'recordedOn' in wire['version_profile']['lifecycle']
    assert 'policy_binding_id' not in wire['document']['information_policy']
