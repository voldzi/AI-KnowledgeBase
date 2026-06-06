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


class IngestionReport(BaseModel):
    job_id: str
    status: JobStatus
    documents_processed: int = Field(ge=0)
    pages_processed: int = Field(ge=0)
    chunks_created: int = Field(ge=0)
    tables_detected: int = Field(ge=0)
    ocr_used: bool
    warnings: list[ReportMessage] = Field(default_factory=list)
    errors: list[ReportMessage] = Field(default_factory=list)


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


class DocumentChunk(BaseModel):
    chunk_id: str
    document_id: str
    document_version_id: str
    document_title: str
    version_label: str
    document_type: str | None = None
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
