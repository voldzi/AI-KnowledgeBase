export type DocumentType =
  | "directive"
  | "regulation"
  | "methodology"
  | "policy"
  | "procedure"
  | "manual"
  | "knowledge_base_article"
  | "meeting_record"
  | "contract"
  | "attachment"
  | "other";

export type DocumentStatus =
  | "draft"
  | "review"
  | "valid"
  | "superseded"
  | "archived"
  | "cancelled";

export type Classification = "public" | "internal" | "restricted" | "confidential";

export interface Document {
  document_id: string;
  title: string;
  document_type: DocumentType;
  status: DocumentStatus;
  classification: Classification;
  owner_id: string;
  owner: string;
  gestor_unit: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface DocumentVersion {
  document_version_id: string;
  document_id: string;
  version_label: string;
  status: DocumentStatus;
  valid_from: string | null;
  valid_to: string | null;
  source_file_uri: string;
  file_hash: string | null;
  change_summary: string | null;
  created_at: string;
  published_at: string | null;
}

export interface DocumentFile {
  file_id: string;
  document_id: string;
  document_version_id: string;
  uri: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  uploaded_by: string;
  uploaded_at: string;
}

export interface CreateDocumentRequest {
  title: string;
  document_type: DocumentType;
  owner_id: string;
  gestor_unit: string;
  classification: Classification;
  tags: string[];
  metadata?: Record<string, unknown>;
  access_policies?: Array<{
    subjects: string[];
    actions: string[];
    constraints?: Record<string, unknown>;
  }>;
}

export interface CreateVersionRequest {
  version_label: string;
  valid_from: string;
  valid_to: string | null;
  source_file_uri: string;
  change_summary: string;
}

export interface AuthorizationHint {
  can_read: boolean;
  can_update: boolean;
  can_ingest: boolean;
  can_publish: boolean;
  can_read_audit: boolean;
  can_manage_admin: boolean;
}
