"""Mandatory snapshot gates shared by Registry writes and activation paths."""
from datetime import timezone
from uuid import uuid4

from app.access_governance import GovernanceDenied, GovernanceUnavailable, governance_client
from app.config import get_settings
from app.document_profile import (
    DocumentAdmissionExpectation, DocumentRootSnapshot, DocumentSourceLineage,
    DocumentVersionSnapshot, document_snapshot_hash,
)
from app.document_profile_catalog import document_profile
from app.errors import problem
from app.information_policy import InformationPolicyBinding
from app.middleware import get_correlation_id


def require_current_root(document):
    record = document.current_profile_revision
    if record is None:
        raise problem(409, "document_profile_required", "An admitted current document profile is required")
    try:
        root = DocumentRootSnapshot.model_validate(record.payload)
        if (document_snapshot_hash(root) != record.snapshot_hash
            or root.document_id != document.document_id
            or root.metadata_revision != document.profile_metadata_revision
            or root.metadata_revision != document.governed_source_version
            or root.document_type != document.document_type
            or root.accountability.owner_subject_id != document.owner_id
            or document.gestor_unit != (root.accountability.gestor.id if root.accountability.gestor.kind == "organization_unit" else None)):
            raise ValueError("Current root projection differs")
        return root
    except ValueError as exc:
        raise problem(409, "document_profile_conflict", "The current document profile is inconsistent") from exc


def require_profile_assignments(root, assignments):
    active = [row for row in assignments if getattr(row, "active", True)]
    def exact(role, kind, subject):
        matches = [row for row in active if row.role == role and row.is_primary]
        return len(matches) == 1 and matches[0].subject_type == kind and matches[0].subject_id == subject
    if not exact("owner", "user", root.accountability.owner_subject_id) or not exact(
        "gestor", "user" if root.accountability.gestor.kind == "person" else "unit", root.accountability.gestor.id):
        raise problem(422, "document_profile_assignment_mismatch", "Primary owner and gestor assignments must exactly match the profile")
    if document_profile(root.profile.id, root.profile.revision).get("publicationRequiresIndependentApproval"):
        approvers = [row for row in active if row.role == "approver" and row.is_primary]
        if len(approvers) != 1:
            raise problem(422, "document_profile_approver_required", "The selected profile requires an explicit primary approver")


def requires_independent_profile_approval(document):
    root = require_current_root(document)
    return document_profile(root.profile.id, root.profile.revision).get("publicationRequiresIndependentApproval", False)


def source_lineage_from_verified_file(root, version, file, *, source_version=None):
    captured = file.content_security_scanned_at
    if captured is not None and captured.tzinfo is None:
        captured = captured.replace(tzinfo=timezone.utc)
    if (file.content_security_status != "clean" or not file.content_security_attestation_sha256
        or captured is None or not file.sha256 or file.sha256 != version.file_hash
        or file.uri != version.source_file_uri):
        raise problem(409, "document_profile_verified_source_required", "A clean exact file and verified intake receipt are required for the version profile")
    if root.provenance.source_system != "AKB" and not source_version:
        raise problem(422, "document_profile_source_version_required", "Imported content requires an exact authoritative source version")
    try:
        return DocumentSourceLineage.model_validate({
            **root.provenance.model_dump(mode="json", by_alias=True),
            "sourceVersion": source_version or version.document_version_id,
            "contentSha256": file.sha256, "contentUri": file.uri,
            "intakeReceiptId": file.content_security_attestation_sha256, "capturedAt": captured,
        })
    except ValueError as exc:
        raise problem(422, "document_profile_source_invalid", "Source hash, identity or receipt coordinates are invalid") from exc


def require_fresh_document_profile(document, *, version=None, actor_id):
    current = require_current_root(document)
    root, snapshot = current, None
    target = version or document
    try:
        if version is not None:
            stored = version.profile_snapshot
            if stored is None:
                raise ValueError("Missing version profile")
            root = DocumentRootSnapshot.model_validate(stored.root_revision.payload)
            snapshot = DocumentVersionSnapshot.model_validate(stored.payload)
            if (snapshot.document_version_id != version.document_version_id
                or snapshot.document_id != document.document_id
                or version.governed_source_version != version.document_version_id
                or document_snapshot_hash(root) != stored.root_snapshot_hash
                or document_snapshot_hash(snapshot) != stored.snapshot_hash
                or version.source_file_uri != snapshot.source_lineage.content_uri
                or version.file_hash != snapshot.source_lineage.content_sha256
                or version.valid_from != snapshot.lifecycle.effective_from
                or version.valid_to != snapshot.lifecycle.effective_to):
                raise ValueError("Immutable source profile differs")
        expectation = DocumentAdmissionExpectation(root_snapshot=root, current_root_snapshot=current,
            version_snapshot=snapshot, correlation_id=get_correlation_id() or f"admission-{uuid4().hex}")
        if not target.governed_resource_id or not document.governed_resource_id:
            raise ValueError("Missing governed identity")
        policy = InformationPolicyBinding.model_validate(target.policy_summary)
    except ValueError as exc:
        raise problem(409, "document_profile_conflict", "An exact immutable admitted profile is required") from exc
    scope = {"type": target.governance_scope_type}
    if target.governance_scope_type == "own": scope["ownerSubjectId"] = target.governance_scope_owner_subject_id
    else: scope["id"] = target.governance_scope_id
    resource_type = "document" if version is None else (
        "document-version" if root.provenance.source_system == "STRATOS_BUDGET" else "document_version")
    try:
        return governance_client(get_settings()).revalidate_document_admission(
            document_admission=expectation, resource_type=resource_type,
            resource_id=target.document_version_id if version is not None else document.document_id,
            source_version=target.governed_source_version, governed_resource_id=target.governed_resource_id,
            current_root_governed_resource_id=document.governed_resource_id,
            binding=policy, scope=scope, audit_actor_subject_id=actor_id,
        )
    except GovernanceDenied as exc:
        raise problem(403, "document_profile_admission_denied", "STRATOS denied the current document profile") from exc
    except GovernanceUnavailable as exc:
        raise problem(503, "document_profile_admission_unavailable", "Fresh atomic document profile confirmation is unavailable") from exc
    except ValueError as exc:
        raise problem(409, "document_profile_conflict", "The current resource does not match its admitted immutable profile") from exc
