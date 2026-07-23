from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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
    "ai_intake",
    "ai_requirement_card",
    "ai_security_appendix",
    "ai_governance_evidence",
    "other",
]
Classification = Literal["public", "internal", "restricted", "confidential"]
PolicyObligation = Literal[
    "AUDIT_ACCESS",
    "NO_EXTERNAL_AI",
    "LOCAL_PROCESSING_ONLY",
    "NO_PUBLIC_EXPORT",
    "NO_EXPORT",
    "WATERMARK",
    "ENCRYPT_AT_REST",
    "RECIPIENT_CONFIRMATION",
    "ORIGINATOR_APPROVAL",
    "PAP_ENFORCEMENT",
]
AnswerMode = Literal[
    "ask",
    "standard_answer",
    "normative_with_citations",
    "normative_answer_with_citations",
    "retrieve_only",
    "compare",
    "compare_documents",
    "summary",
    "extract_obligations",
    "extract_roles",
    "extract_deadlines",
    "extract_risks",
    "find_procedure",
    "find_owner",
    "find_responsibility",
    "create_checklist",
    "create_faq",
    "create_kb_article",
    "find_conflicts",
    "find_missing_metadata",
    "explain_process",
    "it_support_answer",
    "manager_brief",
    "audit_question",
]
Confidence = Literal["high", "medium", "low", "insufficient_source", "conflicting_sources"]
ViewerMode = Literal["pdf", "markdown", "text", "html", "table", "presentation", "image", "ocr", "binary"]
ResponseLanguage = Literal["cs", "en"]
AssistantResponseType = Literal["answer", "clarification_needed", "no_answer", "restricted", "handoff_recommended"]
ClarificationQuestionType = Literal["free_text", "single_choice"]
AssistantReportColumnType = Literal["text", "number", "date", "url", "currency", "percent"]
AssistantReportEvidenceStatus = Literal["cited", "metadata", "not_stated", "uncited"]
AssistantReportArtifactKind = Literal["content_table", "registry_metadata_table"]
AssistantReportGeneratedFrom = Literal["rag_markdown_table", "rag_structured_artifact", "registry_metadata"]
ExtractionStatus = Literal[
    "PENDING",
    "RUNNING",
    "PROPOSED",
    "PARTIAL",
    "FAILED",
    "SUPERSEDED",
    "ACCEPTED_IN_SOURCE_APP",
    "REJECTED_IN_SOURCE_APP",
]
ExtractionFieldStatus = Literal["proposed"]
ExtractionFeedbackDecision = Literal["accepted", "rejected", "edited"]
StratosExtractionSourceApp = Literal["STRATOS_BUDGET", "STRATOS_ARCHFLOW"]
ArchflowArtifactType = Literal[
    "TARGET_ARCHITECTURE",
    "SOLUTION_ARCHITECTURE",
    "INTEGRATION_SPEC",
    "DATA_SECURITY_ASSESSMENT",
    "ARCHITECTURE_DECISION",
    "AS_BUILT_ARCHITECTURE",
    "HANDOVER_PACKAGE",
]


class RagQueryFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_types: list[DocumentType] = Field(default_factory=list)
    only_valid: bool = True
    classification_max: Classification = "internal"
    tags: list[str] = Field(default_factory=list)
    document_ids: list[str] = Field(default_factory=list)
    document_version_ids: list[str] = Field(default_factory=list)
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    external_system: str | None = Field(default=None, min_length=1, max_length=80)


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


class CitationPolicyAudience(BaseModel):
    model_config = ConfigDict(extra="forbid")

    organizationId: Literal["org_stratos"]
    scopeType: Literal[
        "organization",
        "organization_unit",
        "budget_scope",
        "project",
        "document",
        "recipient_set",
        "public",
    ]
    scopeIds: list[str] = Field(default_factory=list)
    recipientSubjectIds: list[str] = Field(default_factory=list)


class CitationPolicySummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    policyBindingId: str = Field(min_length=8, max_length=200)
    policyVersion: Literal["information-policy-2.0.0"]
    handlingClass: Literal["PUBLIC", "INTERNAL", "PROJECT_MANAGEMENT", "RESTRICTED"]
    legalClassification: Literal["NONE"]
    tlp: Literal["TLP:RED", "TLP:AMBER+STRICT", "TLP:AMBER", "TLP:GREEN", "TLP:CLEAR"] | None = None
    pap: Literal["PAP:RED", "PAP:AMBER", "PAP:GREEN", "PAP:CLEAR"] | None = None
    obligations: list[PolicyObligation] = Field(default_factory=list)
    contentCategories: list[str] = Field(default_factory=list)
    audience: CitationPolicyAudience


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
    policy_binding_id: str | None = None
    policy_version: str | None = None
    policy_hash: str | None = None
    policy_summary: CitationPolicySummary | None = None
    policy_summary_hash: str | None = Field(default=None, pattern=r"^sha256:[a-f0-9]{64}$")
    document_context_tags: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("document_context_tags")
    @classmethod
    def validate_document_context_tags(cls, value: list[str]) -> list[str]:
        if any(not item or len(item) > 120 for item in value) or len(set(value)) != len(value):
            raise ValueError("document_context_tags must be unique bounded strings")
        return value

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
    response_language: ResponseLanguage = "cs"


class RetrieveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject_id: str = Field(min_length=1)
    query: str = Field(min_length=1, max_length=4000)
    filters: RagQueryFilters = Field(default_factory=RagQueryFilters)
    max_chunks: int = Field(default=8, ge=1, le=50)


class RetrieveResponse(BaseModel):
    query_id: str
    chunks: list[RetrievedChunk]
    warnings: list[str] = Field(default_factory=list)
    retrieval_profile: str | None = None
    retrieval_diagnostics: dict[str, Any] = Field(default_factory=dict)


class AnswerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject_id: str = Field(min_length=1)
    query: str = Field(min_length=1, max_length=4000)
    chunks: list[RetrievedChunk] = Field(default_factory=list)
    answer_mode: AnswerMode = "normative_with_citations"
    max_chunks: int = Field(default=8, ge=1, le=20)
    response_language: ResponseLanguage = "cs"


class RagAnswer(BaseModel):
    query_id: str
    answer: str
    confidence: Confidence
    citations: list[Citation]
    warnings: list[str] = Field(default_factory=list)
    used_chunks: list[str] = Field(default_factory=list)
    missing_information: str | None = None
    policy_bindings: list[dict[str, str]] = Field(default_factory=list)
    obligations: list[str] = Field(default_factory=list)
    claims: list[dict[str, Any]] = Field(default_factory=list)
    evidence_status: Literal["supported", "partial", "unsupported", "not_checked"] = "not_checked"
    verification_model: str | None = None
    conflicts: list[dict[str, Any]] = Field(default_factory=list)


class SourceLocation(BaseModel):
    page_number: int | None = Field(default=None, ge=1)
    slide_number: int | None = Field(default=None, ge=1)
    sheet_name: str | None = None
    row_number: int | None = Field(default=None, ge=1)
    column_name: str | None = None
    section_path: list[str] = Field(default_factory=list)
    section_title: str | None = None
    paragraph_number: str | None = None
    char_start: int | None = Field(default=None, ge=0)
    char_end: int | None = Field(default=None, ge=0)
    bbox: dict[str, float] | None = None


class SourceContextResponse(BaseModel):
    chunk_id: str
    document_id: str
    document_version_id: str
    document_title: str
    policy_binding_id: str | None = None
    policy_version: str | None = None
    policy_hash: str | None = None
    source_file_uri: str | None = None
    source_mime_type: str | None = None
    source_file_name: str | None = None
    source_size_bytes: int | None = Field(default=None, ge=0)
    source_sha256: str | None = None
    viewer_mode: ViewerMode
    location: SourceLocation
    chunk_text: str
    before_text: str = ""
    after_text: str = ""
    warnings: list[str] = Field(default_factory=list)


class AssistantChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str = Field(min_length=1)
    conversation_id: str | None = None
    message: str = Field(min_length=1, max_length=4000)
    context: dict[str, Any] = Field(default_factory=dict)
    mode: AnswerMode = "it_support_answer"
    response_language: ResponseLanguage = "cs"
    persist_conversation: bool = True


class ClarificationQuestion(BaseModel):
    id: str
    question: str
    type: ClarificationQuestionType
    options: list[str] = Field(default_factory=list)


class AssistantSuggestedAction(BaseModel):
    label: str
    action_type: str
    target: str | None = None


class AssistantReportColumn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=120)
    type: AssistantReportColumnType = "text"
    semantic_role: str | None = Field(default=None, max_length=80)


class AssistantReportCellSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    column_key: str = Field(min_length=1, max_length=64)
    evidence_status: AssistantReportEvidenceStatus
    citations: list[Citation] = Field(default_factory=list)


class AssistantReportRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row_id: str = Field(min_length=1, max_length=96)
    cells: dict[str, str | int | float | bool | None] = Field(default_factory=dict)
    citations: list[Citation] = Field(default_factory=list)
    source_refs: list[AssistantReportCellSource] = Field(default_factory=list)
    confidence: Confidence | None = None


class AssistantReportArtifactProvenance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generated_from: AssistantReportGeneratedFrom
    assistant_tool: str = Field(min_length=1, max_length=80)
    query_plan_id: str | None = Field(default=None, max_length=96)
    citations_required: bool = True
    row_citations_required: bool = True


class AssistantReportArtifactQuality(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["validated"] = "validated"
    issues: list[str] = Field(default_factory=list)
    informative_row_count: int = Field(default=0, ge=0)
    row_citation_coverage: float = Field(default=0.0, ge=0.0, le=1.0)


class AssistantReportArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    artifact_id: str = Field(min_length=1, max_length=96)
    artifact_contract_version: str | None = Field(default=None, max_length=40)
    artifact_kind: AssistantReportArtifactKind | None = None
    title: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=600)
    columns: list[AssistantReportColumn] = Field(default_factory=list, max_length=20)
    rows: list[AssistantReportRow] = Field(default_factory=list, max_length=500)
    export_formats: list[Literal["xlsx", "pdf"]] = Field(default_factory=lambda: ["xlsx", "pdf"])
    source_citation_count: int = Field(default=0, ge=0)
    warnings: list[str] = Field(default_factory=list)
    provenance: AssistantReportArtifactProvenance | None = None
    quality: AssistantReportArtifactQuality | None = None


class AssistantChatResponse(BaseModel):
    response_type: AssistantResponseType
    conversation_id: str
    answer: str | None = None
    message: str | None = None
    questions: list[ClarificationQuestion] = Field(default_factory=list)
    why_needed: str | None = None
    current_context: dict[str, Any] = Field(default_factory=dict)
    citations: list[Citation] = Field(default_factory=list)
    follow_up_questions: list[str] = Field(default_factory=list)
    suggested_actions: list[AssistantSuggestedAction] = Field(default_factory=list)
    report_artifacts: list[AssistantReportArtifact] = Field(default_factory=list)
    confidence: Confidence | None = None
    warnings: list[str] = Field(default_factory=list)
    missing_information: str | None = None
    recommended_action: str | None = None


class AssistantSuggestion(BaseModel):
    label: str
    prompt: str
    domain: str
    audience: str = "employee"


class AssistantSuggestionsResponse(BaseModel):
    suggestions: list[AssistantSuggestion]


