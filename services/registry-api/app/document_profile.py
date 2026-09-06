"""Proposed atomic STRATOS document admission contract; not an enabled profile catalog.

Only a response obtained directly from the authenticated governance request is
eligible for verification. A stored confirmation or caller-supplied ALLOW flag
is never fresh authority. The established Information Policy hash is untouched.
"""
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
import json
from typing import Annotated, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.document_profile_catalog import validate_profile_root, validate_profile_version

Reference = Annotated[str, Field(min_length=1, max_length=160, strict=True, pattern=r"^\S+$")]
Sha256 = Annotated[str, Field(pattern=r"^sha256:[a-f0-9]{64}$", strict=True)]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class DocumentProfileReference(ContractModel):
    id: Reference
    revision: Reference


class DocumentAuthor(ContractModel):
    kind: Literal["person", "organization", "external_authority"]
    id: Reference
    evidence_reference: Reference = Field(alias="evidenceReference")


class DocumentGestor(ContractModel):
    kind: Literal["person", "organization_unit"]
    id: Reference


class DocumentAccountability(ContractModel):
    owner_subject_id: Reference = Field(alias="ownerSubjectId")
    gestor: DocumentGestor


class DocumentRootProvenance(ContractModel):
    source_system: Reference = Field(alias="sourceSystem")
    source_record_id: Reference = Field(alias="sourceRecordId")
    source_governed_resource_id: Reference | None = Field(alias="sourceGovernedResourceId")


class DocumentRootSnapshot(ContractModel):
    schema_version: Literal["stratos-document-root-1"] = Field(alias="schemaVersion")
    organization_id: Literal["org_stratos"] = Field(alias="organizationId")
    document_id: Reference = Field(alias="documentId")
    metadata_revision: Reference = Field(alias="metadataRevision")
    profile: DocumentProfileReference
    document_type: Reference = Field(alias="documentType")
    authorship: tuple[DocumentAuthor, ...] = Field(min_length=1)
    provenance: DocumentRootProvenance
    accountability: DocumentAccountability

    @model_validator(mode="after")
    def unique_authors(self):
        if len({(author.kind, author.id) for author in self.authorship}) != len(self.authorship):
            raise ValueError("Authorship references must be unique")
        if self.provenance.source_system == "AKB":
            if self.provenance.source_record_id != self.document_id or self.provenance.source_governed_resource_id is not None:
                raise ValueError("A native AKB root must use its allocated documentId without an external governed source")
        elif self.provenance.source_governed_resource_id is None:
            raise ValueError("An imported root requires its registered governed source")
        validate_profile_root(self)
        return self


class DocumentLifecycle(ContractModel):
    mode: Literal["fixed_interval", "until_superseded", "record"]
    effective_from: date | None = Field(alias="effectiveFrom")
    effective_to: date | None = Field(alias="effectiveTo")
    recorded_on: date | None = Field(alias="recordedOn")
    review_at: date | None = Field(alias="reviewAt")
    review_rule_id: Reference = Field(alias="reviewRuleId")
    retention_rule_id: Reference = Field(alias="retentionRuleId")

    @model_validator(mode="after")
    def coherent_dates(self):
        if self.mode == "fixed_interval":
            if self.effective_from is None or self.effective_to is None or self.effective_from > self.effective_to:
                raise ValueError("fixed_interval requires an ordered explicit effective period")
        elif self.mode == "until_superseded":
            if self.effective_from is None or self.effective_to is not None:
                raise ValueError("until_superseded requires a start and an explicitly open end")
        elif self.recorded_on is None or self.effective_from is not None or self.effective_to is not None:
            raise ValueError("record requires recordedOn and cannot imply normative effectivity")
        return self


class DocumentSourceLineage(ContractModel):
    source_system: Reference = Field(alias="sourceSystem")
    source_record_id: Reference = Field(alias="sourceRecordId")
    source_version: Reference = Field(alias="sourceVersion")
    source_governed_resource_id: Reference | None = Field(alias="sourceGovernedResourceId")
    content_sha256: Sha256 = Field(alias="contentSha256")
    content_uri: Annotated[str, Field(min_length=1, max_length=2048, strict=True)] = Field(alias="contentUri")
    intake_receipt_id: Reference = Field(alias="intakeReceiptId")
    captured_at: datetime = Field(alias="capturedAt")

    @model_validator(mode="after")
    def utc_capture(self):
        if self.captured_at.tzinfo is None or self.captured_at.utcoffset() != timedelta(0):
            raise ValueError("capturedAt must be an explicit UTC instant")
        return self


class DocumentVersionSnapshot(ContractModel):
    schema_version: Literal["stratos-document-version-1"] = Field(alias="schemaVersion")
    organization_id: Literal["org_stratos"] = Field(alias="organizationId")
    document_id: Reference = Field(alias="documentId")
    document_version_id: Reference = Field(alias="documentVersionId")
    root_metadata_revision: Reference = Field(alias="rootMetadataRevision")
    root_snapshot_hash: Sha256 = Field(alias="rootSnapshotHash")
    source_lineage: DocumentSourceLineage = Field(alias="sourceLineage")
    lifecycle: DocumentLifecycle
    domain_evidence: dict[str, object] = Field(alias="domainEvidence")


