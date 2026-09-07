"""Exact receipt replay for native and dedicated source intake. Database uniqueness is the durability boundary.

The session identity comes only from an authenticated intake receipt. A new
scan of the same session cannot establish a second version: its receipt must
also equal the first admitted receipt. Stored lineage and admission proofs are
never rewritten. Dedicated source callers additionally bind the unique identity
to the immutable source revision. This module performs no source/object reads or registration.
"""
from datetime import timezone
from hashlib import sha256

from sqlalchemy import select

from app.document_profile import document_snapshot_hash
from app.document_profile_inputs import build_version_snapshot
from app.document_profile_runtime import require_current_root, require_fresh_document_profile, source_lineage_from_verified_file
from app.errors import problem
from app.models import DocumentVersion
from app.permissions import Action, require_document_action, require_document_version_action


def native_intake_identity(root, attestation, *, uploaded_by, actor_id):
    if root.provenance.source_system not in {"AKB", "STRATOS_PROJECTFLOW", "STRATOS_ARCHFLOW"}:
        return None
    if uploaded_by is not None and uploaded_by != actor_id:
        raise problem(403, "native_intake_actor_mismatch", "Native file creator must be the authenticated actor")
    session = attestation.upload_session_id if attestation is not None else None
    if (not isinstance(session, str) or not session.strip() or session != session.strip()
        or len(session) > 160 or attestation.status != "clean" or attestation.engine != "clamav"):
        raise problem(409, "native_intake_identity_required", "A clean authenticated native intake session is required")
    return sha256(("akb-native-intake-session-1:" + session).encode()).hexdigest()


def find_native_intake(db, document_id, session_hash):
    if session_hash is None:
        return None
    return db.scalar(select(DocumentVersion).where(
        DocumentVersion.document_id == document_id,
        DocumentVersion.native_intake_session_hash == session_hash,
    ))


def require_exact_native_replay(db, *, document, version, payload, attestation, principal, binding_columns):
    # Also used after a uniqueness race rolls back: authority and current root
    # must be obtained afresh, never reused from the losing transaction.
    require_document_action(principal, Action.document_version_create, document, db)
    root = require_current_root(document)
    stored = version.profile_snapshot
    file = next((item for item in version.files if stored is not None and item.file_id == stored.file_id), None)
    expected_scope = payload.governance_scope
    scope = (expected_scope.type, expected_scope.id, expected_scope.owner_subject_id) if expected_scope is not None else (
        document.governance_scope_type, document.governance_scope_id, document.governance_scope_owner_subject_id)
    if scope[0] == "organization" and scope[1] is None:
        scope = (scope[0], document.organization_id, None)
    location = payload.source_location.model_dump(mode="json", exclude_none=True) if payload.source_location else None
    if (stored is None or file is None or payload.file is None
        or root.provenance.source_system not in {"AKB", "STRATOS_PROJECTFLOW", "STRATOS_ARCHFLOW"}
        or stored.created_by != principal.subject_id or file.uploaded_by != principal.subject_id
        or payload.file.uploaded_by not in (None, principal.subject_id)
        or stored.root_metadata_revision != root.metadata_revision
        or payload.document_profile.expected_root_metadata_revision != root.metadata_revision
        or (version.version_label, version.valid_from, version.valid_to, version.source_file_uri,
            version.source_location, version.file_hash, version.change_summary) != (
            payload.version_label, payload.valid_from, payload.valid_to, payload.source_file_uri,
            location, payload.file_hash, payload.change_summary)
        or (version.governance_scope_type, version.governance_scope_id, version.governance_scope_owner_subject_id) != scope
        or any(getattr(version, key) != value for key, value in binding_columns.items())
        or (file.uri, file.filename, file.mime_type, file.size_bytes, file.sha256) != (
            payload.source_file_uri, payload.file.filename, payload.file.mime_type, payload.file.size_bytes,
            payload.file.sha256 or payload.file_hash)
        or attestation is None
        or (file.content_security_attestation_sha256, file.content_security_status, file.content_security_engine,
            file.content_security_engine_version, file.content_security_signature_version) != (
            attestation.receipt_sha256, "clean", "clamav", attestation.engine_version, attestation.signature_version)):
        raise problem(409, "native_intake_replay_conflict", "The intake session cannot replace its immutable version, creator or profile")
    scanned_at = file.content_security_scanned_at
    if scanned_at is not None and scanned_at.tzinfo is None:
        scanned_at = scanned_at.replace(tzinfo=timezone.utc)
    try:
        expected = build_version_snapshot(payload.document_profile, root=root,
            document_version_id=version.document_version_id,
            verified_source=source_lineage_from_verified_file(root, version, file,
                source_version=file.sha256 if root.provenance.source_system != "AKB" else None))
        if (scanned_at != attestation.scanned_at or stored.root_snapshot_hash != document_snapshot_hash(root)
            or document_snapshot_hash(expected) != stored.snapshot_hash
            or document_snapshot_hash(stored.payload) != stored.snapshot_hash):
            raise ValueError("Immutable profile differs")
    except ValueError as exc:
        raise problem(409, "native_intake_replay_conflict", "The intake session cannot replace its immutable evidence") from exc
    require_document_version_action(principal, Action.document_version_create, document, version, db)
    require_fresh_document_profile(document, version=version, actor_id=principal.subject_id)
    return version
