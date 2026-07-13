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
EvaluationRole = Literal[
    "employee",
    "analyst",
    "document_manager",
    "auditor",
    "administrator",
    "leadership",
    "service",
]
QueryCategory = Literal[
    "exact_title",
    "exact_identifier",
    "semantic",
    "procedural",
    "comparative",
    "entity",
    "negative_control",
    "authorization",
]
JudgmentStatus = Literal["draft", "silver", "gold"]
DatasetVisibility = Literal["private", "shared"]
GateStatus = Literal["passed", "failed", "not_evaluated"]
FailureStage = Literal[
    "none",
    "retrieval_no_match",
    "retrieval_relevance",
    "authorization",
    "citation",
    "answer",
    "no_answer",
    "error",
]


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
    retrieval_method: Literal["dense", "sparse", "hybrid", "qdrant", "opensearch"]
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


class RelevanceJudgment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chunk_id: str = Field(min_length=1)
    relevance: int = Field(ge=0, le=3)


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
    expected_relevant_document_ids: list[str] = Field(default_factory=list)
    relevance_judgments: list[RelevanceJudgment] = Field(default_factory=list)
    expected_forbidden_chunk_ids: list[str] = Field(default_factory=list)
    expected_no_answer: bool = False
    role: EvaluationRole = "employee"
    query_category: QueryCategory = "semantic"
    judgment_status: JudgmentStatus = "draft"
    weight: float = Field(default=1.0, ge=0)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_relevance_judgments(self) -> "EvalCase":
        judged_ids = [judgment.chunk_id for judgment in self.relevance_judgments]
        if len(judged_ids) != len(set(judged_ids)):
            raise ValueError("Relevance judgments must contain unique chunk ids")
        return self


class EvaluationDatasetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dataset_id: str | None = Field(default=None, min_length=1, pattern=r"^[A-Za-z0-9_.:-]+$")
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    tags: list[str] = Field(default_factory=list)
    visibility: DatasetVisibility = "private"
    cases: list[EvalCase] = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class EvaluationDataset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dataset_id: str = Field(min_length=1, pattern=r"^[A-Za-z0-9_.:-]+$")
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    tags: list[str] = Field(default_factory=list)
    visibility: DatasetVisibility = "shared"
    owner_subject_id: str | None = None
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
    visibility: DatasetVisibility = "shared"
    owner_subject_id: str | None = None
    draft_cases: int = 0
    silver_cases: int = 0
    gold_cases: int = 0
    roles: list[EvaluationRole] = Field(default_factory=list)
    query_categories: list[QueryCategory] = Field(default_factory=list)


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
    ndcg: float = 0
    expected_relevant_document_count: int = 0
    relevant_document_retrieved_count: int = 0
    zero_result: bool = False
    false_zero_result: bool = False
    forbidden_retrieved_count: int = 0
    authorization_leak_rate: float = 0


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
    role: EvaluationRole = "employee"
    query_category: QueryCategory = "semantic"
    judgment_status: JudgmentStatus = "draft"
    expected_no_answer: bool = False
    retrieval_only: bool = False
    failure_stage: FailureStage = "none"


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
    retrieval_hit_rate: float = 0
    retrieval_mrr: float = 0
    retrieval_ndcg: float = 0
    zero_result_rate: float = 0
    false_zero_result_rate: float = 0
    authorization_leak_rate: float = 0
    citation_traceability: float = 0
    retrieval_latency_p50_ms: float = 0
    retrieval_latency_p95_ms: float = 0
    total_latency_p95_ms: float = 0
    full_answer_cases: int = 0
    retrieval_only_cases: int = 0
    draft_cases: int = 0
    silver_cases: int = 0
    gold_cases: int = 0
    failure_counts: dict[str, int] = Field(default_factory=dict)
    role_slices: list["EvaluationSliceSummary"] = Field(default_factory=list)
    query_category_slices: list["EvaluationSliceSummary"] = Field(default_factory=list)


class EvaluationSliceSummary(BaseModel):
    key: str
    total_cases: int
    average_score: float
    retrieval_recall: float
    retrieval_ndcg: float
    false_zero_result_rate: float
    citation_traceability: float
    retrieval_latency_p95_ms: float


class QualityGateCheck(BaseModel):
    key: str
    actual: float
    operator: Literal[">=", "<="]
    threshold: float
    passed: bool
    eligible: bool = True


class QualityGateResult(BaseModel):
    status: GateStatus
    checks: list[QualityGateCheck]
    eligible_cases: int
    excluded_draft_cases: int = 0


class RunComparison(BaseModel):
    baseline_run_id: str
    average_score_delta: float
    retrieval_recall_delta: float
    retrieval_ndcg_delta: float
    false_zero_result_rate_delta: float
    citation_traceability_delta: float
    retrieval_latency_p95_ms_delta: float
    regressions: list[str] = Field(default_factory=list)


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
    actor_subject_id: str | None = None
    actor_roles: list[str] = Field(default_factory=list)
    quality_gate: QualityGateResult | None = None
    comparison: RunComparison | None = None


class EvaluationRunSummary(BaseModel):
    run_id: str
    dataset_id: str
    dataset_name: str
    status: RunStatus
    started_at: datetime
    finished_at: datetime
    summary: EvaluationSummary
    quality_gate: QualityGateResult | None = None
    comparison: RunComparison | None = None
    actor_subject_id: str | None = None


class QualityThresholds(BaseModel):
    retrieval_recall_min: float
    retrieval_ndcg_min: float
    false_zero_result_rate_max: float
    authorization_leak_rate_max: float
    citation_traceability_min: float
    retrieval_latency_p95_ms_max: float


class QualityOverview(BaseModel):
    datasets: list[DatasetSummary]
    recent_runs: list[EvaluationRunSummary]
    latest_run: EvaluationRun | None = None
    thresholds: QualityThresholds
    generated_at: datetime


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str


class ReadinessResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    service: str
    dependencies: dict[str, str]