def canonical_document_snapshot(value: ContractModel | dict) -> str:
    """UTF-8 JSON, lexical keys, compact separators, explicit nulls, ordered arrays.

    Version 1 metadata uses strings, objects, arrays and null; no float/number
    normalization is needed. There is no Unicode normalization or field removal.
    """
    data = value.model_dump(mode="json", by_alias=True, exclude_none=False) if isinstance(value, BaseModel) else value
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def document_snapshot_hash(value: ContractModel | dict) -> str:
    return "sha256:" + sha256(canonical_document_snapshot(value).encode("utf-8")).hexdigest()


class DocumentAdmissionExpectation(ContractModel):
    root_snapshot: DocumentRootSnapshot = Field(alias="rootSnapshot")
    current_root_snapshot: DocumentRootSnapshot = Field(alias="currentRootSnapshot")
    version_snapshot: DocumentVersionSnapshot | None = Field(default=None, alias="versionSnapshot")
    correlation_id: Reference = Field(alias="correlationId")

    @model_validator(mode="after")
    def bind_exact_root_and_source(self):
        root, version = self.root_snapshot, self.version_snapshot
        if self.current_root_snapshot.document_id != root.document_id:
            raise ValueError("Current accountability root must belong to the same document")
        if version is not None:
            lineage = version.source_lineage
            if (version.document_id != root.document_id
                or version.root_metadata_revision != root.metadata_revision
                or version.root_snapshot_hash != document_snapshot_hash(root)
                or lineage.source_system != root.provenance.source_system
                or lineage.source_record_id != root.provenance.source_record_id
                or lineage.source_governed_resource_id != root.provenance.source_governed_resource_id):
                raise ValueError("Version snapshot must bind the exact root revision and source provenance")
            if lineage.source_system == "AKB" and lineage.source_version != version.document_version_id:
                raise ValueError("Native sourceVersion must name this exact immutable version")
            validate_profile_version(root, version)
        return self


class DocumentAdmissionRequest(DocumentAdmissionExpectation):
    operation: Literal["register", "revalidate"]
    schema_version: Literal["stratos-document-admission-request-1"] = Field(alias="schemaVersion")
    request_nonce: Annotated[str, Field(pattern=r"^[a-f0-9]{32}$")] = Field(alias="requestNonce")
    root_snapshot_hash: Sha256 = Field(alias="rootSnapshotHash")
    snapshot_hash: Sha256 = Field(alias="snapshotHash")
    current_root_snapshot_hash: Sha256 = Field(alias="currentRootSnapshotHash")

    @model_validator(mode="after")
    def verify_snapshot_hashes(self):
        if (self.root_snapshot_hash != document_snapshot_hash(self.root_snapshot)
            or self.current_root_snapshot_hash != document_snapshot_hash(self.current_root_snapshot)
            or self.snapshot_hash != document_snapshot_hash(self.version_snapshot or self.root_snapshot)):
            raise ValueError("Admission request hashes must match exact snapshots")
        return self


class DocumentAdmissionConfirmation(ContractModel):
    schema_version: Literal["stratos-document-admission-confirmation-1"] = Field(alias="schemaVersion")
    decision: Literal["ALLOW"]
    operation: Literal["register", "revalidate"]
    admission_id: Reference = Field(alias="admissionId")
    revision: Annotated[int, Field(ge=1, strict=True)]
    organization_id: Literal["org_stratos"] = Field(alias="organizationId")
    application: Literal["AKB"]
    resource_type: Literal["document", "document-version", "document_version"] = Field(alias="resourceType")
    resource_id: Reference = Field(alias="resourceId")
    source_version: Reference = Field(alias="sourceVersion")
    governed_resource_id: Reference = Field(alias="governedResourceId")
    policy_binding_id: Reference = Field(alias="policyBindingId")
    policy_version: Literal["information-policy-2.0.0"] = Field(alias="policyVersion")
    policy_hash: Sha256 = Field(alias="policyHash")
    scope_hash: Sha256 = Field(alias="scopeHash")
    snapshot_hash: Sha256 = Field(alias="snapshotHash")
    root_snapshot_hash: Sha256 = Field(alias="rootSnapshotHash")
    profile: DocumentProfileReference
    accountability: DocumentAccountability
    current_root_snapshot_hash: Sha256 = Field(alias="currentRootSnapshotHash")
    current_metadata_revision: Reference = Field(alias="currentMetadataRevision")
    current_root_governed_resource_id: Reference = Field(alias="currentRootGovernedResourceId")
    current_profile: DocumentProfileReference = Field(alias="currentProfile")
    current_accountability: DocumentAccountability = Field(alias="currentAccountability")
    request_nonce: Annotated[str, Field(pattern=r"^[a-f0-9]{32}$")] = Field(alias="requestNonce")
    correlation_id: Reference = Field(alias="correlationId")
    confirmed_by_subject_id: Literal["service:akb"] = Field(alias="confirmedBySubjectId")
    checked_at: datetime = Field(alias="checkedAt")
    expires_at: datetime = Field(alias="expiresAt")


