"""Append-only profile persistence inside the caller's existing transaction.

These helpers never commit or manufacture authority. The caller must have
obtained an atomic confirmation for the exact prepared request and must retain
its existing actor, policy, byte-integrity and workflow gates.
"""
from datetime import timezone

from sqlalchemy import select

from app.access_governance import GovernanceInvalidResponse
from app.document_profile import (
    DocumentAdmissionRequest, document_snapshot_hash,
    verify_document_admission_confirmation,
)
from app.models import Document, DocumentProfileRootRevision, DocumentProfileVersionSnapshot


class DocumentProfileConflict(ValueError):
    pass


def _verified_registration(registration):
    prepared = registration.admission_request
    confirmation = registration.document_admission
    if prepared is None or confirmation is None:
        raise GovernanceInvalidResponse("Document profile persistence requires a fresh atomic admission confirmation")
    governed_id = getattr(registration, "governed_resource_id", None) or registration.resource_id
    try:
        verified = verify_document_admission_confirmation(
            confirmation.model_dump(mode="json", by_alias=True),
            prepared=prepared, governed_resource_id=governed_id,
        )
        request = DocumentAdmissionRequest.model_validate(prepared.request)
        if request.operation != "register":
            raise ValueError("Read revalidation cannot create an immutable snapshot")
    except ValueError as exc:
        raise GovernanceInvalidResponse("Document profile confirmation is no longer valid for persistence") from exc
    return request, verified


def _lock_current_revision(db, document, expected):
    current = db.execute(select(Document.profile_metadata_revision).where(
        Document.document_id == document.document_id,
    ).with_for_update()).first()
    actual = current[0] if current is not None else None
    if current is None and document not in db.new:
        raise DocumentProfileConflict("Document does not exist in this admission transaction")
    if actual != expected:
        raise DocumentProfileConflict("Current root metadata changed during document admission")


def _matches_policy(record, proof):
    scope = {"type": record.governance_scope_type}
    if record.governance_scope_type == "own":
        scope["ownerSubjectId"] = record.governance_scope_owner_subject_id
    else:
        scope["id"] = record.governance_scope_id
    return (record.policy_binding_id == proof.policy_binding_id
            and record.policy_version == proof.policy_version
            and record.policy_hash == proof.policy_hash
            and document_snapshot_hash(scope) == proof.scope_hash)


def persist_root_revision(db, *, document, registration, expected_current_revision, actor_subject_id):
    request, proof = _verified_registration(registration)
    root = request.root_snapshot
    if (request.version_snapshot is not None or proof.resource_type != "document"
        or proof.resource_id != document.document_id or root.document_id != document.document_id
        or root.document_type != document.document_type or root.organization_id != document.organization_id
        or proof.source_version != root.metadata_revision
        or not _matches_policy(document, proof)
        or document.governed_resource_id != proof.governed_resource_id
        or document.governed_source_version != proof.source_version
        or root.accountability.owner_subject_id != document.owner_id
        or document.gestor_unit != (root.accountability.gestor.id if root.accountability.gestor.kind == "organization_unit" else None)
        or not actor_subject_id):
        raise DocumentProfileConflict("Root snapshot does not match the admitted document")
    _lock_current_revision(db, document, expected_current_revision)
    existing = db.scalar(select(DocumentProfileRootRevision).where(
        DocumentProfileRootRevision.document_id == document.document_id,
        DocumentProfileRootRevision.metadata_revision == root.metadata_revision,
    ))
    snapshot_hash = document_snapshot_hash(root)
    if existing is not None:
        if existing.snapshot_hash != snapshot_hash or expected_current_revision != root.metadata_revision:
            raise DocumentProfileConflict("Root revision replay cannot replace or restore historical metadata")
        return existing
    record = DocumentProfileRootRevision(
        document_id=document.document_id, metadata_revision=root.metadata_revision,
        snapshot_hash=snapshot_hash, profile_id=root.profile.id, profile_revision=root.profile.revision,
        payload=root.model_dump(mode="json", by_alias=True),
        admission_confirmation=proof.model_dump(mode="json", by_alias=True), created_by=actor_subject_id,
    )
    db.add(record)
    document.profile_metadata_revision = root.metadata_revision
    db.flush()
    db.expire(document, ["current_profile_revision"])
    return record


def persist_version_snapshot(db, *, document, version, file, registration,
                             expected_current_revision, actor_subject_id):
    request, proof = _verified_registration(registration)
    snapshot = request.version_snapshot
    if (snapshot is None or proof.resource_type not in {"document-version", "document_version"}
        or version.document_id != document.document_id or snapshot.document_id != document.document_id
        or proof.resource_id != version.document_version_id
        or snapshot.document_version_id != version.document_version_id
        or not _matches_policy(version, proof)
        or version.governed_resource_id != proof.governed_resource_id
        or version.governed_source_version != proof.source_version
        or version.governed_parent_resource_id != proof.current_root_governed_resource_id
        or version.valid_from != snapshot.lifecycle.effective_from or version.valid_to != snapshot.lifecycle.effective_to
        or expected_current_revision != snapshot.root_metadata_revision
        or not actor_subject_id):
        raise DocumentProfileConflict("Version snapshot does not match the admitted immutable version")
    _lock_current_revision(db, document, expected_current_revision)
    root = db.scalar(select(DocumentProfileRootRevision).where(
        DocumentProfileRootRevision.document_id == document.document_id,
        DocumentProfileRootRevision.metadata_revision == snapshot.root_metadata_revision,
    ))
    if root is None or root.snapshot_hash != snapshot.root_snapshot_hash or document_snapshot_hash(root.payload) != root.snapshot_hash:
        raise DocumentProfileConflict("The version must preserve an existing immutable root snapshot")
    source = snapshot.source_lineage
    scanned_at = file.content_security_scanned_at
    if scanned_at is not None and scanned_at.tzinfo is None:
        scanned_at = scanned_at.replace(tzinfo=timezone.utc)
    if (file.document_id != document.document_id or file.document_version_id != version.document_version_id
        or file.uri != version.source_file_uri or file.uri != source.content_uri
        or file.sha256 != version.file_hash or file.sha256 != source.content_sha256
        or file.content_security_status != "clean"
        or file.content_security_attestation_sha256 != source.intake_receipt_id
        or scanned_at != source.captured_at):
        raise DocumentProfileConflict("Version snapshot is not bound to its verified source file and intake receipt")
    existing = db.get(DocumentProfileVersionSnapshot, version.document_version_id)
    snapshot_hash = document_snapshot_hash(snapshot)
    if existing is not None:
        if existing.snapshot_hash != snapshot_hash or existing.file_id != file.file_id:
            raise DocumentProfileConflict("An immutable version profile cannot be replaced")
        return existing
    record = DocumentProfileVersionSnapshot(
        document_version_id=version.document_version_id, document_id=document.document_id,
        root_metadata_revision=snapshot.root_metadata_revision, root_snapshot_hash=snapshot.root_snapshot_hash,
        snapshot_hash=snapshot_hash, file_id=file.file_id, payload=snapshot.model_dump(mode="json", by_alias=True),
        admission_confirmation=proof.model_dump(mode="json", by_alias=True), created_by=actor_subject_id,
    )
    db.add(record)
    db.flush()
    db.expire(version, ["profile_snapshot"])
    return record
