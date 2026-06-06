export type DocumentType =
  | "directive"
  | "regulation"
  | "methodology"
  | "policy"
  | "procedure"
  | "manual"
  | "knowledge_base_article"
  | "project_documentation"
  | "meeting_record"
  | "contract"
  | "attachment"
  | "other";

export type DocumentStatus =
  | "draft"
  | "review"
  | "approved"
  | "valid"
  | "superseded"
  | "archived"
  | "cancelled";

export type Classification = "public" | "internal" | "restricted" | "confidential";
export type DocumentAssignmentRole = "owner" | "gestor" | "reviewer" | "approver" | "auditor" | "steward";
export type AssignmentSubjectType = "user" | "group" | "unit" | "service";

export interface DocumentAssignment {
  assignment_id: string;
  document_id: string;
  role: DocumentAssignmentRole;
  subject_type: AssignmentSubjectType;
  subject_id: string;
  display_label: string | null;
  is_primary: boolean;
  active: boolean;
  sla_days: number | null;
  escalation_subject_type: AssignmentSubjectType | null;
  escalation_subject_id: string | null;
  escalation_label: string | null;
  assigned_by: string | null;
  assigned_at: string;
  last_audit_event_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DocumentAssignmentInput {
  role: DocumentAssignmentRole;
  subject_type?: AssignmentSubjectType;
  subject_id: string;
  display_label?: string | null;
  is_primary?: boolean;
  active?: boolean;
  sla_days?: number | null;
  escalation_subject_type?: AssignmentSubjectType | null;
  escalation_subject_id?: string | null;
  escalation_label?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ReplaceDocumentAssignmentsRequest {
  assignments: DocumentAssignmentInput[];
}

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
  assignments?: DocumentAssignment[];
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

export interface DocumentSourceOpenDecision {
  source_open_id: string;
  download_url: string | null;
  download_method: "GET";
  expires_at: string;
  source_file_uri: string;
  bucket: string;
  object_key: string;
  available: boolean;
  unavailable_reason: string | null;
  file: {
    filename: string;
    mime_type: string;
    size_bytes: number | null;
    sha256: string | null;
  };
  viewer_mode: string;
}

export interface CreateDocumentRequest {
  title: string;
  document_type: DocumentType;
  owner_id: string;
  gestor_unit: string;
  classification: Classification;
  tags: string[];
  metadata?: Record<string, unknown>;
  assignments?: DocumentAssignmentInput[];
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
  file_hash?: string | null;
  change_summary: string;
  file?: {
    filename?: string | null;
    mime_type?: string | null;
    size_bytes?: number | null;
    sha256?: string | null;
    uploaded_by?: string | null;
  } | null;
}

export interface AuthorizationHint {
  can_read: boolean;
  can_update: boolean;
  can_ingest: boolean;
  can_publish: boolean;
  can_read_audit: boolean;
  can_manage_admin: boolean;
}
