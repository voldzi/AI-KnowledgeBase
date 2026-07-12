export type IngestionStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "completed_with_warnings";

export interface IngestionJob {
  job_id: string;
  document_id: string;
  document_version_id: string;
  status: IngestionStatus;
  parser_profile: "controlled_document" | "plain_text" | "ocr_heavy";
  ocr_enabled: boolean;
  chunking_strategy: "legal_structured" | "semantic" | "fixed_window";
  embedding_profile: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface CreateIngestionJobRequest {
  document_id: string;
  document_version_id: string;
  source_file_uri: string;
  parser_profile: IngestionJob["parser_profile"];
  ocr_enabled: boolean;
  chunking_strategy: IngestionJob["chunking_strategy"];
  embedding_profile: string;
}

export interface IngestionReportMessage {
  code: string;
  message: string;
}

export interface IngestionReport {
  job_id: string;
  status: IngestionStatus;
  documents_processed: number;
  pages_processed: number;
  chunks_created: number;
  tables_detected: number;
  ocr_used: boolean;
  warnings: IngestionReportMessage[];
  errors: IngestionReportMessage[];
}

export interface EntityFacetBucket {
  key: string;
  label: string;
  count: number;
}

export interface EntityFacetGroup {
  entity_type: string;
  label: string;
  count: number;
  values: EntityFacetBucket[];
}

export interface EntityFacetReport {
  status: "ready" | "unavailable";
  index_name: string;
  total_chunks: number;
  chunks_with_entities: number;
  entity_types: EntityFacetBucket[];
  entity_groups: EntityFacetGroup[];
  generated_at: string;
  warnings: IngestionReportMessage[];
}

export interface EntitySearchRequest {
  query?: string | null;
  entity_type?: string | null;
  entity_value?: string | null;
  document_type?: string | null;
  classification?: string | null;
  status?: string | null;
  allowed_document_ids?: string[];
  allowed_policy_hashes?: Record<string, string[]>;
  limit?: number;
}

export interface EntitySearchHit {
  chunk_id: string;
  document_id: string;
  document_version_id: string;
  document_title: string;
  version_label: string | null;
  document_type: string | null;
  classification: string | null;
  status: string | null;
  policy_binding_id?: string | null;
  policy_version?: string | null;
  policy_hash?: string | null;
  score: number;
  snippet: string;
  page_number: number | null;
  section_title: string | null;
  section_path: string[];
  source_file_name: string | null;
  entity_types: string[];
  entity_values: string[];
  entity_pairs: string[];
}

export interface EntitySearchResponse {
  status: "ready" | "unavailable";
  index_name: string;
  total_hits: number;
  returned_hits: number;
  hits: EntitySearchHit[];
  generated_at: string;
  warnings: IngestionReportMessage[];
}

export type AnalystSearchMode = "smart" | "boolean" | "phrase" | "proximity" | "fielded";
export type AnalystSearchField = "all" | "title" | "body" | "section" | "entity" | "source";

export interface AnalystSearchRequest {
  query?: string | null;
  query_mode?: AnalystSearchMode;
  search_fields?: AnalystSearchField[];
  proximity_slop?: number;
  entity_type?: string | null;
  entity_value?: string | null;
  document_type?: string | null;
  classification?: string | null;
  status?: string | null;
  allowed_document_ids?: string[];
  allowed_policy_hashes?: Record<string, string[]>;
  limit?: number;
}

export interface AnalystSearchResponse {
  status: "ready" | "unavailable";
  index_name: string;
  query_mode: AnalystSearchMode;
  total_hits: number;
  returned_hits: number;
  hits: EntitySearchHit[];
  generated_at: string;
  warnings: IngestionReportMessage[];
}

export interface EntityRelationshipRequest {
  entity_type?: string | null;
  entity_value?: string | null;
  document_type?: string | null;
  classification?: string | null;
  status?: string | null;
  allowed_document_ids?: string[];
  allowed_policy_hashes?: Record<string, string[]>;
  min_evidence_count?: number;
  limit?: number;
}

export interface EntityRelationshipEndpoint {
  entity_type: string;
  entity_value: string;
  label: string;
}

export interface EntityRelationshipEvidence {
  chunk_id: string;
  document_id: string;
  document_version_id: string;
  document_title: string;
  version_label: string | null;
  policy_binding_id?: string | null;
  policy_version?: string | null;
  policy_hash?: string | null;
  snippet: string;
  page_number: number | null;
  section_title: string | null;
  source_file_name: string | null;
}

export interface EntityRelationshipEdge {
  edge_id: string;
  relationship_type: "co_occurs";
  source: EntityRelationshipEndpoint;
  target: EntityRelationshipEndpoint;
  evidence_count: number;
  document_count: number;
  confidence: number;
  evidence: EntityRelationshipEvidence[];
}

export interface EntityRelationshipResponse {
  status: "ready" | "unavailable";
  index_name: string;
  total_edges: number;
  returned_edges: number;
  edges: EntityRelationshipEdge[];
  generated_at: string;
  warnings: IngestionReportMessage[];
}