class AssistantConversationResponse(BaseModel):
    conversation_id: str
    status: Literal["ephemeral", "persisted"]
    messages: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ContractExtractionProposeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tenant_id: str = Field(min_length=1, max_length=128)
    external_system: Literal["STRATOS_BUDGET"] = "STRATOS_BUDGET"
    external_ref: str = Field(min_length=1, max_length=240)
    entity_type: str = Field(min_length=1, max_length=80)
    entity_id: str = Field(min_length=1, max_length=128)
    document_id: str = Field(min_length=1, max_length=64)
    document_version_id: str = Field(min_length=1, max_length=64)
    subject_id: str = Field(min_length=1, max_length=128)
    profile: Literal["contract_financial_v1"] = "contract_financial_v1"
    profile_version: Literal["1", "2"] = "1"
    classification_max: Classification = "internal"
    context_tags: list[str] = Field(default_factory=list)
    max_chunks: int = Field(default=12, ge=1, le=20)
    correlation_id: str | None = Field(default=None, max_length=128)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ArchflowSourceDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str = Field(min_length=1, max_length=64)
    document_version_id: str = Field(min_length=1, max_length=64)
    canonical_url: str | None = Field(default=None, max_length=500)
    classification: Classification | None = None


class ArchflowGoalExtractionProposeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tenant_id: str = Field(min_length=1, max_length=128)
    external_system: Literal["STRATOS_ARCHFLOW"] = "STRATOS_ARCHFLOW"
    external_ref: str = Field(min_length=1, max_length=240)
    entity_type: Literal["ArchflowSourceSet", "ArchflowGoalCatalogVersion", "ArchflowNeed"]
    entity_id: str = Field(min_length=1, max_length=128)
    source_set_id: str | None = Field(default=None, min_length=1, max_length=128)
    catalog_version_id: str | None = Field(default=None, min_length=1, max_length=128)
    documents: list[ArchflowSourceDocument] = Field(default_factory=list, max_length=50)
    subject_id: str = Field(min_length=1, max_length=128)
    profile: Literal["archflow_goal_extraction_v1"] = "archflow_goal_extraction_v1"
    profile_version: str = Field(default="1", min_length=1, max_length=40)
    classification_max: Classification = "internal"
    context_tags: list[str] = Field(default_factory=list)
    max_chunks: int = Field(default=18, ge=1, le=20)
    correlation_id: str | None = Field(default=None, max_length=128)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_archflow_context(self) -> "ArchflowGoalExtractionProposeRequest":
        if self.entity_type == "ArchflowSourceSet":
            if not self.source_set_id:
                raise ValueError("source_set_id is required for ArchflowSourceSet extraction.")
            if not self.documents:
                raise ValueError("documents must contain at least one AKB document for ArchflowSourceSet extraction.")
        if self.entity_type in {"ArchflowGoalCatalogVersion", "ArchflowNeed"}:
            if not self.catalog_version_id:
                raise ValueError("catalog_version_id is required for catalog version extraction.")
            if not self.source_set_id:
                raise ValueError("source_set_id is required for catalog version extraction.")
        return self


class ArchflowArchitectureExtractionProposeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tenant_id: str = Field(min_length=1, max_length=128)
    external_system: Literal["STRATOS_ARCHFLOW"] = "STRATOS_ARCHFLOW"
    external_ref: str = Field(min_length=1, max_length=240)
    entity_type: Literal["ArchitectureArtifact", "ArchflowSourceSet", "ArchflowGoalCatalogVersion", "ArchflowNeed"]
    entity_id: str = Field(min_length=1, max_length=128)
    need_id: str | None = Field(default=None, min_length=1, max_length=128)
    source_set_id: str | None = Field(default=None, min_length=1, max_length=128)
    catalog_version_id: str | None = Field(default=None, min_length=1, max_length=128)
    artifact_type: ArchflowArtifactType
    document_id: str | None = Field(default=None, min_length=1, max_length=64)
    document_version_id: str | None = Field(default=None, min_length=1, max_length=64)
    documents: list[ArchflowSourceDocument] = Field(default_factory=list, max_length=50)
    subject_id: str = Field(min_length=1, max_length=128)
    profile: Literal["architecture_package_review_v1", "architecture_handover_v1"]
    profile_version: str = Field(default="1", min_length=1, max_length=40)
    classification_max: Classification = "internal"
    context_tags: list[str] = Field(default_factory=list)
    max_chunks: int = Field(default=18, ge=1, le=20)
    correlation_id: str | None = Field(default=None, max_length=128)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_archflow_artifact_context(self) -> "ArchflowArchitectureExtractionProposeRequest":
        if (self.document_id and not self.document_version_id) or (self.document_version_id and not self.document_id):
            raise ValueError("document_id and document_version_id must be provided together.")
        if self.document_id and self.documents:
            explicit_pair = (self.document_id, self.document_version_id)
            document_pairs = {(document.document_id, document.document_version_id) for document in self.documents}
            if explicit_pair not in document_pairs:
                raise ValueError("documents must contain the explicit document_id/document_version_id pair.")
        if not self.documents and self.document_id and self.document_version_id:
            self.documents = [
                ArchflowSourceDocument(
                    document_id=self.document_id,
                    document_version_id=self.document_version_id,
                    canonical_url=None,
                    classification=None,
                )
            ]
        if self.entity_type == "ArchitectureArtifact" and not self.need_id:
            raise ValueError("need_id is required for ArchitectureArtifact extraction.")
        if not self.documents and self.entity_type == "ArchitectureArtifact":
            raise ValueError("ArchitectureArtifact extraction requires at least one AKB document/version reference.")
        return self


class ContractExtractionCitation(BaseModel):
    document_id: str
    document_version_id: str
    chunk_id: str
    page_number: int | None = Field(default=None, ge=1)
    section_path: list[str] = Field(default_factory=list)
    section: str | None = None
    quoted_text: str
    viewer_url: str
    warnings: list[str] = Field(default_factory=list)


class ContractPaymentRuleProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rule_type: Literal[
        "MONTHLY",
        "QUARTERLY",
        "HALF_YEARLY",
        "YEARLY",
        "ONE_OFF",
        "ACCEPTANCE",
        "MILESTONE",
        "TIME_AND_MATERIAL",
        "CALL_OFF",
    ]
    name: str = Field(min_length=1, max_length=160)
    amount: int | float | None = None
    amount_basis: Literal["PER_PERIOD", "ONE_OFF", "UNIT_PRICE", "VARIABLE_DRAWDOWN"]
    vat_basis: Literal["WITHOUT_VAT", "WITH_VAT", "UNSPECIFIED"] = "UNSPECIFIED"
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    periodicity_months: Literal[1, 3, 6, 12] | None = None
    payment_timing: Literal[
        "ADVANCE",
        "ARREARS",
        "FIXED_DATE",
        "ON_ACCEPTANCE",
        "ON_MILESTONE",
        "ON_CALL",
        "UNSPECIFIED",
    ] = "UNSPECIFIED"
    due_date: date | None = None
    payment_terms_days: int | None = Field(default=None, ge=0, le=365)
    is_call_off: bool = False
    generates_cashflow: bool = False
    requires_confirmation: Literal[True] = True
    citation: ContractExtractionCitation
    payment_terms_citation: ContractExtractionCitation | None = None

    @field_validator("amount")
    @classmethod
    def validate_amount(cls, value: int | float | None) -> int | float | None:
        if value is None:
            return None
        if value < 0:
            raise ValueError("amount must not be negative.")
        return value

    @model_validator(mode="after")
    def validate_fail_closed_cashflow(self) -> "ContractPaymentRuleProposal":
        if self.payment_timing in {"ON_CALL", "UNSPECIFIED"} and self.generates_cashflow:
            raise ValueError("ON_CALL and UNSPECIFIED payment timing cannot request automatic cashflow.")
        if self.amount_basis in {"UNIT_PRICE", "VARIABLE_DRAWDOWN"} and self.generates_cashflow:
            raise ValueError("Variable and unit-price payment rules cannot request automatic cashflow.")
        if self.generates_cashflow and self.amount is None:
            raise ValueError("Automatic cashflow requires a cited payment amount.")
        if self.amount is not None and self.currency is None:
            raise ValueError("A cited payment amount requires its currency.")
        if self.payment_timing == "FIXED_DATE" and not self.due_date:
            raise ValueError("FIXED_DATE payment timing requires due_date.")
        if (
            self.payment_timing in {"ON_ACCEPTANCE", "ON_MILESTONE"}
            and self.generates_cashflow
            and not self.due_date
        ):
            raise ValueError("Event-based automatic cashflow requires a cited due_date.")
        if self.rule_type == "CALL_OFF" and (
            not self.is_call_off
            or self.payment_timing != "ON_CALL"
            or self.amount_basis != "VARIABLE_DRAWDOWN"
        ):
            raise ValueError("CALL_OFF rules must remain variable, explicitly call-off and ON_CALL.")
        expected_periodicity = {
            "MONTHLY": 1,
            "QUARTERLY": 3,
            "HALF_YEARLY": 6,
            "YEARLY": 12,
        }.get(self.rule_type)
        if expected_periodicity is not None and self.periodicity_months != expected_periodicity:
            raise ValueError("Recurring rule type and periodicity_months are inconsistent.")
        if expected_periodicity is not None and self.amount_basis != "PER_PERIOD":
            raise ValueError("Recurring payment rules must use PER_PERIOD amount basis.")
        if self.rule_type in {"ONE_OFF", "ACCEPTANCE", "MILESTONE"} and (
            self.periodicity_months is not None
            or self.amount_basis != "ONE_OFF"
        ):
            raise ValueError("Event and one-off payment rules must use ONE_OFF without periodicity.")
        if self.rule_type == "ACCEPTANCE" and self.payment_timing != "ON_ACCEPTANCE":
            raise ValueError("ACCEPTANCE rules must use ON_ACCEPTANCE timing.")
        if self.rule_type == "MILESTONE" and self.payment_timing not in {"ON_MILESTONE", "FIXED_DATE"}:
            raise ValueError("MILESTONE rules must use ON_MILESTONE or FIXED_DATE timing.")
        if self.rule_type == "TIME_AND_MATERIAL" and self.amount_basis not in {
            "UNIT_PRICE",
            "VARIABLE_DRAWDOWN",
        }:
            raise ValueError("TIME_AND_MATERIAL rules must remain unit-price or variable.")
        return self


class ContractPaymentScheduleV1Item(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frequency: str
    normalized_frequency: Literal["monthly", "quarterly", "annually"]
    amount: int | float
    currency: str
    chunk_id: str
    page_number: int | None = Field(default=None, ge=1)


ContractFieldValue = (
    str
    | int
    | float
    | list[ContractPaymentRuleProposal]
    | list[ContractPaymentScheduleV1Item]
)


class ContractFieldProposal(BaseModel):
    field: str
    proposed_value: ContractFieldValue
    normalized_value: ContractFieldValue | None = None
    unit: str | None = None
    confidence: Confidence
    status: ExtractionFieldStatus = "proposed"
    reason: str
    citation: ContractExtractionCitation
    warnings: list[str] = Field(default_factory=list)


class ArchflowSuggestedMetric(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)
    target: str | None = Field(default=None, max_length=160)
    periodicity: str | None = Field(default=None, max_length=80)


class ArchflowCandidateRequirement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    requirement_type: str = Field(default="functional", min_length=1, max_length=80)
    acceptance_criteria: str | None = Field(default=None, max_length=1000)


class ArchflowGoalProposalValue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    goal_type: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=240)
    description: str = Field(min_length=1, max_length=1200)
    parent_hint: str | None = Field(default=None, max_length=240)
    priority: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] | None = None
    obligation_type: Literal["SHALL", "SHOULD", "MAY"] | None = None
    suggested_metrics: list[ArchflowSuggestedMetric] = Field(default_factory=list, max_length=8)
    candidate_requirements: list[ArchflowCandidateRequirement] = Field(default_factory=list, max_length=8)
    legal_basis: str | None = Field(default=None, max_length=1000)
    risk: str | None = Field(default=None, max_length=1000)


