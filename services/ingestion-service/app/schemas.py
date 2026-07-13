from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"
    completed_with_warnings = "completed_with_warnings"


class Classification(str, Enum):
    public = "public"
    internal = "internal"
    restricted = "restricted"
    confidential = "confidential"


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str


class ReadinessResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    service: str
    checks: dict[str, str] = Field(default_factory=dict)


class IngestionJobCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str = Field(min_length=1, max_length=128)
    document_version_id: str = Field(min_length=1, max_length=128)
    source_file_uri: str = Field(min_length=1, max_length=2048)
    extraction_profile: str | None = Field(default=None, min_length=1, max_length=80)
    parser_profile: str = Field(default="controlled_document", min_length=1, max_length=80)
    ocr_enabled: bool = True
    chunking_strategy: str = Field(default="legal_structured", min_length=1, max_length=80)
    embedding_profile: str = Field(default="default", min_length=1, max_length=80)


class ReindexRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[IngestionJobCreate] = Field(default_factory=list, max_length=100)
    reason: str | None = Field(default=None, max_length=300)


class ReindexResponse(BaseModel):
    accepted_jobs: list[str]
    rejected_items: list[dict[str, Any]] = Field(default_factory=list)


class IngestionJobResponse(BaseModel):
    job_id: str
    status: JobStatus
    document_id: str
    document_version_id: str
    source_file_uri: str | None = None
    extraction_profile: str = "document_text_v1"
    parser_profile: str = "controlled_document"
    ocr_enabled: bool = True
    chunking_strategy: str = "legal_structured"
    embedding_profile: str = "default"
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class ReportMessage(BaseModel):
    code: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=1000)


class IngestionQualityReport(BaseModel):
    extraction_profile: str = Field(min_length=1, max_length=80)
    parser_name: str = Field(min_length=1, max_length=80)
    parser_engine: str | None = Field(default=None, max_length=80)
    pages_processed: int = Field(ge=0)
    pages_with_text: int = Field(default=0, ge=0)
    empty_pages: list[int] = Field(default_factory=list)
    text_chars_extracted: int = Field(default=0, ge=0)
    tables_detected: int = Field(default=0, ge=0)
    ocr_used: bool = False
    quality_score: float = Field(default=0, ge=0, le=1)
    quality_tier: Literal["good", "review", "poor"] = "poor"
    requires_review: bool = False
    capabilities: list[str] = Field(default_factory=list)


class IngestionReport(BaseModel):
    job_id: str
    status: JobStatus
    documents_processed: int = Field(ge=0)
    pages_processed: int = Field(ge=0)
    chunks_created: int = Field(ge=0)
    tables_detected: int = Field(ge=0)
    ocr_used: bool
    quality: IngestionQualityReport | None = None
    warnings: list[ReportMessage] = Field(default_factory=list)
    errors: list[ReportMessage] = Field(default_factory=list)


class EntityFacetBucket(BaseModel):
    key: str = Field(min_length=1, max_length=256)
    label: str = Field(min_length=1, max_length=256)
    count: int = Field(ge=0)


class EntityFacetGroup(BaseModel):
    entity_type: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=120)
    count: int = Field(ge=0)
    values: list[EntityFacetBucket] = Field(default_factory=list)


class EntityFacetReport(BaseModel):
    status: Literal["ready", "unavailable"]
    index_name: str = Field(min_length=1, max_length=256)
    total_chunks: int = Field(ge=0)
    chunks_with_entities: int = Field(ge=0)
    entity_types: list[EntityFacetBucket] = Field(default_factory=list)
    entity_groups: list[EntityFacetGroup] = Field(default_factory=list)
    generated_at: datetime
    warnings: list[ReportMessage] = Field(default_factory=list)


class EntitySearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str | None = Field(default=None, max_length=300)
    entity_type: str | None = Field(default=None, max_length=80)
    entity_value: str | None = Field(default=None, max_length=256)
    document_type: str | None = Field(default=None, max_length=80)
    classification: str | None = Field(default=None, max_length=80)
    status: str | None = Field(default=None, max_length=80)
    allowed_document_ids: list[str] = Field(default_factory=list, max_length=5000)
    allowed_policy_hashes: dict[str, list[str]] | None = None
    limit: int = Field(default=12, ge=1, le=50)

    @field_validator("query", "entity_type", "entity_value", "document_type", "classification", "status", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: Any) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            return value
        normalized = value.strip()
        return normalized or None

    @field_validator("allowed_document_ids")
    @classmethod
    def normalize_allowed_document_ids(cls, values: list[str]) -> list[str]:
        seen: set[str] = set()
        normalized_values: list[str] = []
        for value in values:
            normalized = value.strip() if isinstance(value, str) else ""
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            normalized_values.append(normalized)
        return normalized_values