@dataclass(frozen=True)
class PreparedDocumentAdmission:
    request: dict
    expected_confirmation: dict


def prepare_document_admission(expectation: DocumentAdmissionExpectation, *, resource_type: str,
                               resource_id: str, source_version: str, policy_binding_id: str,
                               policy_hash: str, scope: dict[str, str],
                               current_root_governed_resource_id: str | None = None,
                               operation: Literal["register", "revalidate"] = "register") -> PreparedDocumentAdmission:
    root, version = expectation.root_snapshot, expectation.version_snapshot
    current_root = expectation.current_root_snapshot
    if operation == "register" and document_snapshot_hash(current_root) != document_snapshot_hash(root):
        raise ValueError("New registration must use the current root snapshot")
    if version is not None and not current_root_governed_resource_id:
        raise ValueError("Exact version admission requires its current governed root reference")
    if resource_type == "document":
        if version is not None or resource_id != root.document_id or source_version != root.metadata_revision:
            raise ValueError("Root admission target must name the exact metadata revision")
        if document_snapshot_hash(current_root) != document_snapshot_hash(root):
            raise ValueError("Root admission must target the current metadata revision")
        snapshot = root
    elif resource_type in {"document-version", "document_version"}:
        if version is None or resource_id != version.document_version_id or source_version != version.document_version_id:
            raise ValueError("Version admission target must name the exact immutable version")
        snapshot = version
    else:
        raise ValueError("Document admission supports only document and document-version")
    nonce = uuid4().hex
    common = {
        "operation": operation,
        "organizationId": "org_stratos", "application": "AKB", "resourceType": resource_type,
        "resourceId": resource_id, "sourceVersion": source_version,
        "policyBindingId": policy_binding_id, "policyVersion": "information-policy-2.0.0",
        "policyHash": policy_hash, "scopeHash": document_snapshot_hash(scope),
        "snapshotHash": document_snapshot_hash(snapshot), "rootSnapshotHash": document_snapshot_hash(root),
        "profile": root.profile.model_dump(by_alias=True),
        "accountability": root.accountability.model_dump(by_alias=True),
        "currentRootSnapshotHash": document_snapshot_hash(current_root),
        "currentMetadataRevision": current_root.metadata_revision,
        "currentRootGovernedResourceId": current_root_governed_resource_id if version else None,
        "currentProfile": current_root.profile.model_dump(by_alias=True),
        "currentAccountability": current_root.accountability.model_dump(by_alias=True),
        "requestNonce": nonce, "correlationId": expectation.correlation_id,
        "confirmedBySubjectId": "service:akb",
    }
    request = {
        "schemaVersion": "stratos-document-admission-request-1", "operation": operation, "requestNonce": nonce,
        "correlationId": expectation.correlation_id,
        "rootSnapshot": root.model_dump(mode="json", by_alias=True),
        "currentRootSnapshot": current_root.model_dump(mode="json", by_alias=True),
        "currentRootSnapshotHash": common["currentRootSnapshotHash"],
        "versionSnapshot": version.model_dump(mode="json", by_alias=True) if version else None,
        "rootSnapshotHash": common["rootSnapshotHash"], "snapshotHash": common["snapshotHash"],
    }
    return PreparedDocumentAdmission(
        request=DocumentAdmissionRequest.model_validate(request).model_dump(mode="json", by_alias=True),
        expected_confirmation=common,
    )


def verify_document_admission_confirmation(value: object, *, prepared: PreparedDocumentAdmission,
                                          governed_resource_id: str,
                                          now: datetime | None = None) -> DocumentAdmissionConfirmation:
    confirmation = DocumentAdmissionConfirmation.model_validate(value)
    actual = confirmation.model_dump(mode="json", by_alias=True)
    expected_fields = {**prepared.expected_confirmation, "governedResourceId": governed_resource_id}
    if expected_fields["resourceType"] == "document":
        expected_fields["currentRootGovernedResourceId"] = governed_resource_id
    for key, expected in expected_fields.items():
        if actual.get(key) != expected:
            raise ValueError("Document admission confirmation does not match the exact request")
    current = now or datetime.now(timezone.utc)
    checked, expires = confirmation.checked_at, confirmation.expires_at
    if (current.tzinfo is None or checked.tzinfo is None or expires.tzinfo is None
        or checked.utcoffset() != timedelta(0) or expires.utcoffset() != timedelta(0)
        or checked > current + timedelta(seconds=5)
        or checked < current - timedelta(seconds=30)
        or expires <= current or expires <= checked
        or expires - checked > timedelta(seconds=60)):
        raise ValueError("Document admission confirmation is stale or has invalid freshness coordinates")
    return confirmation
