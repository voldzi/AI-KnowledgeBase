import type { Classification, DocumentType } from "./documents";

export type RagConfidence =
  | "high"
  | "medium"
  | "low"
  | "insufficient_source"
  | "conflicting_sources";

export type ResponseLanguage = "cs" | "en";

export interface Citation {
  document_id: string;
  document_version_id: string;
  document_title: string;
  version_label: string;
  document_version: string;
  section_path: string[];
  page_number: number | null;
  chunk_id: string;
}

export interface RagQueryFilters {
  document_types: DocumentType[];
  only_valid: boolean;
  classification_max: Classification;
  tags: string[];
}

export type AnswerMode =
  | "ask"
  | "standard_answer"
  | "normative_with_citations"
  | "normative_answer_with_citations"
  | "retrieve_only"
  | "compare"
  | "compare_documents"
  | "summary"
  | "extract_obligations"
  | "extract_roles"
  | "extract_deadlines"
  | "extract_risks"
  | "find_procedure"
  | "find_owner"
  | "find_responsibility"
  | "create_checklist"
  | "create_faq"
  | "create_kb_article"
  | "find_conflicts"
  | "find_missing_metadata"
  | "explain_process"
  | "it_support_answer"
  | "manager_brief"
  | "audit_question";

export interface RagQueryRequest {
  subject_id: string;
  query: string;
  filters: RagQueryFilters;
  answer_mode: AnswerMode;
  max_chunks: number;
  response_language?: ResponseLanguage;
}

export interface RagAnswer {
  query_id: string;
  answer: string;
  confidence: RagConfidence;
  citations: Citation[];
  warnings: string[];
  used_chunks: string[];
  missing_information: string | null;
}

export type ViewerMode =
  | "pdf"
  | "markdown"
  | "text"
  | "html"
  | "table"
  | "presentation"
  | "image"
  | "ocr"
  | "binary";

export interface SourceLocation {
  page_number: number | null;
  slide_number: number | null;
  sheet_name: string | null;
  row_number: number | null;
  column_name: string | null;
  section_path: string[];
  section_title: string | null;
  paragraph_number: string | null;
  char_start: number | null;
  char_end: number | null;
  bbox: Record<string, number> | null;
}

export interface SourceContext {
  chunk_id: string;
  document_id: string;
  document_version_id: string;
  document_title: string;
  source_file_uri: string | null;
  source_mime_type: string | null;
  source_file_name: string | null;
  source_size_bytes: number | null;
  source_sha256: string | null;
  viewer_mode: ViewerMode;
  location: SourceLocation;
  chunk_text: string;
  before_text: string;
  after_text: string;
  warnings: string[];
}

export type AssistantResponseType =
  | "answer"
  | "clarification_needed"
  | "no_answer"
  | "restricted"
  | "handoff_recommended";

export type ClarificationQuestionType = "free_text" | "single_choice";

export interface AssistantChatRequest {
  user_id: string;
  conversation_id?: string | null;
  message: string;
  context?: Record<string, unknown>;
  mode?: AnswerMode;
  response_language?: ResponseLanguage;
}

export interface ClarificationQuestion {
  id: string;
  question: string;
  type: ClarificationQuestionType;
  options: string[];
}

export interface AssistantSuggestedAction {
  label: string;
  action_type: string;
  target: string | null;
}

export type AssistantReportColumnType = "text" | "number" | "date" | "url" | "currency" | "percent";

export interface AssistantReportColumn {
  key: string;
  label: string;
  type: AssistantReportColumnType;
  semantic_role?: string | null;
}

export type AssistantReportEvidenceStatus = "cited" | "metadata" | "not_stated" | "uncited";

export interface AssistantReportCellSource {
  column_key: string;
  evidence_status: AssistantReportEvidenceStatus;
  citations: Citation[];
}

export interface AssistantReportRow {
  row_id: string;
  cells: Record<string, string | number | boolean | null>;
  citations: Citation[];
  source_refs?: AssistantReportCellSource[];
  confidence?: RagConfidence | null;
}

