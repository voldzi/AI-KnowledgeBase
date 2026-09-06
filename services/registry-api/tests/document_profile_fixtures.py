"""Explicit test data and a transport authority that runs production verifiers.

Tests opt into this fixture. It does not modify HTTP payloads or replace any
admission, policy, hash, nonce, receipt or persistence validator.
"""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json

import pytest

from app.access_governance import StratosGovernanceClient
from app.document_profile import DocumentAdmissionExpectation, prepare_document_admission
from app.information_policy import canonical_policy_hash
from document_policy_fixtures import admitted_policy
from document_intake_fixtures import _intake_receipt, INTAKE_SECRET


def root_profile(*, profile_id="akb.knowledge-note", owner="user_owner", gestor="unit_knowledge"):
    return {"profile":{"id":profile_id,"revision":"1"},
            "authorship":[{"kind":"person","id":"test_document_author","evidenceReference":"test_authoring_workflow"}],
            "provenance":{"sourceSystem":"AKB","sourceRecordId":None,"sourceGovernedResourceId":None},
            "accountability":{"ownerSubjectId":owner,"gestor":{"kind":"organization_unit","id":gestor}}}


def root_request():
    return {"title":"Admitted note", "document_type":"knowledge_base_article", "owner_id":"user_owner",
            "gestor_unit":"unit_knowledge", "information_policy":admitted_policy(), "document_profile":root_profile()}


def version_request(document, *, label="1"):
    payload = {"version_label":label, "source_file_uri":f"s3://akb/test-{label}.pdf", "file_hash":"sha256:"+"a"*64,
               "file":{"filename":"fixture.pdf","mime_type":"application/pdf","size_bytes":23,"sha256":"sha256:"+"a"*64},
               "document_profile":{"expected_root_metadata_revision":document["current_root_metadata_revision"],
                    "lifecycle":{"mode":"record", "effectiveFrom":None,"effectiveTo":None,"recordedOn":"2026-09-05",
                                 "reviewAt":"2027-09-05","reviewRuleId":"akb.review.annual","retentionRuleId":"akb.retention.organizational-record"},
                    "domain_evidence":{"family":"knowledge_note","subject":"Test knowledge","createdOn":"2026-09-05"}}}
    payload["file"]["intake_receipt"] = _intake_receipt(document["document_id"],payload,session=f"test-{label}")
    return payload


def profiled_document_request(payload, *, profile_id=None):
    """Build explicit complete positive test data; negative tests mutate it afterwards."""
    value = deepcopy(payload)
    if "document_profile" in value:
        return value
    document_type = value["document_type"]
    if profile_id is None:
        profile_id = ("akb.knowledge-note" if document_type in {"knowledge_base_article","other"}
            else "akb.meeting-project-record" if document_type in {"meeting_record","project_documentation"}
            else "akb.contract" if document_type == "contract"
            else "akb.official-public-reference" if document_type == "regulation"
            else "akb.controlled-document")
    assignments = value.get("assignments")
    if assignments is None: assignments = []
    owner = next((row for row in assignments if row["role"] == "owner" and row.get("is_primary",False)), None)
    gestor = next((row for row in assignments if row["role"] == "gestor" and row.get("is_primary",False)), None)
    owner_id = owner["subject_id"] if owner else value["owner_id"]
    gestor_id = gestor["subject_id"] if gestor else value.get("gestor_unit") or "test_unit_knowledge"
    gestor_kind = "person" if gestor and gestor["subject_type"] == "user" else "organization_unit"
    value["owner_id"] = owner_id
    value["gestor_unit"] = gestor_id if gestor_kind == "organization_unit" else None
    profile = root_profile(profile_id=profile_id, owner=owner_id,gestor=gestor_id)
    profile["accountability"]["gestor"]["kind"] = gestor_kind
    if profile_id == "akb.official-public-reference":
        profile["authorship"] = [{"kind":"external_authority","id":"test_official_issuer","evidenceReference":"test_official_source_evidence"}]
        profile["provenance"] = {"sourceSystem":"AKB_OFFICIAL_SOURCE","sourceRecordId":"test_official_source",
                                  "sourceGovernedResourceId":"gres_test_official_source"}
    if owner is None: assignments.append({"role":"owner","subject_type":"user","subject_id":owner_id,"is_primary":True})
    if gestor is None: assignments.append({"role":"gestor","subject_type":"unit" if gestor_kind == "organization_unit" else "user","subject_id":gestor_id,"is_primary":True})
    if profile_id == "akb.controlled-document" and not any(row["role"] == "approver" and row.get("is_primary",False) for row in assignments):
        assignments.append({"role":"approver","subject_type":"user","subject_id":"test_independent_approver","is_primary":True})
    value["assignments"] = assignments
    value["document_profile"] = profile
    return value


