from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

DocumentType = Literal[
    "directive",
    "regulation",
    "methodology",
    "policy",
    "procedure",
    "manual",
    "knowledge_base_article",
    "project_documentation",
    "meeting_record",
    "contract",
    "attachment",
    "other",
]
Classification = Literal["public", "internal", "restricted", "confidential"]
AnswerMode = Literal["normative_with_citations", "retrieve_only", "compare"]
Confidence = Literal["high", "medium", "low", "insufficient_source", "conflicting_sources"]
CaseStatus = Literal["passed", "failed", "error"]
RunStatus = Literal["completed", "completed_with_errors"]
ReportFormat = Literal["json", "csv", "html"]


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
    page_number: int | None = Field(default=None, ge=1)
    section_path: list[str] = Field(default_factory=list)
    article_number: str | None = None
    paragraph_number: str | None = None


class Citation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str = Field(min_length=1)
    document_version_id: str = Field(min_length=1)
    document_title: str = Field(min_length=1)
    version_label: str = Field(min_length=1)
    section_path: list[str] = Field(default_factory=list)
    page_number: int | None = Field(default=None, ge=1)
    chunk_id: str = Field(min_length=1)


class RetrievedChunk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chunk_id: str = Field(min_length=1)
    score: float = Field(ge=0, le=1)
    retrieval_method: Literal["dense", "sparse", "hybrid"]
    text: str = Field(min_length=1)
    citation: ChunkCitation
    metadata: dict[str, Any] = Field(default_factory=dict)


class RagQueryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject_id: str = Field(min_length=1)
    query: str = Field(min_length=1, max_length=4000)
    filters: RagQueryFilters = Field(default_factory=RagQueryFilters)
    answer_mode: AnswerMode = "normative_with_citations"
    max_chunks: int = Field(default=8, ge=1, le=20)


class RetrieveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject_id: str = Field(min_length=1)
    query: str = Field(min_length=1, max_length=4000)
    filters: RagQueryFilters = Field(default_factory=RagQueryFilters)
    max_chunks: int = Field(default=8, ge=1, le=20)


class RetrieveResponse(BaseModel):
    query_id: str
    chunks: list[RetrievedChunk]
    warnings: list[str] = Field(default_factory=list)


class RagAnswer(BaseModel):
    query_id: str
    answer: str
    confidence: Confidence
    citations: list[Citation]
    warnings: list[str] = Field(default_factory=list)
    used_chunks: list[str] = Field(default_factory=list)
    missing_information: str | None = None


class ExpectedCitation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chunk_id: str | None = Field(default=None, min_length=1)
    document_id: str | None = Field(default=None, min_length=1)
    document_version_id: str | None = Field(default=None, min_length=1)
    page_number: int | None = Field(default=None, ge=1)
    section_path: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def has_identifier(self) -> "ExpectedCitation":
        if not any([self.chunk_id, self.document_id, self.document_version_id, self.page_number, self.section_path]):
            raise ValueError("Expected citation must include at least one identifying field")
        return self


class EvalCase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    case_id: str = Field(min_length=1, pattern=r"^[A-Za-z0-9_.:-]+$")
    subject_id: str = Field(default="eval_subject", min_length=1)
    query: str = Field(min_length=1, max_length=4000)
    filters: RagQueryFilters = Field(default_factory=RagQueryFilters)
    answer_mode: AnswerMode = "normative_with_citations"
    max_chunks: int = Field(default=8, ge=1, le=20)
    expected_answer_terms: list[str] = Field(default_factory=list)
    forbidden_answer_terms: list[str] = Field(default_factory=list)
    expected_citations: list[ExpectedCitation] = Field(default_factory=list)
    expected_relevant_chunk_ids: list[str] = Field(default_factory=list)
    expected_no_answer: bool = False
    weight: float = Field(default=1.0, ge=0)
    metadata: dict[str, Any] = Field(default_factory=dict)


class EvaluationDatasetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dataset_id: str | None = Field(default=None, min_length=1, pattern=r"^[A-Za-z0-9_.:-]+$")
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    tags: list[str] = Field(default_factory=list)
    cases: list[EvalCase] = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class EvaluationDataset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dataset_id: str = Field(min_length=1, pattern=r"^[A-Za-z0-9_.:-]+$")
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    tags: list[str] = Field(default_factory=list)
    cases: list[EvalCase] = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class DatasetSummary(BaseModel):
    dataset_id: str
    name: str
    description: str
    tags: list[str]
    case_count: int
    created_at: datetime


class EvaluationRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dataset_id: str | None = Field(default=None, min_length=1, pattern=r"^[A-Za-z0-9_.:-]+$")
    dataset: EvaluationDatasetCreate | None = None
    case_ids: list[str] = Field(default_factory=list)
    subject_id_override: str | None = Field(default=None, min_length=1)
    max_cases: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def has_one_dataset_source(self) -> "EvaluationRunRequest":
        if bool(self.dataset_id) == bool(self.dataset):
            raise ValueError("Exactly one of dataset_id or dataset must be provided")
        return self


class RetrievalMetrics(BaseModel):
    expected_relevant_count: int
    retrieved_count: int
    relevant_retrieved_count: int
    precision: float
    recall: float
    hit_rate: float
    mrr: float


class CitationMetrics(BaseModel):
    expected_citation_count: int
    actual_citation_count: int
    matched_citation_count: int
    precision: float
    recall: float
    correctness: float


class AnswerMetrics(BaseModel):
    expected_term_count: int
    matched_term_count: int
    forbidden_term_violations: list[str]
    term_coverage: float
    answer_correctness: float
    faithfulness: float
    no_answer_correctness: float


class EvaluationCaseResult(BaseModel):
    case_id: str
    query_id: str | None
    status: CaseStatus
    overall_score: float
    latency_ms: float
    retrieval_latency_ms: float
    answer_latency_ms: float
    confidence: Confidence | None = None
    retrieval_metrics: RetrievalMetrics
    citation_metrics: CitationMetrics
    answer_metrics: AnswerMetrics
    retrieved_chunk_ids: list[str] = Field(default_factory=list)
    used_chunks: list[str] = Field(default_factory=list)
    actual_citations: list[Citation] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    answer_excerpt: str = ""
    answer_sha256: str | None = None
    error_code: str | None = None
    error_message: str | None = None


class EvaluationSummary(BaseModel):
    total_cases: int
    passed_cases: int
    failed_cases: int
    error_cases: int
    average_score: float
    average_latency_ms: float
    retrieval_precision: float
    retrieval_recall: float
    citation_correctness: float
    answer_correctness: float
    faithfulness: float
    no_answer_correctness: float


class EvaluationRun(BaseModel):
    run_id: str
    dataset_id: str
    dataset_name: str
    status: RunStatus
    started_at: datetime
    finished_at: datetime
    summary: EvaluationSummary
    cases: list[EvaluationCaseResult]
    settings: dict[str, Any] = Field(default_factory=dict)


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str


class ReadinessResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    service: str
    dependencies: dict[str, str]
