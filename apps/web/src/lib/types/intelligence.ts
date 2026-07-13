import type { AnalystSearchField, AnalystSearchMode } from "./ingestion";

export type AnalystCaseStatus = "open" | "archived";
export type QueryComposerTokenType = "term" | "phrase" | "field" | "entity" | "operator" | "saved_query";
export type QueryComposerSuggestionSource = "builder" | "field" | "entity" | "dictionary" | "case" | "operator";
export type QueryComposerValidationSeverity = "info" | "warning" | "error";
export type QueryComposerCost = "low" | "medium" | "high";

export interface QueryComposerTokenInput {
  id?: string;
  type: QueryComposerTokenType;
  label?: string;
  value?: string;
  query_fragment?: string;
  entity_type?: string;
  entity_value?: string;
  mode?: AnalystSearchMode;
  field?: AnalystSearchField;
}

export interface QueryComposerSuggestion {
  id: string;
  type: QueryComposerTokenType;
  source: QueryComposerSuggestionSource;
  group: string;
  label: string;
  detail: string;
  value: string;
  query_fragment: string;
  score: number;
  entity_type?: string;
  entity_value?: string;
  mode?: AnalystSearchMode;
  field?: AnalystSearchField;
}

export interface QueryComposerValidationIssue {
  severity: QueryComposerValidationSeverity;
  code: string;
  message: string;
  position?: number;
  token_id?: string;
}

export interface QueryComposerPlan {
  query_text: string;
  normalized_query: string;
  query_mode: AnalystSearchMode;
  search_fields: AnalystSearchField[];
  proximity_slop: number;
  detected_fields: AnalystSearchField[];
  clause_count: number;
  estimated_cost: QueryComposerCost;
  can_run: boolean;
}

export interface QueryComposerRecoveryAction {
  id: string;
  label: string;
  detail: string;
  query_text: string;
  query_mode: AnalystSearchMode;
  search_fields: AnalystSearchField[];
  total_hits: number | null;
}

export interface QueryComposerPreview {
  status: "idle" | "ready" | "unavailable";
  total_hits: number | null;
  query_mode: AnalystSearchMode;
  recovery_actions: QueryComposerRecoveryAction[];
  warnings: string[];
}

export interface QuerySuggestionRequest {
  input?: string | null;
  tokens?: QueryComposerTokenInput[];
  active_case_id?: string | null;
  language?: "cs" | "en";
  limit?: number;
}

export interface QuerySuggestionResponse {
  status: "ready" | "partial";
  input: string;
  suggestions: QueryComposerSuggestion[];
  validation: QueryComposerValidationIssue[];
  plan: QueryComposerPlan;
  preview: QueryComposerPreview;
  generated_at: string;
  warnings: string[];
}

export interface AnalystSavedQuery {
  saved_query_id: string;
  case_id: string;
  title: string;
  query_text: string;
  query_mode: AnalystSearchMode;
  search_fields: string[];
  filters: Record<string, unknown>;
  created_by: string;
  created_at: string;
}

export interface AnalystEvidenceItem {
  evidence_id: string;
  case_id: string;
  title: string;
  note: string | null;
  document_id: string | null;
  document_version_id: string | null;
  document_title: string | null;
  chunk_id: string | null;
  page_number: number | null;
  section_title: string | null;
  source_file_name: string | null;
  score: number | null;
  snippet: string | null;
  entity_types: string[];
  entity_values: string[];
  metadata: Record<string, unknown>;
  created_by: string;
  created_at: string;
}

export interface AnalystCase {
  case_id: string;
  title: string;
  description: string | null;
  status: AnalystCaseStatus;
  owner_id: string;
  classification: string;
  tags: string[];
  metadata: Record<string, unknown>;
  saved_queries: AnalystSavedQuery[];
  evidence_items: AnalystEvidenceItem[];
  created_at: string;
  updated_at: string;
}

export interface CreateAnalystCaseRequest {
  title: string;
  description?: string | null;
  classification?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateAnalystCaseRequest {
  title?: string;
  description?: string | null;
  status?: AnalystCaseStatus;
  classification?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateAnalystSavedQueryRequest {
  title: string;
  query_text: string;
  query_mode: AnalystSearchMode;
  search_fields: AnalystSearchField[];
  filters?: Record<string, unknown>;
}

export interface CreateAnalystEvidenceRequest {
  title: string;
  note?: string | null;
  document_id?: string | null;
  document_version_id?: string | null;
  document_title?: string | null;
  chunk_id?: string | null;
  page_number?: number | null;
  section_title?: string | null;
  source_file_name?: string | null;
  score?: number | null;
  snippet?: string | null;
  entity_types?: string[];
  entity_values?: string[];
  metadata?: Record<string, unknown>;
}