def profiled_version_request(document, payload, *, recorded_on="2020-01-01"):
    """Explicit receipt, dates and evidence for a positive native API fixture."""
    import hashlib
    value = deepcopy(payload)
    if "document_profile" in value: return value
    profile = document["document_profile"]
    family = {"akb.knowledge-note":"knowledge_note","akb.controlled-document":"controlled_document",
        "akb.meeting-project-record":"meeting_project_record","akb.contract":"contract",
        "akb.official-public-reference":"official_public_reference"}[profile["profile"]["id"]]
    record = family in {"knowledge_note","meeting_project_record"}
    if record:
        value["valid_from"] = value["valid_to"] = None
    else:
        value.setdefault("valid_from", "2020-01-01")
        if value["valid_from"] is None:
            raise ValueError("Normative test fixtures require explicit start; use a record profile for undated records")
    mode = "record" if record else "fixed_interval" if value.get("valid_to") else "until_superseded"
    evidence = {
        "knowledge_note":{"subject":"Explicit test note","createdOn":recorded_on},
        "meeting_project_record":{"eventDate":recorded_on,"recordReference":"test-meeting","projectReference":None},
        "controlled_document":{"issuerReference":"test-issuer","applicability":"Explicit test scope","effectiveDateEvidenceReference":"test-effective-evidence"},
        "contract":{"contractReference":"test-contract","partyReferences":["test-party"],"executionStatus":"signed","executionEvidenceReference":"test-signed-evidence"},
        "official_public_reference":{"authorityReference":"test_official_issuer","canonicalSourceUrl":"https://official.example.test/source",
            "collectionId":"test-approved-collection","sourceKind":"regulation","effectiveDateEvidenceReference":"test-effective-evidence"},
    }[family]
    value["document_profile"] = {"expected_root_metadata_revision":document["current_root_metadata_revision"],
        "lifecycle":{"mode":mode,"effectiveFrom":value.get("valid_from"),"effectiveTo":value.get("valid_to"),
            "recordedOn":recorded_on if record else None,"reviewAt":"2030-01-01","reviewRuleId":"akb.review.annual",
            "retentionRuleId":"akb.retention.organizational-record"},"domain_evidence":{"family":family,**evidence}}
    file_hash = value.get("file_hash") or "sha256:"+hashlib.sha256(value["source_file_uri"].encode()).hexdigest()
    value["file_hash"] = file_hash
    file = value.setdefault("file",{})
    for key, default in {"filename":"test-source.pdf","mime_type":"application/pdf","size_bytes":23,"sha256":file_hash}.items():
        file.setdefault(key,default)
    file["intake_receipt"] = _intake_receipt(document["document_id"],value,session="explicit-profile-"+hashlib.sha256(f"{document['document_id']}\n{value['version_label']}\n{value['source_file_uri']}".encode()).hexdigest())
    return value


