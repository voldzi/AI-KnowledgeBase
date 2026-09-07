"""Strict next-generation inputs; routes switch only with all producers ready."""
from pydantic import Field, model_validator

from app.document_profile import (
    ContractModel, Reference, DocumentProfileReference, DocumentAuthor,
    DocumentAccountability, DocumentRootSnapshot, DocumentLifecycle,
    DocumentSourceLineage, DocumentVersionSnapshot, document_snapshot_hash,
)
from app.document_profile_catalog import document_profile, validate_profile_version


class DocumentProvenanceInput(ContractModel):
    source_system: Reference = Field(alias="sourceSystem")
    source_record_id: Reference | None = Field(alias="sourceRecordId")
    source_governed_resource_id: Reference | None = Field(alias="sourceGovernedResourceId")

    @model_validator(mode="after")
    def native_or_registered_source(self):
        if self.source_system == "AKB":
            if self.source_record_id is not None or self.source_governed_resource_id is not None:
                raise ValueError("Native source coordinates are allocated by Registry")
        elif self.source_record_id is None or self.source_governed_resource_id is None:
            raise ValueError("Imported profiles require a registered source record and governed resource")
        return self


class DocumentProfileInput(ContractModel):
    profile: DocumentProfileReference
    authorship: tuple[DocumentAuthor, ...] = Field(min_length=1)
    provenance: DocumentProvenanceInput
    accountability: DocumentAccountability

    @model_validator(mode="after")
    def known_profile(self):
        document_profile(self.profile.id, self.profile.revision)
        return self


class DocumentVersionProfileInput(ContractModel):
    expected_root_metadata_revision: Reference
    lifecycle: DocumentLifecycle
    domain_evidence: dict[str, object]


def build_root_snapshot(value: DocumentProfileInput, *, document_id: str,
                        metadata_revision: str, document_type: str) -> DocumentRootSnapshot:
    fields = value.model_dump(mode="json", by_alias=True)
    if value.provenance.source_system == "AKB":
        fields["provenance"]["sourceRecordId"] = document_id
    return DocumentRootSnapshot.model_validate({
        **fields, "schemaVersion": "stratos-document-root-1", "organizationId": "org_stratos",
        "documentId": document_id, "metadataRevision": metadata_revision, "documentType": document_type,
    })


def build_version_snapshot(value: DocumentVersionProfileInput, *, root: DocumentRootSnapshot,
                           document_version_id: str,
                           verified_source: DocumentSourceLineage) -> DocumentVersionSnapshot:
    if value.expected_root_metadata_revision != root.metadata_revision:
        raise ValueError("Document metadata changed after version preparation")
    snapshot = DocumentVersionSnapshot.model_validate({
        "schemaVersion": "stratos-document-version-1", "organizationId": "org_stratos",
        "documentId": root.document_id, "documentVersionId": document_version_id,
        "rootMetadataRevision": root.metadata_revision, "rootSnapshotHash": document_snapshot_hash(root),
        "sourceLineage": verified_source.model_dump(mode="json", by_alias=True),
        "lifecycle": value.lifecycle.model_dump(mode="json", by_alias=True), "domainEvidence": value.domain_evidence,
    })
    validate_profile_version(root, snapshot)
    return snapshot
