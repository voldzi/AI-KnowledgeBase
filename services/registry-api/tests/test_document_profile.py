from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

import httpx
import pytest

from app.access_governance import GovernanceInvalidResponse, StratosGovernanceClient
from app.document_profile import (
    DocumentAdmissionExpectation, DocumentAdmissionRequest, DocumentRootSnapshot,
    DocumentVersionSnapshot, document_snapshot_hash,
    prepare_document_admission, verify_document_admission_confirmation,
)
from app.information_policy import InformationPolicyBinding, IntegrationEnvelope, canonical_policy_hash
from test_access_governance import _settings
from test_stratos_budget_upload_bridge import _policy, _envelope, CONTRACT_ID, PARENT_RESOURCE, FINANCIAL_SCOPE

EXAMPLES = Path(__file__).parents[3] / "contracts/stratos/document-admission/v1"
NOW = datetime(2026, 9, 5, 12, 0, tzinfo=timezone.utc)


def expectation(*, version=False, budget=False):
    root = json.loads((EXAMPLES / "example-root.json").read_text())
    content = json.loads((EXAMPLES / "example-version.json").read_text()) if version else None
    if budget:
        root["provenance"] = {"sourceSystem": "STRATOS_BUDGET", "sourceRecordId": CONTRACT_ID,
                              "sourceGovernedResourceId": PARENT_RESOURCE}
        if content:
            content["sourceLineage"].update(root["provenance"])
            content["sourceLineage"]["sourceVersion"] = "sha256:" + "a" * 64
            content["rootSnapshotHash"] = document_snapshot_hash(root)
    return DocumentAdmissionExpectation.model_validate({
        "rootSnapshot": root, "currentRootSnapshot": root, "versionSnapshot": content,
        "correlationId": _envelope()["correlationId"] if budget else "corr-profile-fixture",
    })


def prepared(value):
    version = value.version_snapshot
    return prepare_document_admission(value, resource_type="document-version" if version else "document",
        resource_id=version.document_version_id if version else value.root_snapshot.document_id,
        source_version=version.document_version_id if version else value.root_snapshot.metadata_revision,
        policy_binding_id="pol_profilefixture01", policy_hash="sha256:" + "c" * 64,
        scope={"type": "organization", "id": "org_stratos"}, current_root_governed_resource_id="gir-root")


def proof(request, now=NOW):
    return {**request.expected_confirmation,
            "currentRootGovernedResourceId": request.expected_confirmation["currentRootGovernedResourceId"] or "gir-fixture", "schemaVersion": "stratos-document-admission-confirmation-1",
            "decision": "ALLOW", "admissionId": "admission-fixture", "revision": 1,
            "governedResourceId": "gir-fixture", "checkedAt": now.isoformat(),
            "expiresAt": (now + timedelta(seconds=30)).isoformat()}


@pytest.mark.parametrize("version", [False, True])
def test_exact_admission_confirmation_is_accepted(version):
    request = prepared(expectation(version=version))
    assert DocumentAdmissionRequest.model_validate(request.request)
    result = verify_document_admission_confirmation(proof(request), prepared=request,
                                                    governed_resource_id="gir-fixture", now=NOW)
    assert result.decision == "ALLOW"


@pytest.mark.parametrize("mutation", ["missing", "deny", "unknown", "owner", "gestor", "profile", "policy", "scope",
                                      "snapshot", "root", "resource", "version", "nonce", "actor", "expired", "old", "future", "long", "naive"])
