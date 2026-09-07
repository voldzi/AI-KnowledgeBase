from copy import deepcopy
from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.access_governance import GovernedResourceRegistration, GovernanceInvalidResponse
from app.document_profile import DocumentAdmissionExpectation, verify_document_admission_confirmation
from app.document_profile_storage import DocumentProfileConflict, persist_root_revision, persist_version_snapshot
from app.models import Document, DocumentVersion, DocumentFile, DocumentProfileRootRevision, DocumentProfileVersionSnapshot
from app.schemas import DocumentResponse, DocumentVersionResponse
from test_document_profile import expectation, prepared, proof


def registration(value):
    """Explicit test authority; the same production nonce/hash/freshness verifier runs."""
    request = prepared(value)
    confirmation = verify_document_admission_confirmation(proof(request, datetime.now(timezone.utc)),
        prepared=request, governed_resource_id="gir-fixture")
    return GovernedResourceRegistration(resource_id="gir-fixture", source_version=confirmation.source_version,
        policy_binding_id=confirmation.policy_binding_id, policy_hash=confirmation.policy_hash,
        document_admission=confirmation, admission_request=request)


def admitted_document(db):
    value = expectation()
    root = value.root_snapshot
    authority = registration(value)
    document = Document(document_id=root.document_id, title="Explicit profile fixture", document_type=root.document_type,
        organization_id="org_stratos", governance_scope_type="organization", governance_scope_id="org_stratos",
        gestor_unit=root.accountability.gestor.id,
        owner_id=root.accountability.owner_subject_id, policy_binding_id=authority.policy_binding_id,
        policy_version="information-policy-2.0.0", policy_hash=authority.policy_hash,
        governed_resource_id=authority.resource_id, governed_source_version=root.metadata_revision)
    db.add(document)
    stored = persist_root_revision(db, document=document, registration=authority,
                                  expected_current_revision=None, actor_subject_id="test-authority-actor")
    return document, stored


def version_records(db, document):
    value = expectation(version=True)
    snapshot = value.version_snapshot
    source = snapshot.source_lineage
    authority = registration(value)
    version = DocumentVersion(document_version_id=snapshot.document_version_id, document_id=document.document_id,
        governance_scope_type="organization", governance_scope_id="org_stratos",
        governed_parent_resource_id="gir-root", valid_from=snapshot.lifecycle.effective_from,
        valid_to=snapshot.lifecycle.effective_to,
        version_label="1.0", source_file_uri=source.content_uri, file_hash=source.content_sha256,
        policy_binding_id=authority.policy_binding_id, policy_version="information-policy-2.0.0",
        policy_hash=authority.policy_hash, governed_resource_id=authority.resource_id,
        governed_source_version=snapshot.document_version_id)
    file = DocumentFile(file_id="file-profile-fixture", document_id=document.document_id,
        document_version_id=version.document_version_id, uri=source.content_uri, sha256=source.content_sha256,
        content_security_status="clean", content_security_attestation_sha256=source.intake_receipt_id,
        content_security_scanned_at=source.captured_at)
    db.add_all([version, file])
    return version, file, authority


def store_version(db, document, version, file, authority):
    return persist_version_snapshot(db, document=document, version=version, file=file, registration=authority,
        expected_current_revision=document.profile_metadata_revision, actor_subject_id="test-authority-actor")


def test_owner_transfer_appends_root_and_preserves_immutable_version(db_session):
    document, original = admitted_document(db_session)
    version, file, authority = version_records(db_session, document)
    historical = store_version(db_session, document, version, file, authority)
    old_payload = deepcopy(original.payload)
    old_version = deepcopy(historical.payload)
    old_revision = document.profile_metadata_revision
    next_root = expectation().model_dump(mode="json", by_alias=True)
    for key in ("rootSnapshot", "currentRootSnapshot"):
        next_root[key]["metadataRevision"] = "metadata-2"
        next_root[key]["accountability"]["ownerSubjectId"] = "new-active-owner"
    document.owner_id = "new-active-owner"
    document.governed_source_version = "metadata-2"
    updated = persist_root_revision(db_session, document=document,
        registration=registration(DocumentAdmissionExpectation.model_validate(next_root)),
        expected_current_revision=old_revision, actor_subject_id="test-authority-transfer")
    assert document.profile_metadata_revision == "metadata-2"
    assert updated.snapshot_hash != original.snapshot_hash
    assert original.payload == old_payload
    assert historical.payload == old_version
    assert historical.root_metadata_revision == old_revision
    assert db_session.scalar(select(func.count()).select_from(DocumentProfileRootRevision)) == 2
    current_response = DocumentResponse.model_validate(document)
    version_response = DocumentVersionResponse.model_validate(version)
    assert current_response.current_root_metadata_revision == "metadata-2"
    assert current_response.document_profile.accountability.owner_subject_id == "new-active-owner"
    assert version_response.root_metadata_revision == old_revision
    assert version_response.document_profile.accountability.owner_subject_id == "example-owner"
    assert version_response.root_snapshot_hash == original.snapshot_hash
    assert version_response.version_snapshot_hash == historical.snapshot_hash