def admit_orm_profile(db, document, versions, authority, *, profile_id=None, recorded_on="2020-01-01"):
    """Admit explicitly constructed ORM fixtures through the real proof and file validators.

    This helper never changes publication status/timestamps. Callers select a
    record profile explicitly when their source has no normative validity.
    """
    from app.document_profile import DocumentAdmissionExpectation
    from app.document_profile_inputs import DocumentProfileInput, DocumentVersionProfileInput, build_root_snapshot, build_version_snapshot
    from app.document_profile_runtime import source_lineage_from_verified_file
    from app.document_profile_storage import persist_root_revision, persist_version_snapshot
    from app.information_policy import InformationPolicyBinding
    from app.models import DocumentFile, make_id
    from app.content_security import verify_content_security_attestation
    from app.api import _apply_document_intake_attestation
    data=profiled_document_request({"document_type":document.document_type,"owner_id":document.owner_id,
        "gestor_unit":document.gestor_unit},profile_id=profile_id)
    root=build_root_snapshot(DocumentProfileInput.model_validate(data["document_profile"]),document_id=document.document_id,
        metadata_revision=document.governed_source_version or make_id("test-root"),document_type=document.document_type)
    document.gestor_unit=data["gestor_unit"]
    binding=InformationPolicyBinding.model_validate(document.policy_summary)
    scope={"type":document.governance_scope_type or "organization","id":document.governance_scope_id or "org_stratos"}
    if scope["type"] == "own": scope={"type":"own","ownerSubjectId":document.governance_scope_owner_subject_id}
    root_registration=authority.register_information_resource(credential_token="explicit-test-service-credential",
        audit_actor_subject_id="explicit-test-authority-actor",resource_type="document",resource_id=document.document_id,
        source_version=root.metadata_revision,title=document.title,scope=scope,binding=binding,parent_resource_id=None,
        reason="Explicit ORM fixture admission",document_admission=DocumentAdmissionExpectation(root_snapshot=root,current_root_snapshot=root,correlation_id="test-fixture-admission"))
    document.governed_resource_id=root_registration.resource_id
    document.governed_source_version=root.metadata_revision
    document.governance_registration_status="REGISTERED"
    document.governance_scope_type=scope["type"];document.governance_scope_id=scope.get("id")
    document.governance_scope_owner_subject_id=scope.get("ownerSubjectId")
    db.add(document);db.flush()
    persist_root_revision(db,document=document,registration=root_registration,expected_current_revision=None,actor_subject_id="explicit-test-authority-actor")
    projection={"document_id":document.document_id,"document_profile":root.model_dump(mode="json",by_alias=True),"current_root_metadata_revision":root.metadata_revision}
    for version in versions:
        source={"version_label":version.version_label,"source_file_uri":version.source_file_uri,
                "file_hash":version.file_hash,"valid_from":version.valid_from.isoformat() if version.valid_from else None,
                "valid_to":version.valid_to.isoformat() if version.valid_to else None}
        existing_file=next(iter(version.files),None)
        if existing_file is not None:
            source["file"]={key:getattr(existing_file,key) for key in ("filename","mime_type","size_bytes","sha256")}
        source=profiled_version_request(projection,source,recorded_on=(
            recorded_on[version.document_version_id] if isinstance(recorded_on,dict) else recorded_on))
        version.file_hash=source["file_hash"]
        file=next(iter(version.files),None) or DocumentFile(file_id=make_id("testfile"),document_id=document.document_id,
            document_version_id=version.document_version_id,document_version=version,uri=version.source_file_uri)
        for key in ("filename","mime_type","size_bytes","sha256"): setattr(file,key,source["file"][key])
        attestation=verify_content_security_attestation(source["file"]["intake_receipt"],signing_secret=INTAKE_SECRET,required=True,
            document_id=document.document_id,source_file_uri=version.source_file_uri,filename=file.filename,mime_type=file.mime_type,size_bytes=file.size_bytes,sha256=file.sha256)
        _apply_document_intake_attestation(file,attestation)
        snapshot=build_version_snapshot(DocumentVersionProfileInput.model_validate(source["document_profile"]),root=root,
            document_version_id=version.document_version_id,verified_source=source_lineage_from_verified_file(root,version,file,
                source_version=file.sha256 if root.provenance.source_system != "AKB" else None))
        binding=InformationPolicyBinding.model_validate(version.policy_summary)
        registration=authority.register_information_resource(credential_token="explicit-test-service-credential",
            audit_actor_subject_id="explicit-test-authority-actor",resource_type="document_version",resource_id=version.document_version_id,
            source_version=version.document_version_id,title=document.title,scope=scope,binding=binding,parent_resource_id=document.governed_resource_id,
            reason="Explicit ORM version fixture admission",document_admission=DocumentAdmissionExpectation(root_snapshot=root,current_root_snapshot=root,version_snapshot=snapshot,correlation_id="test-fixture-admission"))
        version.governed_resource_id=registration.resource_id;version.governed_source_version=version.document_version_id
        version.governed_parent_resource_id=document.governed_resource_id;version.governance_registration_status="REGISTERED"
        version.governance_scope_type=scope["type"];version.governance_scope_id=scope.get("id")
        version.governance_scope_owner_subject_id=scope.get("ownerSubjectId")
        db.add_all([version,file]);db.flush()
        persist_version_snapshot(db,document=document,version=version,file=file,registration=registration,
            expected_current_revision=root.metadata_revision,actor_subject_id="explicit-test-authority-actor")
    db.flush()
    return document