def test_admission_confirmation_fails_closed(mutation):
    request = prepared(expectation(version=True))
    value = proof(request)
    if mutation == "missing": value = None
    elif mutation == "deny": value["decision"] = "DENY"
    elif mutation == "unknown": value["callerApproved"] = True
    elif mutation == "owner": value["accountability"] = {**value["accountability"], "ownerSubjectId": "other"}
    elif mutation == "gestor": value["accountability"] = {**value["accountability"], "gestor": {"kind": "person", "id": "other"}}
    elif mutation == "profile": value["profile"] = {**value["profile"], "revision": "other"}
    elif mutation in {"policy", "scope", "snapshot", "root"}: value[{"policy":"policyHash", "scope":"scopeHash", "snapshot":"snapshotHash", "root":"rootSnapshotHash"}[mutation]] = "sha256:" + "f" * 64
    elif mutation == "resource": value["governedResourceId"] = "other"
    elif mutation == "version": value["sourceVersion"] = "other"
    elif mutation == "nonce": value["requestNonce"] = "f" * 32
    elif mutation == "actor": value["confirmedBySubjectId"] = "service:other"
    elif mutation == "expired": value["expiresAt"] = NOW.isoformat()
    elif mutation == "old": value["checkedAt"] = (NOW - timedelta(seconds=31)).isoformat()
    elif mutation == "future": value["checkedAt"] = (NOW + timedelta(seconds=6)).isoformat()
    elif mutation == "long": value["expiresAt"] = (NOW + timedelta(seconds=61)).isoformat()
    elif mutation == "naive": value["checkedAt"] = "2026-09-05T12:00:00"
    with pytest.raises(ValueError):
        verify_document_admission_confirmation(value, prepared=request, governed_resource_id="gir-fixture", now=NOW)


def test_root_and_version_golden_hashes_and_source_revision_binding():
    value = expectation(version=True)
    golden = json.loads((EXAMPLES / "example-hashes.json").read_text())
    assert document_snapshot_hash(value.root_snapshot) == golden["root"]
    assert document_snapshot_hash(value.version_snapshot) == golden["version"]
    raw = value.model_dump(mode="json", by_alias=True)
    raw["rootSnapshot"]["accountability"]["ownerSubjectId"] = "new-owner"
    with pytest.raises(ValueError, match="exact root revision"):
        DocumentAdmissionExpectation.model_validate(raw)
    raw = value.model_dump(mode="json", by_alias=True)
    raw["versionSnapshot"]["sourceLineage"]["sourceVersion"] = "old-version"
    with pytest.raises(ValueError, match="exact immutable version"):
        DocumentAdmissionExpectation.model_validate(raw)


def test_native_root_identity_is_allocated_before_admission():
    raw = expectation().root_snapshot.model_dump(mode="json", by_alias=True)
    raw["provenance"]["sourceRecordId"] = "unrelated-client-id"
    with pytest.raises(ValueError): DocumentRootSnapshot.model_validate(raw)


def test_profile_lifecycle_does_not_invent_effectivity_for_a_record():
    raw = expectation(version=True).version_snapshot.model_dump(mode="json", by_alias=True)
    raw["lifecycle"].update(mode="record", recordedOn="2026-09-04")
    with pytest.raises(ValueError): DocumentVersionSnapshot.model_validate(raw)
    raw["lifecycle"].update(effectiveFrom=None)
    assert DocumentVersionSnapshot.model_validate(raw).lifecycle.recorded_on.isoformat() == "2026-09-04"


