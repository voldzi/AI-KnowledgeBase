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
    "project_documentation",
    "meeting_record",
    "contract",
    "attachment",
    "other",
]
Classification = Literal["public", "internal", "restricted", "confidential"]
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
    response_language: ResponseLanguage = "cs"


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
    response_language: ResponseLanguage = "cs"


class RagAnswer(BaseModel):
    query_id: str
    answer: str
    confidence: Confidence
    citations: list[Citation]
    warnings: list[str] = Field(default_factory=list)
    used_chunks: list[str] = Field(default_factory=list)
    missing_information: str | None = None


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

    user_id: str = Field(min_length=1, validation_alias=AliasChoices("user_id", "subject_id"))
    conversation_id: str | None = None
    message: str = Field(min_length=1, max_length=4000)
    context: dict[str, Any] = Field(default_factory=dict)
    mode: AnswerMode = "it_support_answer"
    response_language: ResponseLanguage = "cs"


class ClarificationQuestion(BaseModel):
    id: str
    question: str
    type: ClarificationQuestionType
    options: list[str] = Field(default_factory=list)


class AssistantSuggestedAction(BaseModel):
    label: str
    action_type: str
    target: str | None = None


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
    status: Literal["ephemeral"]
    messages: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str


class ReadinessResponse(BaseModel):
    status: Literal["ready", "not_ready"]
    service: str
    dependencies: dict[str, str]