class ArchflowGoalFieldProposal(BaseModel):
    field: Literal["goal", "capability", "obligation", "requirement", "metric", "legal_basis", "risk"]
    status: ExtractionFieldStatus = "proposed"
    confidence: Confidence
    proposal: ArchflowGoalProposalValue
    reason: str = Field(min_length=1, max_length=1000)
    citation: ContractExtractionCitation
    warnings: list[str] = Field(default_factory=list)


class ArchflowArchitectureFieldProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str = Field(min_length=1, max_length=120)
    status: ExtractionFieldStatus = "proposed"
    confidence: Confidence
    proposal: dict[str, Any] = Field(default_factory=dict)
    reason: str = Field(min_length=1, max_length=1000)
    citation: ContractExtractionCitation
    warnings: list[str] = Field(default_factory=list)


class ContractExtractionResponse(BaseModel):
    extraction_id: str
    tenant_id: str
    external_system: str
    external_ref: str
    entity_type: str
    entity_id: str
    document_id: str
    document_version_id: str
    profile: str
    profile_version: str
    status: ExtractionStatus
    classification: Classification
    requested_by: str
    proposals: list[ContractFieldProposal] = Field(default_factory=list)
    missing_information: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    source_chunk_ids: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ArchflowGoalExtractionResponse(BaseModel):
    extraction_id: str
    tenant_id: str
    external_system: str
    external_ref: str
    entity_type: str
    entity_id: str
    document_id: str
    document_version_id: str
    profile: str
    profile_version: str
    status: ExtractionStatus
    classification: Classification
    requested_by: str
    proposals: list[ArchflowGoalFieldProposal] = Field(default_factory=list)
    missing_information: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    source_chunk_ids: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ArchflowArchitectureExtractionResponse(BaseModel):
    extraction_id: str
    tenant_id: str
    external_system: str
    external_ref: str
    entity_type: str
    entity_id: str
    document_id: str
    document_version_id: str
    profile: str
    profile_version: str
    status: ExtractionStatus
    classification: Classification
    requested_by: str
    proposals: list[ArchflowArchitectureFieldProposal] = Field(default_factory=list)
    missing_information: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    source_chunk_ids: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class StratosExtractionResponse(BaseModel):
    extraction_id: str
    tenant_id: str
    external_system: str
    external_ref: str
    entity_type: str
    entity_id: str
    document_id: str
    document_version_id: str
    profile: str
    profile_version: str
    status: ExtractionStatus
    classification: Classification
    requested_by: str
    proposals: list[dict[str, Any]] = Field(default_factory=list)
    missing_information: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    source_chunk_ids: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ContractExtractionProfile(BaseModel):
    profile: str
    profile_version: str
    title: str
    description: str
    supported_external_systems: list[str]
    fields: list[str]


class ContractExtractionProfilesResponse(BaseModel):
    profiles: list[ContractExtractionProfile]


class StratosExtractionFeedbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str = Field(min_length=1, max_length=160)
    ai_value: Any | None = None
    final_value: Any | None = None
    decision: ExtractionFeedbackDecision
    reason: str | None = Field(default=None, max_length=2000)
    actor: str = Field(min_length=1, max_length=128)
    source_app: StratosExtractionSourceApp
    source_entity_id: str = Field(min_length=1, max_length=128)
    correlation_id: str | None = Field(default=None, max_length=128)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ContractExtractionFeedbackRequest(StratosExtractionFeedbackRequest):
    source_app: StratosExtractionSourceApp = "STRATOS_BUDGET"


class StratosExtractionFeedbackResponse(BaseModel):
    feedback_id: str
    extraction: StratosExtractionResponse


