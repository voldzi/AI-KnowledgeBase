import type { Classification, DocumentType } from "./documents";

export type RagConfidence =
  | "high"
  | "medium"
  | "low"
  | "insufficient_source"
  | "conflicting_sources";

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

export interface RagQueryRequest {
  subject_id: string;
  query: string;
  filters: RagQueryFilters;
  answer_mode: "normative_with_citations" | "retrieve_only" | "compare";
  max_chunks: number;
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
