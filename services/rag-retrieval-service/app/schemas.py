from __future__ import annotations

from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator

DocumentType = Literal[
    "directive",
    "regulation",
    "methodology",
    "policy",
    "procedure",
    "manual",
    "knowledge_base_article",
    "meeting_record",
    "contract",
    "attachment",
    "other",
]
Classification = Literal["public", "internal", "restricted", "confidential"]
AnswerMode = Literal["normative_with_citations", "retrieve_only", "compare"]
Confidence = Literal["high", "medium", "low", "insufficient_source", "conflicting_sources"]


class RagQueryFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_types: list[DocumentType] = Field(default_factory=list)
    only_valid: bool = True
    classification_max: Classification = "internal"
    tags: list[str] = Field(default_factory=list)


class ChunkCitation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str = Field(min_length=1)
    document_version_id: str = Field(min_length=1)
    document_title: str = Field(min_length=1)
    version_label: str = Field(min_length=1)
    document_version: str | None = Field(default=None, min_length=1)
    page_number: int | None = Field(default=None, ge=1)
    section_path: list[str] = Field(default_factory=list)
    article_number: str | None = None
    paragraph_number: str | None = None

    @model_validator(mode="after")
    def fill_document_version(self) -> "ChunkCitation":
        if self.document_version is None:
            self.document_version = self.version_label
        return self


class Citation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str = Field(min_length=1)
    document_version_id: str = Field(min_length=1)
    document_title: str = Field(min_length=1)
    version_label: str = Field(min_length=1)
    document_version: str | None = Field(default=None, min_length=1)
    section_path: list[str] = Field(default_factory=list)
    page_number: int | None = Field(default=None, ge=1)
    chunk_id: str = Field(min_length=1)

    @model_validator(mode="after")
    def fill_document_version(self) -> "Citation":
        if self.document_version is None:
            self.document_version = self.version_label
        return self


class RetrievedChunk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chunk_id: str = Field(min_length=1)
    score: float = Field(ge=0, le=1)
    retrieval_method: Literal["dense", "sparse", "hybrid", "qdrant"]
    text: str = Field(min_length=1)
    citation: ChunkCitation
    metadata: dict[str, Any] = Field(default_factory=dict)


class RagQueryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject_id: str = Field(min_length=1, validation_alias=AliasChoices("subject_id", "user_id"))
    query: str = Field(min_length=1, max_length=4000)
    filters: RagQueryFilters = Field(default_factory=RagQueryFilters)
    answer_mode: AnswerMode = "normative_with_citations"
    max_chunks: int = Field(default=8, ge=1, le=20)


class RetrieveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject_id: str = Field(min_length=1, validation_alias=AliasChoices("subject_id", "user_id"))
    query: str = Field(min_length=1, max_length=4000)
    filters: RagQueryFilters = Field(default_factory=RagQueryFilters)
    max_chunks: int = Field(default=8, ge=1, le=20)


class RetrieveResponse(BaseModel):
    query_id: str
    chunks: list[RetrievedChunk]
    warnings: list[str] = Field(default_factory=list)


class AnswerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject_id: str = Field(min_length=1, validation_alias=AliasChoices("subject_id", "user_id"))
    query: str = Field(min_length=1, max_length=4000)
    chunks: list[RetrievedChunk] = Field(default_factory=list)
    answer_mode: AnswerMode = "normative_with_citations"
    max_chunks: int = Field(default=8, ge=1, le=20)


class RagAnswer(BaseModel):
    query_id: str
    answer: str
    confidence: Confidence
    citations: list[Citation]
    warnings: list[str] = Field(default_factory=list)
    used_chunks: list[str] = Field(default_factory=list)
    missing_information: str | None = None


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str


class ReadinessResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    service: str
    dependencies: dict[str, str]