@pytest.mark.parametrize("budget", [False, True])
@pytest.mark.parametrize("mode", ["allow", "missing", "deny", "stale", "mismatch", "inactive"])
def test_real_governance_client_requires_atomic_confirmation(monkeypatch, budget, mode):
    value = expectation(version=True, budget=budget)
    binding = InformationPolicyBinding.model_validate(_policy())
    envelope = IntegrationEnvelope.model_validate(_envelope())
    scope = {"type": "budget_scope", "id": FINANCIAL_SCOPE}
    target = value.version_snapshot.document_version_id
    captured = []
    real_client = httpx.Client

    def respond(request):
        body = json.loads(request.content)
        supplied = DocumentAdmissionRequest.model_validate(body["documentAdmission"])
        captured.append(body)
        expected = prepared(value).expected_confirmation
        expected.update(policyBindingId=binding.policy_binding_id, policyHash=canonical_policy_hash(binding),
                        scopeHash=document_snapshot_hash(scope), requestNonce=supplied.request_nonce)
        confirmation = {**expected, "schemaVersion": "stratos-document-admission-confirmation-1", "decision": "ALLOW",
                        "admissionId": "admission-fixture", "revision": 1, "governedResourceId": "gir-fixture",
                        "checkedAt": datetime.now(timezone.utc).isoformat(),
                        "expiresAt": (datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat()}
        response = {"id": "gir-fixture", "application": "AKB", "resourceType": "document-version",
                    "resourceId": target, "sourceVersion": target, "parentId": "gir-root", "scope": scope,
                    "isActive": mode != "inactive", "policyAssignment": "INHERITED" if budget else "EXPLICIT",
                    "explicitPolicyBindingId": None if budget else binding.policy_binding_id,
                    "inheritedFromResourceId": PARENT_RESOURCE,
                    "registeredBySubjectId": "service:akb", "confirmedBySubjectId": "service:akb",
                    "effectivePolicy": {"policyBindingId": binding.policy_binding_id, "policyVersion": binding.policy_version,
                        "policyHash": canonical_policy_hash(binding), "originatorId": binding.originator_id, "originator": binding.originator_id,
                        "issuedAt": binding.issued_at.isoformat(), "reviewAt": None},
                    "correlation_id": envelope.correlation_id, "idempotency_key": envelope.idempotency_key}
        if mode == "deny": confirmation["decision"] = "DENY"
        if mode == "stale": confirmation["checkedAt"] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        if mode == "mismatch": confirmation["snapshotHash"] = "sha256:" + "f" * 64
        if mode != "missing": response["documentAdmission"] = confirmation
        return httpx.Response(200, json=response)

    monkeypatch.setattr("app.access_governance.httpx.Client", lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs))
    client = StratosGovernanceClient(_settings(AKL_STRATOS_INFORMATION_RESOURCES_URL="https://stratos.example/resources",
        AKL_STRATOS_BUDGET_AKB_RESOURCES_URL="https://stratos.example/budget", AKB_POLICY_SERVICE_TOKEN="fixture-credential"))
    def register():
        common = dict(resource_type="document-version", resource_id=target, source_version=target, title="Example", scope=scope,
                      binding=binding, reason="Contract test", document_admission=value)
        if budget:
            return client.register_budget_akb_resource(**common, parent_id="gir-root", inherited_from_resource_id=PARENT_RESOURCE, envelope=envelope)
        return client.register_information_resource(**common, credential_token="fixture-credential", audit_actor_subject_id="example-owner", parent_resource_id="gir-root")
    if mode == "allow": assert register().document_admission.decision == "ALLOW"
    else:
        with pytest.raises(GovernanceInvalidResponse): register()
    assert len(captured) == 1
    assert captured[0]["documentAdmission"]["versionSnapshot"]["sourceLineage"]["contentSha256"] == value.version_snapshot.source_lineage.content_sha256


def test_budget_profile_lineage_mismatch_stops_before_transport(monkeypatch):
    value = expectation(version=True, budget=True).model_dump(mode="json", by_alias=True)
    value["rootSnapshot"]["provenance"]["sourceRecordId"] = "another-contract"
    value["versionSnapshot"]["sourceLineage"]["sourceRecordId"] = "another-contract"
    value["versionSnapshot"]["rootSnapshotHash"] = document_snapshot_hash(value["rootSnapshot"])
    expected = DocumentAdmissionExpectation.model_validate(value)
    client = StratosGovernanceClient(_settings(AKL_STRATOS_BUDGET_AKB_RESOURCES_URL="https://stratos.example/budget",
                                             AKB_POLICY_SERVICE_TOKEN="fixture-credential"))
    monkeypatch.setattr(client, "_request", lambda *_args, **_kwargs: pytest.fail("Invalid lineage must not reach transport"))
    with pytest.raises(ValueError, match="source lineage"):
        client.register_budget_akb_resource(resource_type="document-version", resource_id=expected.version_snapshot.document_version_id,
            source_version=expected.version_snapshot.document_version_id, title="Example", scope={"type":"budget_scope","id":FINANCIAL_SCOPE},
            binding=InformationPolicyBinding.model_validate(_policy()), envelope=IntegrationEnvelope.model_validate(_envelope()),
            reason="Contract test", document_admission=expected, parent_id="gir-root", inherited_from_resource_id=PARENT_RESOURCE)