export type AssistantReportArtifactKind = "content_table" | "registry_metadata_table";

export interface AssistantReportArtifactProvenance {
  generated_from: "rag_markdown_table" | "rag_structured_artifact" | "registry_metadata";
  assistant_tool: string;
  query_plan_id: string | null;
  citations_required: boolean;
  row_citations_required: boolean;
}

export interface AssistantReportArtifactQuality {
  status: "validated";
  issues: string[];
  informative_row_count: number;
  row_citation_coverage: number;
}

export interface AssistantReportArtifact {
  artifact_id: string;
  artifact_contract_version?: string;
  artifact_kind?: AssistantReportArtifactKind;
  title: string;
  description: string | null;
  columns: AssistantReportColumn[];
  rows: AssistantReportRow[];
  export_formats: Array<"xlsx" | "pdf">;
  source_citation_count: number;
  warnings: string[];
  provenance?: AssistantReportArtifactProvenance;
  quality?: AssistantReportArtifactQuality;
}

export interface AssistantChatResponse {
  response_type: AssistantResponseType;
  conversation_id: string;
  answer: string | null;
  message: string | null;
  questions: ClarificationQuestion[];
  why_needed: string | null;
  current_context: Record<string, unknown>;
  citations: Citation[];
  follow_up_questions: string[];
  suggested_actions: AssistantSuggestedAction[];
  report_artifacts: AssistantReportArtifact[];
  confidence: RagConfidence | null;
  warnings: string[];
  missing_information: string | null;
  recommended_action: string | null;
}

export interface AssistantSuggestion {
  label: string;
  prompt: string;
  domain: string;
  audience: string;
}

export interface AssistantSuggestionsResponse {
  suggestions: AssistantSuggestion[];
}

export interface AssistantConversationResponse {
  conversation_id: string;
  status: "ephemeral" | "persisted";
  messages: Record<string, unknown>[];
  warnings: string[];
}

export interface AssistantConversationMessage {
  message_id: string;
  role: "user" | "assistant";
  author_subject_id: string;
  author_subject_type: "user" | "service";
  author_display_name: string | null;
  content: string;
  response_type: AssistantResponseType | null;
  citations: Citation[];
  metadata: Record<string, unknown>;
  availability?: "available" | "source_access_changed";
  created_at: string;
}

export interface AssistantConversationShare {
  conversation_share_id: string;
  subject_type: "user" | "group";
  subject_id: string;
  subject_display_name: string | null;
  permission: "viewer" | "commenter";
  status: "active" | "removed";
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AssistantConversationDetail {
  conversation_id: string;
  user_id: string;
  status: "active" | "archived";
  title: string | null;
  visibility: "private" | "shared";
  retention_until: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  shared_with: AssistantConversationShare[];
  messages: AssistantConversationMessage[];
}

export interface AssistantConversationListItem {
  conversation_id: string;
  user_id: string;
  status: "active" | "archived";
  title: string | null;
  visibility: "private" | "shared";
  retention_until: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  shared_with: AssistantConversationShare[];
  message_count: number;
}

export interface AssistantConversationListResponse {
  items: AssistantConversationListItem[];
  limit: number;
  offset: number;
}

export interface AssistantConversationPatchRequest {
  title?: string | null;
  status?: "active" | "archived";
  visibility?: "private" | "shared";
  retention_until?: string | null;
}

export interface AssistantConversationMessageAppendRequest {
  user_id: string;
  title?: string | null;
  visibility?: "private" | "shared";
  retention_until?: string | null;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    response_type?: AssistantResponseType | null;
    citations?: Citation[];
    metadata?: Record<string, unknown>;
  }>;
}

export interface AssistantConversationShareReplaceRequest {
  visibility?: "private" | "shared";
  shares: Array<{
    subject_type: "user" | "group";
    subject_id: string;
    permission: "viewer" | "commenter";
  }>;
}