class VerifiedTestAuthority(StratosGovernanceClient):
    mode = "allow"
    requests: list

    def __init__(self, settings):
        super().__init__(settings)
        self.requests = []
        self.bindings = {}

    def register_information_resource(self, **kwargs):
        self.bindings[kwargs["binding"].policy_binding_id] = kwargs["binding"]
        return super().register_information_resource(**kwargs)

    def register_budget_akb_resource(self, **kwargs):
        self.bindings[kwargs["binding"].policy_binding_id] = kwargs["binding"]
        return super().register_budget_akb_resource(**kwargs)

    def revalidate_document_admission(self, **kwargs):
        self.bindings[kwargs["binding"].policy_binding_id] = kwargs["binding"]
        return super().revalidate_document_admission(**kwargs)

    def _request(self, method, url, token, body, **kwargs):
        self.requests.append((method, url, deepcopy(body)))
        if self.mode == "unsupported":
            from app.access_governance import GovernanceUnavailable
            raise GovernanceUnavailable("Explicit test authority does not support document admission")
        raw = body["documentAdmission"]
        value = DocumentAdmissionExpectation.model_validate({key:raw[key] for key in (
            "rootSnapshot","currentRootSnapshot","versionSnapshot","correlationId")})
        parts = url.split("/")
        resource_type, resource_id = parts[-4:-2] if method == "POST" else parts[-2:]
        envelope = body.get("integrationEnvelope")
        binding = self.bindings[envelope["policyBindingId"] if envelope else body["policyBindingId"]]
        governed_id = body.get("governedResourceId") or f"gres-test-{resource_id}-{body['sourceVersion']}"
        scope = body["scope"]
        current_id = body.get("currentRootGovernedResourceId") or body.get("parentId")
        prepared = prepare_document_admission(value, resource_type=resource_type, resource_id=resource_id,
            source_version=body["sourceVersion"], policy_binding_id=binding.policy_binding_id,
            policy_hash=canonical_policy_hash(binding),scope=scope,
            current_root_governed_resource_id=current_id, operation=raw["operation"])
        now = datetime.now(timezone.utc)
        confirmation = {**prepared.expected_confirmation,"requestNonce":raw["requestNonce"],
            "schemaVersion":"stratos-document-admission-confirmation-1","decision":"ALLOW",
            "admissionId":"test-admission","revision":1,"governedResourceId":governed_id,
            "currentRootGovernedResourceId":current_id if value.version_snapshot else governed_id,
            "checkedAt":now.isoformat(),"expiresAt":(now+timedelta(seconds=30)).isoformat()}
        if self.mode == "deny": confirmation["decision"] = "DENY"
        if self.mode == "stale": confirmation["checkedAt"] = (now-timedelta(seconds=31)).isoformat()
        if self.mode == "wrong-owner": confirmation["currentAccountability"]["ownerSubjectId"] = "unconfirmed-other"
        response = {"id":governed_id,"application":"AKB","resourceType":resource_type,"resourceId":resource_id,
            "sourceVersion":body["sourceVersion"],"parentId":body.get("parentId"),"scope":scope,"isActive":True,
            "policyAssignment":"EXPLICIT","explicitPolicyBindingId":binding.policy_binding_id,"confirmedBySubjectId":"service:akb",
            "effectivePolicy":{"policyBindingId":binding.policy_binding_id,"policyHash":canonical_policy_hash(binding),
                "policyVersion":binding.policy_version,"originatorId":binding.originator_id,
                "originator":binding.originator_id,
                "issuedAt":binding.issued_at.isoformat(),"reviewAt":binding.review_at.isoformat() if binding.review_at else None},
            "documentAdmission":confirmation}
        if self.mode == "missing": response.pop("documentAdmission")
        if envelope:
            response.update(policyAssignment="INHERITED", explicitPolicyBindingId=None,
                inheritedFromResourceId=value.root_snapshot.provenance.source_governed_resource_id,
                registeredBySubjectId="service:akb", correlation_id=envelope["correlationId"],
                idempotency_key=envelope["idempotencyKey"])
        return response


@pytest.fixture
def verified_profile_authority(monkeypatch):
    from app import api, document_profile_runtime
    settings = api.get_settings()
    monkeypatch.setattr(settings,"stratos_policy_service_token","explicit-test-service-credential")
    monkeypatch.setattr(settings,"stratos_information_resources_url","https://test-authority.invalid/resources")
    monkeypatch.setattr(settings,"stratos_budget_akb_resources_url","https://test-authority.invalid/budget")
    monkeypatch.setattr(settings,"content_security_attestation_secret",INTAKE_SECRET)
    authority = VerifiedTestAuthority(settings)
    monkeypatch.setattr(api,"governance_client",lambda _settings:authority)
    monkeypatch.setattr(document_profile_runtime,"governance_client",lambda _settings:authority)
    yield authority
    authority.close()
