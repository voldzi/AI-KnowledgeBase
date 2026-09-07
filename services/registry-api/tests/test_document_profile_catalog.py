import json
from pathlib import Path

import pytest
from pydantic.json_schema import models_json_schema

from app.document_profile import DocumentAdmissionExpectation, DocumentSourceLineage
from app.document_profile_catalog import document_profile_catalog, validate_profile_policy
from app.document_profile_inputs import (
    DocumentProfileInput, DocumentVersionProfileInput, build_root_snapshot, build_version_snapshot,
)
from app.information_policy import InformationPolicyBinding
from test_document_profile import expectation
from test_stratos_budget_upload_bridge import _policy

CONTRACT = Path(__file__).parents[3] / "contracts/akb/document-profiles/v1"


def inputs():
    value = expectation(version=True)
    root = value.root_snapshot.model_dump(mode="json", by_alias=True)
    root = {key: root[key] for key in ("profile", "authorship", "provenance", "accountability")}
    root["provenance"].update(sourceRecordId=None, sourceGovernedResourceId=None)
    version = value.version_snapshot
    return root, {"expected_root_metadata_revision": value.root_snapshot.metadata_revision,
                  "lifecycle": version.lifecycle.model_dump(mode="json", by_alias=True),
                  "domain_evidence": version.domain_evidence}


def test_shared_catalog_and_input_schema_are_identical_to_runtime():
    original = json.loads((CONTRACT / "catalog.json").read_text())
    assert document_profile_catalog() == original
    assert len(original["profiles"]) == 5
    assert all("attachment" in profile["documentTypes"] for profile in original["profiles"])
    web = CONTRACT.parents[3] / "apps/web/src/lib/documents/document-profile-catalog.json"
    assert json.loads(web.read_text()) == original
    _, generated = models_json_schema([(DocumentProfileInput, "validation"), (DocumentVersionProfileInput, "validation")])
    assert json.loads((CONTRACT / "inputs.schema.json").read_text())["$defs"] == generated["$defs"]


def test_native_input_allocates_source_identity_and_binds_verified_version():
    root_input, version_input = inputs()
    existing = expectation(version=True)
    root = build_root_snapshot(DocumentProfileInput.model_validate(root_input),
        document_id=existing.root_snapshot.document_id, metadata_revision=existing.root_snapshot.metadata_revision,
        document_type=existing.root_snapshot.document_type)
    assert root.provenance.source_record_id == root.document_id
    version = build_version_snapshot(DocumentVersionProfileInput.model_validate(version_input), root=root,
        document_version_id=existing.version_snapshot.document_version_id, verified_source=existing.version_snapshot.source_lineage)
    assert version.root_snapshot_hash == existing.version_snapshot.root_snapshot_hash
    assert DocumentAdmissionExpectation(root_snapshot=root, current_root_snapshot=root, version_snapshot=version,
                                        correlation_id="corr-test")


@pytest.mark.parametrize("mutation", ["author", "gestor", "profile", "revision", "native-source", "missing-source"])
def test_incomplete_profile_input_is_rejected(mutation):
    root, _ = inputs()
    if mutation == "author": root["authorship"] = []
    elif mutation == "gestor": root["accountability"]["gestor"]["id"] = ""
    elif mutation == "profile": root["profile"]["id"] = "unapproved-family"
    elif mutation == "revision": root["profile"]["revision"] = "999"
    elif mutation == "native-source": root["provenance"]["sourceRecordId"] = "caller-guessed"
    elif mutation == "missing-source": root["provenance"]["sourceSystem"] = "STRATOS_BUDGET"
    with pytest.raises(ValueError): DocumentProfileInput.model_validate(root)


@pytest.mark.parametrize("mutation", ["extra", "missing", "empty", "date", "stale", "review", "retention"])
def test_version_profile_cannot_skip_catalog_evidence(mutation):
    _, raw = inputs()
    existing = expectation(version=True)
    if mutation == "extra": raw["domain_evidence"]["arbitraryApproval"] = True
    elif mutation == "missing": del raw["domain_evidence"]["issuerReference"]
    elif mutation == "empty": raw["domain_evidence"]["issuerReference"] = " "
    elif mutation == "date": raw["lifecycle"]["effectiveFrom"] = None
    elif mutation == "stale": raw["expected_root_metadata_revision"] = "stale-revision"
    elif mutation == "review": raw["lifecycle"]["reviewAt"] = None
    elif mutation == "retention": raw["lifecycle"]["retentionRuleId"] = "invented-retention"
    with pytest.raises(ValueError):
        build_version_snapshot(DocumentVersionProfileInput.model_validate(raw), root=existing.root_snapshot,
            document_version_id=existing.version_snapshot.document_version_id, verified_source=existing.version_snapshot.source_lineage)


def test_meeting_event_date_and_record_creation_date_are_independent():
    root_input, version_input = inputs()
    root_input["profile"]["id"] = "akb.meeting-project-record"
    root = build_root_snapshot(DocumentProfileInput.model_validate(root_input),
                              document_id="doc-meeting", metadata_revision="metadata-1", document_type="meeting_record")
    version_input["expected_root_metadata_revision"] = root.metadata_revision
    version_input["lifecycle"].update(mode="record", effectiveFrom=None, effectiveTo=None, recordedOn="2026-09-05")
    version_input["domain_evidence"] = {"family":"meeting_project_record", "eventDate":"2026-09-04",
                                         "recordReference":"meeting-1", "projectReference":None}
    lineage = expectation(version=True).version_snapshot.source_lineage.model_dump(mode="json", by_alias=True)
    lineage.update(sourceRecordId="doc-meeting", sourceVersion="ver-meeting")
    version = build_version_snapshot(DocumentVersionProfileInput.model_validate(version_input), root=root,
        document_version_id="ver-meeting", verified_source=DocumentSourceLineage.model_validate(lineage))
    assert version.lifecycle.recorded_on.isoformat() == "2026-09-05"
    assert version.domain_evidence["eventDate"] == "2026-09-04"


def test_official_profile_does_not_turn_internal_policy_into_public():
    root, _ = inputs()
    root["profile"]["id"] = "akb.official-public-reference"
    reference = DocumentProfileInput.model_validate(root).profile
    with pytest.raises(ValueError, match="Protection policy"):
        validate_profile_policy(reference, InformationPolicyBinding.model_validate(_policy()))