class EntitySearchHit(BaseModel):
    chunk_id: str = Field(min_length=1, max_length=256)
    document_id: str = Field(min_length=1, max_length=128)
    document_version_id: str = Field(min_length=1, max_length=128)
    document_title: str = Field(min_length=1, max_length=512)
    version_label: str | None = Field(default=None, max_length=120)
    document_type: str | None = Field(default=None, max_length=80)
    classification: str | None = Field(default=None, max_length=80)
    status: str | None = Field(default=None, max_length=80)
    policy_binding_id: str | None = Field(default=None, max_length=200)
    policy_version: str | None = Field(default=None, max_length=80)
    policy_hash: str | None = Field(default=None, max_length=80)
    score: float = Field(ge=0)
    snippet: str = Field(min_length=1, max_length=2000)
    page_number: int | None = Field(default=None, ge=1)
    section_title: str | None = Field(default=None, max_length=512)
    section_path: list[str] = Field(default_factory=list)
    source_file_name: str | None = Field(default=None, max_length=512)
    entity_types: list[str] = Field(default_factory=list)
    entity_values: list[str] = Field(default_factory=list)
    entity_pairs: list[str] = Field(default_factory=list)


class EntitySearchResponse(BaseModel):
    status: Literal["ready", "unavailable"]
    index_name: str = Field(min_length=1, max_length=256)
    total_hits: int = Field(ge=0)
    returned_hits: int = Field(ge=0)
    hits: list[EntitySearchHit] = Field(default_factory=list)
    generated_at: datetime
    warnings: list[ReportMessage] = Field(default_factory=list)


class AnalystSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str | None = Field(default=None, max_length=500)
    query_mode: Literal["smart", "boolean", "phrase", "proximity", "fielded"] = "smart"
    search_fields: list[Literal["all", "title", "body", "section", "entity", "source"]] = Field(
        default_factory=lambda: ["all"],
        max_length=8,
    )
    proximity_slop: int = Field(default=5, ge=1, le=25)
    entity_type: str | None = Field(default=None, max_length=80)
    entity_value: str | None = Field(default=None, max_length=256)
    document_type: str | None = Field(default=None, max_length=80)
    classification: str | None = Field(default=None, max_length=80)
    status: str | None = Field(default=None, max_length=80)
    allowed_document_ids: list[str] = Field(default_factory=list, max_length=5000)
    allowed_policy_hashes: dict[str, list[str]] | None = None
    limit: int = Field(default=12, ge=1, le=50)

    @field_validator("query", "entity_type", "entity_value", "document_type", "classification", "status", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: Any) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            return value
        normalized = value.strip()
        return normalized or None

    @field_validator("search_fields")
    @classmethod
    def normalize_search_fields(cls, values: list[str]) -> list[str]:
        if not values:
            return ["all"]
        seen: set[str] = set()
        normalized_values: list[str] = []
        for value in values:
            if value in seen:
                continue
            seen.add(value)
            normalized_values.append(value)
        return ["all"] if "all" in normalized_values else normalized_values

    @field_validator("allowed_document_ids")
    @classmethod
    def normalize_allowed_document_ids(cls, values: list[str]) -> list[str]:
        seen: set[str] = set()
        normalized_values: list[str] = []
        for value in values:
            normalized = value.strip() if isinstance(value, str) else ""
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            normalized_values.append(normalized)
        return normalized_values


class AnalystSearchResponse(BaseModel):
    status: Literal["ready", "unavailable"]
    index_name: str = Field(min_length=1, max_length=256)
    query_mode: Literal["smart", "boolean", "phrase", "proximity", "fielded"]
    total_hits: int = Field(ge=0)
    returned_hits: int = Field(ge=0)
    hits: list[EntitySearchHit] = Field(default_factory=list)
    generated_at: datetime
    warnings: list[ReportMessage] = Field(default_factory=list)


class EntityRelationshipRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_type: str | None = Field(default=None, max_length=80)
    entity_value: str | None = Field(default=None, max_length=256)
    document_type: str | None = Field(default=None, max_length=80)
    classification: str | None = Field(default=None, max_length=80)
    status: str | None = Field(default=None, max_length=80)
    allowed_document_ids: list[str] = Field(default_factory=list, max_length=5000)
    allowed_policy_hashes: dict[str, list[str]] | None = None
    min_evidence_count: int = Field(default=1, ge=1, le=20)
    limit: int = Field(default=12, ge=1, le=50)

    @field_validator("entity_type", "entity_value", "document_type", "classification", "status", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: Any) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            return value
        normalized = value.strip()
        return normalized or None

    @field_validator("allowed_document_ids")
    @classmethod
    def normalize_allowed_document_ids(cls, values: list[str]) -> list[str]:
        seen: set[str] = set()
        normalized_values: list[str] = []
        for value in values:
            normalized = value.strip() if isinstance(value, str) else ""
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            normalized_values.append(normalized)
        return normalized_values


