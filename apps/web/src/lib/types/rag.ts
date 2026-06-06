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
  status: "ephemeral";
  messages: Record<string, unknown>[];
  warnings: string[];
}
