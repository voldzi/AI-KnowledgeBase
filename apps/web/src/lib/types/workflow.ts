import type { DocumentAssignmentRole, DocumentStatus, DocumentType } from "./documents";

export type RegistryWorkflowTaskKind = "review" | "draft" | "ingestion" | "governance" | "audit";
export type RegistryWorkflowTaskPriority = "critical" | "high" | "medium" | "low";
export type RegistryWorkflowTaskStatus = "open" | "waiting" | "blocked" | "resolved" | "cancelled";
export type RegistryWorkflowTaskAction = "assign" | "request_changes" | "approve" | "publish" | "archive" | "resolve";

export interface WorkflowTaskListOptions {
  status?: RegistryWorkflowTaskStatus;
  kind?: RegistryWorkflowTaskKind;
  priority?: RegistryWorkflowTaskPriority;
  documentId?: string;
  ownerId?: string;
  assignedToMe?: boolean;
  includeResolved?: boolean;
  limit?: number;
  offset?: number;
}

export interface ApplyWorkflowTaskActionRequest {
  action: RegistryWorkflowTaskAction;
  comment?: string | null;
  assignee_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RegistryWorkflowTask {
  task_id: string;
  source_key: string | null;
  kind: RegistryWorkflowTaskKind;
  priority: RegistryWorkflowTaskPriority;
  status: RegistryWorkflowTaskStatus;
  title: string;
  description: string;
  source: string;
  owner_id: string | null;
  owner_label: string;
  role: string;
  document_id: string | null;
  document_title: string | null;
  document_version_id: string | null;
  audit_event_id: string | null;
  job_id: string | null;
  due_at: string;
  resolved_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  allowed_actions?: RegistryWorkflowTaskAction[];
  assigned_to_me?: boolean;
}

export interface DocumentReviewRequest {
  comment?: string | null;
}

export interface WorkflowDocument {
  document_id: string;
  title: string;
  document_type: DocumentType;
  status: DocumentStatus;
  assignment_roles: DocumentAssignmentRole[];
  document_version_id: string | null;
  version_label: string | null;
  version_status: DocumentStatus | null;
  valid_from: string | null;
  valid_to: string | null;
  published_version_label: string | null;
  published_valid_to: string | null;
  review_due_on: string | null;
  review_date_invalid: boolean;
  updated_at: string;
}
