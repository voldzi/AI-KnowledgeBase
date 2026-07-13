from __future__ import annotations

from datetime import timezone
from hashlib import sha256
import json
from pathlib import PurePosixPath
import re
import unicodedata
from typing import Any

from app.information_policy import (
    InformationPolicyBinding,
    anonymous_public_eligible,
    canonical_policy_hash,
)
from app.models import Document, DocumentFile, DocumentPublication, DocumentVersion


PUBLIC_DOCUMENT_SNAPSHOT_SCHEMA = "akb-public-document-1"
FULL_SHA256_PATTERN = re.compile(r"^sha256:[a-f0-9]{64}$")
PUBLIC_SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SAFE_MIME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9!#$&^_.+\-/]{0,158}$")
CONTROL_PATTERN = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

_SNAPSHOT_KEYS = {
    "schemaVersion",
    "documentId",
    "documentVersionId",
    "title",
    "documentType",
    "versionLabel",
    "validFrom",
    "validTo",
    "publishedAt",
    "description",
    "file",
}
_FILE_KEYS = {"filename", "mimeType", "sizeBytes", "sha256"}


class PublicDocumentIntegrityError(ValueError):
    pass


def canonical_snapshot_hash(snapshot: dict[str, Any]) -> str:
    encoded = json.dumps(
        snapshot,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return f"sha256:{sha256(encoded).hexdigest()}"


def validate_public_slug(value: str) -> str:
    candidate = value.strip()
    if not 3 <= len(candidate) <= 120 or not PUBLIC_SLUG_PATTERN.fullmatch(candidate):
        raise PublicDocumentIntegrityError(
            "publicSlug must be a 3-120 character lowercase URL-safe slug"
        )
    return candidate


def exact_source_file(version: DocumentVersion) -> DocumentFile:
    version_hash = normalize_sha256(version.file_hash)
    candidates = [
        item
        for item in version.files
        if item.uri == version.source_file_uri
        and normalize_sha256(item.sha256) == version_hash
    ]
    if len(candidates) != 1:
        raise PublicDocumentIntegrityError(
            "The immutable version must have exactly one matching source file record"
        )
    source = candidates[0]
    if source.size_bytes is None or source.size_bytes < 0:
        raise PublicDocumentIntegrityError("The immutable source size is unavailable")
    if not source.mime_type or not SAFE_MIME_PATTERN.fullmatch(source.mime_type):
        raise PublicDocumentIntegrityError("The immutable source MIME type is invalid")
    normalize_public_filename(source.filename or "")
    return source


def build_public_snapshot(
    document: Document,
    version: DocumentVersion,
    source: DocumentFile,
    *,
    public_description: str | None,
) -> dict[str, Any]:
    if version.status != "valid" or version.published_at is None:
        raise PublicDocumentIntegrityError("Only a published valid document version may be public")
    if document.document_id != version.document_id or source.document_version_id != version.document_version_id:
        raise PublicDocumentIntegrityError("Document version source lineage is inconsistent")
    description = normalize_public_text(public_description, max_length=2000)
    title = normalize_public_text(document.title, max_length=300, required=True)
    snapshot: dict[str, Any] = {
        "schemaVersion": PUBLIC_DOCUMENT_SNAPSHOT_SCHEMA,
        "documentId": document.document_id,
        "documentVersionId": version.document_version_id,
        "title": title,
        "documentType": document.document_type,
        "versionLabel": normalize_public_text(version.version_label, max_length=80, required=True),
        "validFrom": version.valid_from.isoformat() if version.valid_from else None,
        "validTo": version.valid_to.isoformat() if version.valid_to else None,
        "publishedAt": version.published_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "description": description,
        "file": {
            "filename": normalize_public_filename(source.filename or ""),
            "mimeType": source.mime_type,
            "sizeBytes": source.size_bytes,
            "sha256": normalize_sha256(source.sha256),
        },
    }
    validate_snapshot(snapshot, document.document_id, version.document_version_id)
    return snapshot


def validate_snapshot(
    snapshot: Any,
    document_id: str,
    document_version_id: str,
) -> dict[str, Any]:
    if not isinstance(snapshot, dict) or set(snapshot) != _SNAPSHOT_KEYS:
        raise PublicDocumentIntegrityError("Public metadata snapshot has unsupported fields")
    if snapshot.get("schemaVersion") != PUBLIC_DOCUMENT_SNAPSHOT_SCHEMA:
        raise PublicDocumentIntegrityError("Public metadata snapshot schema is unsupported")
    if snapshot.get("documentId") != document_id or snapshot.get("documentVersionId") != document_version_id:
        raise PublicDocumentIntegrityError("Public metadata snapshot lineage is inconsistent")
    normalize_public_text(snapshot.get("title"), max_length=300, required=True)
    normalize_public_text(snapshot.get("versionLabel"), max_length=80, required=True)
    normalize_public_text(snapshot.get("description"), max_length=2000)
    if not isinstance(snapshot.get("documentType"), str) or not snapshot["documentType"]:
        raise PublicDocumentIntegrityError("Public document type is invalid")
    for key in ("validFrom", "validTo", "publishedAt"):
        if snapshot.get(key) is not None and not isinstance(snapshot[key], str):
            raise PublicDocumentIntegrityError(f"Public snapshot {key} is invalid")
    file_value = snapshot.get("file")
    if not isinstance(file_value, dict) or set(file_value) != _FILE_KEYS:
        raise PublicDocumentIntegrityError("Public file metadata has unsupported fields")
    normalize_public_filename(file_value.get("filename") or "")
    if not isinstance(file_value.get("mimeType"), str) or not SAFE_MIME_PATTERN.fullmatch(file_value["mimeType"]):
        raise PublicDocumentIntegrityError("Public file MIME type is invalid")
    if not isinstance(file_value.get("sizeBytes"), int) or file_value["sizeBytes"] < 0:
        raise PublicDocumentIntegrityError("Public file size is invalid")
    normalize_sha256(file_value.get("sha256"))
    return snapshot


def validate_publication_integrity(
    publication: DocumentPublication,
    document: Document,
    version: DocumentVersion,
) -> InformationPolicyBinding:
    if (
        publication.status != "PUBLISHED"
        or publication.published_at is None
        or publication.revoked_at is not None
        or not publication.central_publication_id
    ):
        raise PublicDocumentIntegrityError("The publication is not active")
    if document.document_id != publication.document_id or version.document_version_id != publication.document_version_id:
        raise PublicDocumentIntegrityError("Publication lineage is inconsistent")
    if version.document_id != document.document_id:
        raise PublicDocumentIntegrityError("Document version lineage is inconsistent")
    if version.status not in {"valid", "superseded"}:
        raise PublicDocumentIntegrityError("The published source version is no longer deliverable")
    if (
        version.governance_registration_status != "REGISTERED"
        or not version.governed_resource_id
        or version.governed_resource_id != publication.governed_resource_id
        or version.governed_source_version != publication.source_version
        or version.governed_source_version != version.document_version_id
    ):
        raise PublicDocumentIntegrityError("Governed resource coordinates are stale")
    if (
        version.policy_binding_id != publication.policy_binding_id
        or version.policy_version != publication.policy_version
        or version.policy_hash != publication.policy_hash
    ):
        raise PublicDocumentIntegrityError("Publication policy coordinates are stale")
    try:
        binding = InformationPolicyBinding.model_validate(version.policy_summary)
    except ValueError as exc:
        raise PublicDocumentIntegrityError("Publication policy binding is invalid") from exc
    if (
        binding.policy_binding_id != publication.policy_binding_id
        or binding.policy_version != publication.policy_version
        or canonical_policy_hash(binding) != publication.policy_hash
        or not anonymous_public_eligible(binding)
    ):
        raise PublicDocumentIntegrityError("Publication policy is no longer public eligible")

    snapshot = validate_snapshot(
        publication.public_snapshot,
        publication.document_id,
        publication.document_version_id,
    )
    if canonical_snapshot_hash(snapshot) != publication.public_snapshot_hash:
        raise PublicDocumentIntegrityError("Public metadata snapshot hash mismatch")
    source = exact_source_file(version)
    if (
        source.uri != publication.source_file_uri
        or normalize_sha256(source.sha256) != publication.source_file_hash
        or normalize_sha256(version.file_hash) != publication.source_file_hash
        or normalize_public_filename(source.filename or "") != publication.source_filename
        or source.mime_type != publication.source_mime_type
        or source.size_bytes != publication.source_size_bytes
    ):
        raise PublicDocumentIntegrityError("Immutable source descriptor mismatch")
    snapshot_file = snapshot["file"]
    if (
        snapshot_file["filename"] != publication.source_filename
        or snapshot_file["mimeType"] != publication.source_mime_type
        or snapshot_file["sizeBytes"] != publication.source_size_bytes
        or snapshot_file["sha256"] != publication.source_file_hash
    ):
        raise PublicDocumentIntegrityError("Public file snapshot mismatch")
    return binding


def normalize_sha256(value: Any) -> str:
    candidate = str(value or "").strip().lower()
    if not FULL_SHA256_PATTERN.fullmatch(candidate):
        raise PublicDocumentIntegrityError("A full sha256:<64 lowercase hex> digest is required")
    return candidate


def normalize_public_filename(value: str) -> str:
    normalized = unicodedata.normalize("NFC", str(value or "").replace("\\", "/"))
    filename = PurePosixPath(normalized).name.strip()
    if (
        not filename
        or filename in {".", ".."}
        or filename != normalized
        or CONTROL_PATTERN.search(filename)
        or "\r" in filename
        or "\n" in filename
        or len(filename) > 300
    ):
        raise PublicDocumentIntegrityError("Public source filename is unsafe")
    return filename


def normalize_public_text(
    value: Any,
    *,
    max_length: int,
    required: bool = False,
) -> str | None:
    if value is None:
        if required:
            raise PublicDocumentIntegrityError("Required public metadata is missing")
        return None
    if not isinstance(value, str):
        raise PublicDocumentIntegrityError("Public metadata text is invalid")
    normalized = unicodedata.normalize("NFC", value).strip()
    if CONTROL_PATTERN.search(normalized) or len(normalized) > max_length:
        raise PublicDocumentIntegrityError("Public metadata text is unsafe")
    if required and not normalized:
        raise PublicDocumentIntegrityError("Required public metadata is empty")
    return normalized or None