class ContractExtractionFeedbackResponse(StratosExtractionFeedbackResponse):
    pass


AiipClassification = Literal["public", "internal"]
AiipModelPreference = Literal["standard", "high_quality"]


class AiipRecordInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    record_id: str = Field(min_length=1, max_length=128)
    record_version: str | None = Field(default=None, max_length=64)
    title: str = Field(min_length=1, max_length=240)
    summary: str = Field(min_length=1, max_length=12000)
    problem_statement: str | None = Field(default=None, max_length=4000)
    proposed_solution: str | None = Field(default=None, max_length=4000)
    expected_benefits: list[str] = Field(default_factory=list, max_length=20)
    strategic_domains: list[str] = Field(default_factory=list, max_length=20)
    keywords: list[str] = Field(default_factory=list, max_length=30)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("expected_benefits", "strategic_domains", "keywords")
    @classmethod
    def normalize_aiip_strings(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for value in values:
            item = value.strip() if isinstance(value, str) else ""
            if not item or item in seen:
                continue
            if len(item) > 500:
                raise ValueError("AIIP list values must not exceed 500 characters")
            seen.add(item)
            normalized.append(item)
        return normalized


class AiipHarmonizeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tenant_id: str = Field(min_length=1, max_length=128)
    classification: Classification
    processing_purpose: Literal["idea_harmonization"]
    model_preference: AiipModelPreference = "standard"
    locale: Literal["cs", "en"] = "cs"
    record: AiipRecordInput


class AiipDuplicateSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tenant_id: str = Field(min_length=1, max_length=128)
    classification: Classification
    processing_purpose: Literal["duplicate_detection"]
    model_preference: AiipModelPreference = "standard"
    record: AiipRecordInput
    limit: int = Field(default=10, ge=1, le=20)
    offset: int = Field(default=0, ge=0, le=200)
    min_score: float = Field(default=0.35, ge=0, le=1)


class AiipFieldProvenance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["aiip_record", "model_inference"]
    input_fields: list[str] = Field(default_factory=list)
    prompt_template_version: str


class AiipFieldSuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str = Field(min_length=1, max_length=120)
    proposed_value: Any
    confidence: float = Field(ge=0, le=1)
    provenance: AiipFieldProvenance


class AiipHarmonizeResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    suggestions: list[AiipFieldSuggestion] = Field(default_factory=list, max_length=30)
    review_required: Literal[True] = True


class AiipDuplicateCitation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str
    document_version_id: str
    chunk_id: str
    document_title: str
    version_label: str
    section_path: list[str] = Field(default_factory=list)
    page_number: int | None = Field(default=None, ge=1)


class AiipDuplicateCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    candidate_id: str
    source_system: str
    source_record_id: str | None = None
    akb_document_id: str
    score: float = Field(ge=0, le=1)
    matched_areas: list[str] = Field(default_factory=list)
    citations: list[AiipDuplicateCitation] = Field(default_factory=list)


class AiipDuplicateSearchResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    candidates: list[AiipDuplicateCandidate] = Field(default_factory=list)
    limit: int
    offset: int
    returned: int
    has_more: bool = False


class AiipModelMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requested_preference: AiipModelPreference
    requested_model: str
    actual_model: str
    fallback_applied: bool
    model_digest: str | None = None


class AiipUsage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt_tokens: int = Field(default=0, ge=0)
    completion_tokens: int = Field(default=0, ge=0)
    total_tokens: int = Field(default=0, ge=0)


class AiipApplicationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = "1.0"
    request_id: str
    correlation_id: str
    audit_event_id: str
    status: Literal["completed"] = "completed"
    result: AiipHarmonizeResult | AiipDuplicateSearchResult
    warnings: list[str] = Field(default_factory=list)
    model: AiipModelMetadata
    prompt_template_version: str
    retrieval_index_version: str | None = None
    usage: AiipUsage
    latency_ms: int = Field(ge=0)


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str


class ReadinessResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    service: str
    dependencies: dict[str, str]