@pytest.mark.parametrize("mutation", ["policy", "scope", "governed", "owner", "gestor", "stale-revision", "actor"])
def test_root_snapshot_mismatch_cannot_be_persisted(db_session, mutation):
    document, _ = admitted_document(db_session)
    authority = registration(expectation())
    if mutation == "policy": document.policy_hash = "sha256:" + "f" * 64
    elif mutation == "scope": document.governance_scope_id = "another-organization"
    elif mutation == "governed": document.governed_resource_id = "another-resource"
    elif mutation == "owner": document.owner_id = "another-owner"
    elif mutation == "gestor": document.gestor_unit = "another-unit"
    with pytest.raises(DocumentProfileConflict):
        persist_root_revision(db_session, document=document, registration=authority,
            expected_current_revision="stale" if mutation == "stale-revision" else document.profile_metadata_revision,
            actor_subject_id="" if mutation == "actor" else "test-authority-actor")
    assert db_session.scalar(select(func.count()).select_from(DocumentProfileRootRevision)) == 1


@pytest.mark.parametrize("mutation", ["uri", "hash", "receipt", "scan", "capture", "file-version", "policy", "root", "parent", "dates"])
def test_version_profile_requires_exact_verified_bytes_and_root(db_session, mutation):
    document, _ = admitted_document(db_session)
    version, file, authority = version_records(db_session, document)
    if mutation == "uri": file.uri = "s3://other"
    elif mutation == "hash": file.sha256 = "sha256:" + "f" * 64
    elif mutation == "receipt": file.content_security_attestation_sha256 = "different-receipt"
    elif mutation == "scan": file.content_security_status = "pending"
    elif mutation == "capture": file.content_security_scanned_at = None
    elif mutation == "file-version": file.document_version_id = "another-version"
    elif mutation == "policy": version.policy_hash = "sha256:" + "f" * 64
    elif mutation == "root": document.profile_metadata_revision = "nonexistent-root"
    elif mutation == "parent": version.governed_parent_resource_id = "another-root"
    elif mutation == "dates": version.valid_from = None
    with pytest.raises(DocumentProfileConflict): store_version(db_session, document, version, file, authority)
    assert db_session.scalar(select(func.count()).select_from(DocumentProfileVersionSnapshot)) == 0


def test_unconfirmed_registration_never_persists_snapshot(db_session):
    value = expectation().root_snapshot
    document = Document(document_id=value.document_id, title="No confirmation", document_type="directive", owner_id="owner")
    db_session.add(document)
    missing = GovernedResourceRegistration(resource_id="gir-fixture", source_version=value.metadata_revision,
                                           policy_binding_id="pol", policy_hash="sha256:" + "f" * 64)
    with pytest.raises(GovernanceInvalidResponse):
        persist_root_revision(db_session, document=document, registration=missing,
                              expected_current_revision=None, actor_subject_id="test-actor")
    assert db_session.scalar(select(func.count()).select_from(DocumentProfileRootRevision)) == 0


@pytest.mark.parametrize("table", ["document_profile_root_revisions", "document_profile_version_snapshots"])
@pytest.mark.parametrize("operation", ["UPDATE", "DELETE"])
def test_database_rejects_snapshot_mutation_including_bulk_sql(db_session, table, operation):
    document, _ = admitted_document(db_session)
    version, file, authority = version_records(db_session, document)
    store_version(db_session, document, version, file, authority)
    db_session.commit()
    statement = f"UPDATE {table} SET created_by = 'tamper'" if operation == "UPDATE" else f"DELETE FROM {table}"
    with pytest.raises(IntegrityError, match="append-only"):
        db_session.execute(text(statement))
    db_session.rollback()
    assert db_session.scalar(select(func.count()).select_from(DocumentProfileRootRevision)) == 1
    assert db_session.scalar(select(func.count()).select_from(DocumentProfileVersionSnapshot)) == 1