class EntityRelationshipEndpoint(BaseModel):
    entity_type: str = Field(min_length=1, max_length=80)
    entity_value: str = Field(min_length=1, max_length=256)
    label: str = Field(min_length=1, max_length=384)


class EntityRelationshipEvidence(BaseModel):
    chunk_id: str = Field(min_length=1, max_length=256)
    document_id: str = Field(min_length=1, max_length=128)
    document_version_id: str = Field(min_length=1, max_length=128)
    document_title: str = Field(min_length=1, max_length=512)
    version_label: str | None = Field(default=None, max_length=120)
    snippet: str = Field(min_length=1, max_length=2000)
    page_number: int | None = Field(default=None, ge=1)
    section_title: str | None = Field(default=None, max_length=512)
    source_file_name: str | None = Field(default=None, max_length=512)
    policy_binding_id: str | None = Field(default=None, max_length=200)
    policy_version: str | None = Field(default=None, max_length=80)
    policy_hash: str | None = Field(default=None, max_length=80)


class EntityRelationshipEdge(BaseModel):
    edge_id: str = Field(min_length=1, max_length=80)
    relationship_type: Literal["co_occurs"]
    source: EntityRelationshipEndpoint
    target: EntityRelationshipEndpoint
    evidence_count: int = Field(ge=1)
    document_count: int = Field(ge=1)
    confidence: float = Field(ge=0, le=1)
    evidence: list[EntityRelationshipEvidence] = Field(default_factory=list)


class EntityRelationshipResponse(BaseModel):
    status: Literal["ready", "unavailable"]
    index_name: str = Field(min_length=1, max_length=256)
    total_edges: int = Field(ge=0)
    returned_edges: int = Field(ge=0)
    edges: list[EntityRelationshipEdge] = Field(default_factory=list)
    generated_at: datetime
    warnings: list[ReportMessage] = Field(default_factory=list)


class DocumentMetadata(BaseModel):
    document_id: str
    document_version_id: str
    title: str | None = None
    version_label: str | None = None
    document_type: str | None = None
    status: str = "valid"
    tags: list[str] = Field(default_factory=list)
    classification: Classification = Classification.internal
    valid_from: date | None = None
    valid_to: date | None = None
    access_scope: list[str] = Field(default_factory=list)
    tenant_id: str | None = None
    external_system: str | None = None
    external_ref: str | None = None
    organization_id: str = "org_stratos"
    policy_binding_id: str | None = None
    policy_version: str | None = None
    policy_hash: str | None = None
    policy_summary: dict[str, Any] = Field(default_factory=dict)


class DocumentChunk(BaseModel):
    chunk_id: str
    document_id: str
    document_version_id: str
    document_title: str
    version_label: str
    document_type: str | None = None
    tenant_id: str | None = None
    external_system: str | None = None
    external_ref: str | None = None
    organization_id: str = "org_stratos"
    policy_binding_id: str | None = None
    policy_version: str | None = None
    policy_hash: str | None = None
    policy_summary: dict[str, Any] = Field(default_factory=dict)
    text: str = Field(min_length=1)
    normalized_text: str = Field(min_length=1)
    page_number: int | None = Field(default=None, ge=1)
    section_path: list[str] = Field(default_factory=list)
    section_title: str | None = None
    article_number: str | None = None
    paragraph_number: str | None = None
    source_file_uri: str | None = None
    source_file_name: str | None = None
    source_mime_type: str | None = None
    source_size_bytes: int | None = Field(default=None, ge=0)
    source_sha256: str | None = None
    extracted_text_uri: str | None = None
    preview_uri: str | None = None
    char_start: int = Field(ge=0)
    char_end: int = Field(gt=0)
    text_hash: str
    classification: Classification
    tags: list[str] = Field(default_factory=list)
    valid_from: date | None = None
    valid_to: date | None = None
    status: str = "valid"
    access_scope: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("text_hash")
    @classmethod
    def validate_text_hash(cls, value: str) -> str:
        if not value.startswith("sha256:"):
            raise ValueError("text_hash must use the sha256:<hash> format")
        return value


class StoredJob(BaseModel):
    request: IngestionJobCreate
    job: IngestionJobResponse
    report: IngestionReport | None = None
