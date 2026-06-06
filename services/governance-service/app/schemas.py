from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

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
DocumentStatus = Literal["draft", "review", "valid", "superseded", "archived", "cancelled"]
Classification = Literal["public", "internal", "restricted", "confidential"]
Confidence = Literal["high", "medium", "low", "insufficient_source", "conflicting_sources"]
ChangeType = Literal["added", "removed", "modified", "unchanged"]
ChangeImpact = Literal["none", "minor", "material", "critical"]
FindingSeverity = Literal["info", "warning", "error", "critical"]
ComplianceStatus = Literal["compliant", "non_compliant", "needs_review", "insufficient_source"]
RuleStatus = Literal["passed", "warning", "failed", "manual_review"]
ConflictType = Literal["approval_owner_mismatch", "deadline_mismatch", "normative_polarity", "potential_overlap"]
AlertSeverity = Literal["info", "warning", "critical"]


class Citation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str = Field(min_length=1)
    document_version_id: str = Field(min_length=1)
    document_title: str = Field(min_length=1)
    version_label: str = Field(min_length=1)
    section_path: list[str] = Field(default_factory=list)
    page_number: int | None = Field(default=None, ge=1)
    chunk_id: str = Field(min_length=1)
    source_excerpt: str | None = Field(default=None, max_length=500)


class SourceReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_id: str = Field(min_length=1)
    source_type: Literal["input_document", "document_version", "retrieved_chunk", "registry_metadata"]
    document_id: str | None = None
    document_version_id: str | None = None
    title: str = Field(min_length=1)
    uri: str | None = None
    citation: Citation | None = None


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


class RetrievedChunk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chunk_id: str = Field(min_length=1)
    score: float = Field(ge=0, le=1)
    retrieval_method: Literal["dense", "sparse", "hybrid"]
    text: str = Field(min_length=1, max_length=200000)
    citation: ChunkCitation
    metadata: dict[str, Any] = Field(default_factory=dict)


class RagQueryFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_types: list[DocumentType] = Field(default_factory=lambda: ["directive", "methodology", "policy"])
    only_valid: bool = True
    classification_max: Classification = "internal"
    tags: list[str] = Field(default_factory=list)


class DocumentVersionContent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str = Field(min_length=1)
    document_version_id: str = Field(min_length=1)
    document_title: str = Field(min_length=1, max_length=300)
    version_label: str = Field(min_length=1, max_length=80)
    status: DocumentStatus = "draft"
    classification: Classification = "internal"
    valid_from: date | None = None
    valid_to: date | None = None
    source_uri: str | None = Field(default=None, max_length=1024)
    content: str = Field(min_length=1, max_length=200000)
    citations: list[Citation] = Field(default_factory=list)


class DraftDocumentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=300)
    document_type: DocumentType = "directive"
    classification: Classification = "internal"
    content: str = Field(min_length=1, max_length=200000)
    document_id: str | None = None
    document_version_id: str | None = None
    owner_id: str | None = Field(default=None, max_length=128)
    gestor_unit: str | None = Field(default=None, max_length=128)
    valid_from: date | None = None
    valid_to: date | None = None
    tags: list[str] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)


class GovernanceSourceDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str = Field(min_length=1)
    document_version_id: str = Field(min_length=1)
    document_title: str = Field(min_length=1, max_length=300)
    version_label: str = Field(min_length=1, max_length=80)
    status: DocumentStatus = "valid"
    classification: Classification = "internal"
    content: str = Field(min_length=1, max_length=200000)
    source_uri: str | None = Field(default=None, max_length=1024)
    citations: list[Citation] = Field(default_factory=list)


class ChangeItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    change_id: str
    change_type: ChangeType
    impact: ChangeImpact
    before_text: str | None = Field(default=None, max_length=2000)
    after_text: str | None = Field(default=None, max_length=2000)
    before_citation: Citation | None = None
    after_citation: Citation | None = None
    citations: list[Citation]
    confidence: Confidence
    rationale: str


class CompareVersionsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject_id: str = Field(min_length=1, max_length=128)
    left_version: DocumentVersionContent
    right_version: DocumentVersionContent
    include_unchanged: bool = False


class CompareVersionsResponse(BaseModel):
    result_id: str
    document_id: str
    left_version_id: str
    right_version_id: str
    summary: str
    change_counts: dict[str, int]
    materiality_score: float = Field(ge=0, le=1)
    changes: list[ChangeItem]
    citations: list[Citation]
    sources: list[SourceReference]
    confidence: Confidence
    warnings: list[str] = Field(default_factory=list)
    missing_information: str | None = None


class ComplianceCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject_id: str = Field(min_length=1, max_length=128)
    draft: DraftDocumentInput
    control_query: str = Field(
        default="platne smernice pro rizene dokumenty, platnost, gestor, schvalovani vyjimek",
        min_length=1,
        max_length=4000,
    )
    filters: RagQueryFilters = Field(default_factory=RagQueryFilters)
    control_sources: list[RetrievedChunk] = Field(default_factory=list)
    max_control_chunks: int = Field(default=8, ge=1, le=50)


class ComplianceFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    finding_id: str
    rule_id: str
    rule_name: str
    status: RuleStatus
    severity: FindingSeverity
    message: str
    recommendation: str
    evidence_citations: list[Citation]
    sources: list[SourceReference]
    confidence: Confidence


class ComplianceCheckResponse(BaseModel):
    result_id: str
    status: ComplianceStatus
    summary: str
    findings: list[ComplianceFinding]
    citations: list[Citation]
    sources: list[SourceReference]
    confidence: Confidence
    warnings: list[str] = Field(default_factory=list)
    missing_information: str | None = None


class ConflictDetectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject_id: str = Field(min_length=1, max_length=128)
    documents: list[GovernanceSourceDocument] = Field(min_length=2, max_length=20)
    topic: str | None = Field(default=None, max_length=300)


class ConflictClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")

    statement: str
    citation: Citation
    source: SourceReference


class ConflictFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conflict_id: str
    conflict_type: ConflictType
    severity: FindingSeverity
    summary: str
    claims: list[ConflictClaim]
    recommendation: str
    confidence: Confidence


class ConflictDetectionResponse(BaseModel):
    result_id: str
    summary: str
    conflicts: list[ConflictFinding]
    citations: list[Citation]
    sources: list[SourceReference]
    confidence: Confidence
    warnings: list[str] = Field(default_factory=list)
    missing_information: str | None = None


class GenerateKbArticleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject_id: str = Field(min_length=1, max_length=128)
    source_document: GovernanceSourceDocument
    audience: Literal["employees", "document_managers", "auditors", "general"] = "employees"
    max_sections: int = Field(default=6, ge=2, le=10)


class KbArticleSection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    heading: str
    body: str
    citations: list[Citation]


class KbArticleDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    summary: str
    sections: list[KbArticleSection]
    publication_status: Literal["draft_proposal"]
    registry_required_actions: list[str]


class GenerateKbArticleResponse(BaseModel):
    result_id: str
    article: KbArticleDraft
    citations: list[Citation]
    sources: list[SourceReference]
    confidence: Confidence
    warnings: list[str] = Field(default_factory=list)
    missing_information: str | None = None


class ValidityAlert(BaseModel):
    model_config = ConfigDict(extra="forbid")

    alert_id: str
    document_id: str
    document_version_id: str
    document_title: str
    version_label: str
    valid_to: date
    days_remaining: int
    severity: AlertSeverity
    recommendation: str
    citation: Citation
    source: SourceReference
    confidence: Confidence


class ValidityAlertsResponse(BaseModel):
    result_id: str
    as_of: date
    days_before_expiry: int
    alerts: list[ValidityAlert]
    citations: list[Citation]
    sources: list[SourceReference]
    confidence: Confidence
    warnings: list[str] = Field(default_factory=list)
    missing_information: str | None = None


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str


class ReadinessResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    service: str
    dependencies: dict[str, str]