def test_checked_in_contract_schema_matches_models():
    from pydantic.json_schema import models_json_schema
    from app.document_profile import DocumentAdmissionConfirmation
    _, generated = models_json_schema([(model, "validation") for model in (
        DocumentRootSnapshot, DocumentVersionSnapshot, DocumentAdmissionRequest, DocumentAdmissionConfirmation)])
    stored = json.loads((EXAMPLES / "contract.schema.json").read_text())
    assert stored["$defs"] == generated["$defs"]


def test_document_intake_readiness_is_blocked_while_infrastructure_remains_ready(client):
    from test_ingestion_authorization import _ingestion_service_headers
    response = client.get("/api/v1/integrations/ingestion/readiness",
                          headers=_ingestion_service_headers("corr-profile-readiness"))
    assert response.status_code == 503, response.text
    error = response.json()["error"]
    assert error["code"] == "document_profile_admission_unavailable"
    assert error["details"] == {"status":"blocked", "document_profile_admission":"unsupported",
                                "reason_codes":["STRATOS_DOCUMENT_ADMISSION_CONTRACT_PENDING"]}
    assert client.get("/health").status_code == 200
    assert client.get("/ready").json()["status"] == "ready"


def test_historical_version_revalidation_uses_current_accountability_without_rewriting_history():
    raw = expectation(version=True).model_dump(mode="json", by_alias=True)
    original_hash = raw["versionSnapshot"]["rootSnapshotHash"]
    raw["currentRootSnapshot"]["metadataRevision"] = "metadata-2"
    raw["currentRootSnapshot"]["accountability"]["ownerSubjectId"] = "new-active-owner"
    value = DocumentAdmissionExpectation.model_validate(raw)
    common = dict(resource_type="document-version", resource_id=value.version_snapshot.document_version_id,
                  source_version=value.version_snapshot.document_version_id, policy_binding_id="pol_profilefixture01",
                  policy_hash="sha256:" + "c" * 64, scope={"type":"organization","id":"org_stratos"},
                  current_root_governed_resource_id="gir-current-root")
    with pytest.raises(ValueError, match="current root"):
        prepare_document_admission(value, **common)
    request = prepare_document_admission(value, operation="revalidate", **common)
    result = verify_document_admission_confirmation(proof(request), prepared=request,
                                                   governed_resource_id="gir-fixture", now=NOW)
    assert result.current_accountability.owner_subject_id == "new-active-owner"
    assert result.accountability.owner_subject_id == value.root_snapshot.accountability.owner_subject_id
    assert result.root_snapshot_hash == original_hash
    assert result.current_root_snapshot_hash != original_hash
    stale = proof(request)
    stale["currentAccountability"] = stale["accountability"]
    with pytest.raises(ValueError, match="exact request"):
        verify_document_admission_confirmation(stale, prepared=request, governed_resource_id="gir-fixture", now=NOW)


@pytest.mark.parametrize("field", ["currentRootSnapshotHash", "currentMetadataRevision", "currentRootGovernedResourceId",
                                  "currentProfile", "operation"])
def test_current_root_authority_fields_cannot_be_substituted(field):
    request = prepared(expectation(version=True))
    value = proof(request)
    value[field] = {"id":"akb.contract","revision":"1"} if field == "currentProfile" else (
        "sha256:" + "f" * 64 if field.endswith("Hash") else "revalidate" if field == "operation" else "other")
    with pytest.raises(ValueError):
        verify_document_admission_confirmation(value, prepared=request, governed_resource_id="gir-fixture", now=NOW)
