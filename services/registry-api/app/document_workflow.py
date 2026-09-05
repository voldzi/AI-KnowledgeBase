"""Version-bound review evidence and personal assignment matching."""

from datetime import date
from hashlib import sha256
import json

from app.models import Document, DocumentAssignment, DocumentVersion, WorkflowTask
from app.permissions import SubjectContext


def assignment_matches(assignment: DocumentAssignment, context: SubjectContext) -> bool:
    if not assignment.active:
        return False
    if assignment.subject_type == "user":
        return assignment.subject_id == context.subject_id
    if assignment.subject_type == "group":
        return assignment.subject_id in context.groups
    # A unit name is not proof of membership; service identities cannot approve.
    return False


def personal_roles(document: Document, context: SubjectContext) -> list[str]:
    roles = {
        assignment.role
        for assignment in document.assignments
        if assignment_matches(assignment, context)
    }
    if document.owner_id == context.subject_id:
        roles.add("owner")
    return sorted(roles)


def task_is_mine(task: WorkflowTask, context: SubjectContext) -> bool:
    metadata = task.task_metadata or {}
    subject_type = metadata.get("assignment_subject_type", "user")
    if subject_type == "group":
        return task.owner_id in context.groups
    return subject_type == "user" and task.owner_id == context.subject_id


def review_snapshot(document: Document, version: DocumentVersion) -> str:
    # A changed source, authority, validity or assignment requires a new review.
    payload = {
        "document_id": document.document_id,
        "title": document.title,
        "type": document.document_type,
        "classification": document.classification,
        "owner_id": document.owner_id,
        "policy_hash": document.policy_hash,
        "source_version": document.governed_source_version,
        "metadata": document.document_metadata,
        "tags": document.tags,
        "access_policies": sorted(
            json.dumps({"subjects": sorted(item.subjects), "actions": sorted(item.actions), "constraints": item.constraints}, sort_keys=True)
            for item in document.access_policies
        ),
        "assignments": sorted(
            (item.role, item.subject_type, item.subject_id, item.is_primary)
            for item in document.assignments if item.active
        ),
        "version_id": version.document_version_id,
        "version_label": version.version_label,
        "version_policy_hash": version.policy_hash,
        "version_source_version": version.governed_source_version,
        "source_file_uri": version.source_file_uri,
        "file_hash": version.file_hash,
        "files": sorted(
            json.dumps({
                "id": item.file_id, "uri": item.uri, "sha256": item.sha256,
                "filename": item.filename, "mime_type": item.mime_type, "size_bytes": item.size_bytes,
            }, sort_keys=True)
            for item in version.files
        ),
        "valid_from": version.valid_from.isoformat() if version.valid_from else None,
        "valid_to": version.valid_to.isoformat() if version.valid_to else None,
    }
    return sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def review_due_date(document: Document) -> tuple[date | None, bool]:
    value = (document.document_metadata or {}).get("review_due_on")
    if value is None or value == "":
        return None, False
    try:
        return date.fromisoformat(value), False
    except (TypeError, ValueError):
        return None, True
