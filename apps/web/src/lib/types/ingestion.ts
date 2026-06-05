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
