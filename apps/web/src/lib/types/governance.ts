import type { Classification, DocumentStatus, DocumentType } from "./documents";
import type { RagConfidence, RagQueryFilters } from "./rag";

export type GovernanceDocumentStatus = Exclude<DocumentStatus, "approved">;
export type GovernanceChangeType = "added" | "removed" | "modified" | "unchanged";
export type GovernanceChangeImpact = "none" | "minor" | "material" | "critical";
export type GovernanceFindingSeverity = "info" | "warning" | "error" | "critical";
export type GovernanceComplianceStatus = "compliant" | "non_compliant" | "needs_review" | "insufficient_source";
export type GovernanceRuleStatus = "passed" | "warning" | "failed" | "manual_review";
export type GovernanceConflictType =
  | "approval_owner_mismatch"
  | "deadline_mismatch"
  | "normative_polarity"
  | "potential_overlap";

export type GovernanceActionKind = "compare_versions" | "check_compliance" | "detect_conflicts";

export interface GovernanceCitation {
  document_id: string;
  document_version_id: string;
  document_title: string;
  version_label: string;
  section_path: string[];
  page_number: number | null;
  chunk_id: string;
  source_excerpt?: string | null;
}

export interface GovernanceSourceReference {
  source_id: string;
  source_type: "input_document" | "document_version" | "retrieved_chunk" | "registry_metadata";
  document_id: string | null;
  document_version_id: string | null;
  title: string;
  uri: string | null;
  citation: GovernanceCitation | null;
}

export interface GovernanceVersionContent {
  document_id: string;
  document_version_id: string;
  document_title: string;
  version_label: string;
  status: GovernanceDocumentStatus;
  classification: Classification;
  valid_from: string | null;
  valid_to: string | null;
  source_uri: string | null;
  content: string;
  citations: GovernanceCitation[];
}

export interface GovernanceDraftDocumentInput {
  title: string;
  document_type: DocumentType;
  classification: Classification;
  content: string;
  document_id: string | null;
  document_version_id: string | null;
  owner_id: string | null;
  gestor_unit: string | null;
  valid_from: string | null;
  valid_to: string | null;
  tags: string[];
  citations: GovernanceCitation[];
}

export interface GovernanceSourceDocument {
  document_id: string;
  document_version_id: string;
  document_title: string;
  version_label: string;
  status: GovernanceDocumentStatus;
  classification: Classification;
  content: string;
  source_uri: string | null;
  citations: GovernanceCitation[];
}

export interface CompareVersionsRequest {
  subject_id: string;
  left_version: GovernanceVersionContent;
  right_version: GovernanceVersionContent;
  include_unchanged?: boolean;
}

export interface GovernanceChangeItem {
  change_id: string;
  change_type: GovernanceChangeType;
  impact: GovernanceChangeImpact;
  before_text: string | null;
  after_text: string | null;
  before_citation?: GovernanceCitation | null;
  after_citation?: GovernanceCitation | null;
  citations: GovernanceCitation[];
  confidence: RagConfidence;
  rationale: string;
}

export interface CompareVersionsResponse {
  result_id: string;
  document_id: string;
  left_version_id: string;
  right_version_id: string;
  summary: string;
  change_counts: Record<string, number>;
  materiality_score: number;
  changes: GovernanceChangeItem[];
  citations: GovernanceCitation[];
  sources: GovernanceSourceReference[];
  confidence: RagConfidence;
  warnings: string[];
  missing_information: string | null;
}

export interface ComplianceCheckRequest {
  subject_id: string;
  draft: GovernanceDraftDocumentInput;
  control_query?: string;
  filters?: RagQueryFilters;
  control_sources?: unknown[];
  max_control_chunks?: number;
}

export interface GovernanceComplianceFinding {
  finding_id: string;
  rule_id: string;
  rule_name: string;
  status: GovernanceRuleStatus;
  severity: GovernanceFindingSeverity;
  message: string;
  recommendation: string;
  evidence_citations: GovernanceCitation[];
  sources: GovernanceSourceReference[];
  confidence: RagConfidence;
}

export interface ComplianceCheckResponse {
  result_id: string;
  status: GovernanceComplianceStatus;
  summary: string;
  findings: GovernanceComplianceFinding[];
  citations: GovernanceCitation[];
  sources: GovernanceSourceReference[];
  confidence: RagConfidence;
  warnings: string[];
  missing_information: string | null;
}

export interface ConflictDetectionRequest {
  subject_id: string;
  documents: GovernanceSourceDocument[];
  topic?: string | null;
}

export interface GovernanceConflictClaim {
  statement: string;
  citation: GovernanceCitation;
  source: GovernanceSourceReference;
}

export interface GovernanceConflictFinding {
  conflict_id: string;
  conflict_type: GovernanceConflictType;
  severity: GovernanceFindingSeverity;
  summary: string;
  claims: GovernanceConflictClaim[];
  recommendation: string;
  confidence: RagConfidence;
}

export interface ConflictDetectionResponse {
  result_id: string;
  summary: string;
  conflicts: GovernanceConflictFinding[];
  citations: GovernanceCitation[];
  sources: GovernanceSourceReference[];
  confidence: RagConfidence;
  warnings: string[];
  missing_information: string | null;
}

export type GovernanceServiceResponse =
  | CompareVersionsResponse
  | ComplianceCheckResponse
  | ConflictDetectionResponse;

export interface DocumentGovernanceRunResponse {
  action: GovernanceActionKind;
  result: GovernanceServiceResponse;
  source_limitations: string[];
  generated_at: string;
}
