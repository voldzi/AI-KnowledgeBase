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
  | "ai_intake"
  | "ai_requirement_card"
  | "ai_security_appendix"
  | "ai_governance_evidence"
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
export interface InformationPolicyBindingSummary {
  schemaVersion: "stratos-information-policy-2";
  policyBindingId: string;
  policyVersion: "information-policy-2.0.0";
  handlingClass: "PUBLIC" | "INTERNAL" | "RESTRICTED";
  legalClassification: "NONE";
  tlp?: "TLP:RED" | "TLP:AMBER+STRICT" | "TLP:AMBER" | "TLP:GREEN" | "TLP:CLEAR" | null;
  pap?: "PAP:RED" | "PAP:AMBER" | "PAP:GREEN" | "PAP:CLEAR" | null;
  contentCategories: string[];
  audience: {
    organizationId: "org_stratos";
    scopeType: "organization" | "organization_unit" | "project" | "document" | "recipient_set" | "public";
    scopeIds?: string[];
    recipientSubjectIds?: string[];
  };
  obligations: string[];
  originatorId?: string | null;
  issuedAt?: string | null;
  reviewAt?: string | null;
}
export type ExternalSourceSystem =
  | "STRATOS_BUDGET"
  | "STRATOS_PROJECTFLOW"
  | "STRATOS_ARCHFLOW"
  | "STRATOS_AIIP"
  | "STRATOS_PROCESSFORGE"
  | "STRATOS_EXECUTIVE"
  | "STRATOS_PLATFORM";
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
  organization_id?: string;
  policy_binding_id?: string | null;
  policy_version?: string | null;
  policy_hash?: string | null;
  policy_summary?: InformationPolicyBindingSummary | Record<string, never>;
  owner_id: string;
  owner: string;
  gestor_unit: string | null;
  tags: string[];
  metadata?: Record<string, unknown>;
  assignments?: DocumentAssignment[];
  created_at: string;
  updated_at: string;
}

export interface DocumentMetadataSummaryBucket {
  key: string;
  label: string;
  count: number;
}

export interface DocumentMetadataSummaryTopic {
  topic: string;
  document_count: number;
  valid_or_approved_count: number;
  document_types: DocumentMetadataSummaryBucket[];
  classifications: DocumentMetadataSummaryBucket[];
  statuses: DocumentMetadataSummaryBucket[];
  owners: DocumentMetadataSummaryBucket[];
  example_documents: string[];
}

export interface DocumentMetadataSummary {
  total_visible_documents: number;
  total_matched_documents: number;
  topics: DocumentMetadataSummaryTopic[];
  by_document_type: DocumentMetadataSummaryBucket[];
  by_classification: DocumentMetadataSummaryBucket[];
  by_status: DocumentMetadataSummaryBucket[];
  by_owner: DocumentMetadataSummaryBucket[];
  warnings: string[];
}

export interface DocumentMetadataSummaryOptions {
  topics?: string[];
  status?: DocumentStatus;
  classification?: Classification;
  documentType?: DocumentType;
  ownerId?: string;
  tag?: string;
  tenantId?: string;
  externalSystem?: ExternalSourceSystem | string;
  entityType?: string;
  entityId?: string;
  externalRef?: string;
  contextTags?: string[];
}

export interface DocumentListOptions extends DocumentMetadataSummaryOptions {}

export type DocumentReadinessSeverity = "critical" | "warning" | "info";

export interface DocumentReadinessIssue {
  code: string;
  severity: DocumentReadinessSeverity;
  document_id: string;
  title: string;
  recommendation: string;
  details: Record<string, unknown>;
}

export interface DocumentReadinessReport {
  generated_at: string;
  total_visible_documents: number;
  ready_documents: number;
  review_documents: number;
  blocked_documents: number;
  readiness_score: number;
  issue_counts: DocumentMetadataSummaryBucket[];
  by_severity: DocumentMetadataSummaryBucket[];
  by_document_type: DocumentMetadataSummaryBucket[];
  by_classification: DocumentMetadataSummaryBucket[];
  by_status: DocumentMetadataSummaryBucket[];
  issues: DocumentReadinessIssue[];
  warnings: string[];
}

export interface DocumentReadinessReportOptions extends DocumentMetadataSummaryOptions {
  maxIssues?: number;
}

export interface DocumentVersion {
  document_version_id: string;
  document_id: string;
  file_id?: string | null;
  version_label: string;
  status: DocumentStatus;
  organization_id?: string;
  policy_binding_id?: string | null;
  policy_version?: string | null;
  policy_hash?: string | null;
  policy_summary?: InformationPolicyBindingSummary | Record<string, never>;
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
  information_policy?: InformationPolicyBindingSummary;
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
  information_policy?: InformationPolicyBindingSummary;
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
