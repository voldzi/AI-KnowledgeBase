import type { AuditEvent, AuditEventListOptions, CreateAuditEventRequest } from "./audit";
import type {
  AuthorizationHint,
  CreateDocumentRequest,
  CreateVersionRequest,
  Document,
  DocumentListOptions,
  DocumentAssignment,
  DocumentMetadataSummary,
  DocumentMetadataSummaryOptions,
  DocumentReadinessReport,
  DocumentReadinessReportOptions,
  DocumentVersion,
  ReplaceDocumentAssignmentsRequest
} from "./documents";
import type {
  AnalystSearchRequest,
  AnalystSearchResponse,
  CreateIngestionJobRequest,
  EntityFacetReport,
  EntityRelationshipRequest,
  EntityRelationshipResponse,
  EntitySearchRequest,
  EntitySearchResponse,
  IngestionJob,
  IngestionReport
} from "./ingestion";
import type {
  AnalystCase,
  CreateAnalystCaseRequest,
  CreateAnalystEvidenceRequest,
  CreateAnalystSavedQueryRequest,
  UpdateAnalystCaseRequest
} from "./intelligence";
import type {
  CompareVersionsRequest,
  CompareVersionsResponse,
  ComplianceCheckRequest,
  ComplianceCheckResponse,
  ConflictDetectionRequest,
  ConflictDetectionResponse
} from "./governance";
import type {
  EvaluationDataset,
  EvaluationDatasetCreate,
  EvaluationQualityOverview,
  EvaluationRun,
  EvaluationRunRequest
} from "./evaluation";
import type { ApplyWorkflowTaskActionRequest, RegistryWorkflowTask, WorkflowTaskListOptions } from "./workflow";
import type {
  AssistantChatRequest,
  AssistantChatResponse,
  AssistantConversationDetail,
  AssistantConversationListResponse,
  AssistantConversationMessageAppendRequest,
  AssistantConversationPatchRequest,
  AssistantConversationResponse,
  AssistantConversationShareReplaceRequest,
  AssistantSuggestionsResponse,
  RagAnswer,
  RagQueryRequest,
  SourceContext
} from "./rag";
import type { AklLanguage } from "../language";

export interface DirectoryUser {
  subject_id: string;
  display_name: string | null;
  email: string | null;
  username?: string | null;
  enabled?: boolean;
  groups: string[];
}

export interface RoleMapping {
  role_mapping_id: string;
  subject_type: string;
  subject_id: string;
  role: string;
  status: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertRoleMappingRequest {
  subject_type: string;
  subject_id: string;
  role: string;
  status: string;
}

export interface ProfileSettingsBundle {
  core: Record<string, unknown>;
  apps: Record<string, Record<string, unknown>>;
}

export interface ProfileSettingsResponse {
  subject_id: string;
  settings: ProfileSettingsBundle;
  roles: string[];
  groups: string[];
}

export interface ProfileSettingsPutRequest {
  settings: ProfileSettingsBundle;
}

export interface ApiRequestContext {
  subjectId: string;
  roles?: string[];
  groups?: string[];
  capabilities?: string[];
  scopes?: string[];
  organizationId?: string;
  identityActive?: boolean;
  membershipActive?: boolean;
  applicationAccessActive?: boolean;
  authorizationSource?: "mock" | "stratos_projection";
  accessToken?: string;
  requestId?: string;
  correlationId?: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
    trace_id: string;
  };
}

export interface RegistryApiClient {
  listDocuments(context: ApiRequestContext, options?: DocumentListOptions): Promise<Document[]>;
  getDocumentMetadataSummary(
    context: ApiRequestContext,
    options?: DocumentMetadataSummaryOptions
  ): Promise<DocumentMetadataSummary>;
  getDocumentReadinessReport(
    context: ApiRequestContext,
    options?: DocumentReadinessReportOptions
  ): Promise<DocumentReadinessReport>;
  getDocument(documentId: string, context: ApiRequestContext): Promise<Document>;
  createDocument(request: CreateDocumentRequest, context: ApiRequestContext): Promise<Document>;
  listDocumentAssignments(documentId: string, context: ApiRequestContext): Promise<DocumentAssignment[]>;
  replaceDocumentAssignments(
    documentId: string,
    request: ReplaceDocumentAssignmentsRequest,
    context: ApiRequestContext
  ): Promise<DocumentAssignment[]>;
  listDocumentVersions(documentId: string, context: ApiRequestContext): Promise<DocumentVersion[]>;
  createDocumentVersion(
    documentId: string,
    request: CreateVersionRequest,
    context: ApiRequestContext
  ): Promise<DocumentVersion>;
  publishDocumentVersion(
    documentId: string,
    versionId: string,
    context: ApiRequestContext
  ): Promise<DocumentVersion>;
  archiveDocumentVersion(
    documentId: string,
    versionId: string,
    context: ApiRequestContext
  ): Promise<DocumentVersion>;
  getAuthorizationHints(context: ApiRequestContext): Promise<AuthorizationHint>;
  listWorkflowTasks(context: ApiRequestContext, options?: WorkflowTaskListOptions): Promise<RegistryWorkflowTask[]>;
  applyWorkflowTaskAction(
    taskId: string,
    request: ApplyWorkflowTaskActionRequest,
    context: ApiRequestContext
  ): Promise<RegistryWorkflowTask>;
  listAnalystCases(context: ApiRequestContext, includeArchived?: boolean): Promise<AnalystCase[]>;
  createAnalystCase(request: CreateAnalystCaseRequest, context: ApiRequestContext): Promise<AnalystCase>;
  getAnalystCase(caseId: string, context: ApiRequestContext): Promise<AnalystCase>;
  updateAnalystCase(
    caseId: string,
    request: UpdateAnalystCaseRequest,
    context: ApiRequestContext
  ): Promise<AnalystCase>;
  createAnalystSavedQuery(
    caseId: string,
    request: CreateAnalystSavedQueryRequest,
    context: ApiRequestContext
  ): Promise<AnalystCase["saved_queries"][number]>;
  createAnalystEvidence(
    caseId: string,
    request: CreateAnalystEvidenceRequest,
    context: ApiRequestContext
  ): Promise<AnalystCase["evidence_items"][number]>;
  listAuditEvents(context: ApiRequestContext, options?: AuditEventListOptions): Promise<AuditEvent[]>;
  createAuditEvent(request: CreateAuditEventRequest, context: ApiRequestContext): Promise<AuditEvent>;
  searchDirectoryUsers(query: string, context: ApiRequestContext, limit?: number): Promise<DirectoryUser[]>;
  listRoleMappings(context: ApiRequestContext, includeRemoved?: boolean): Promise<RoleMapping[]>;
  importDirectoryUser(subjectId: string, context: ApiRequestContext): Promise<DirectoryUser>;
  upsertRoleMapping(request: UpsertRoleMappingRequest, context: ApiRequestContext): Promise<RoleMapping>;
  updateRoleMappingStatus(roleMappingId: string, status: string, context: ApiRequestContext): Promise<RoleMapping>;
  getProfileSettings(context: ApiRequestContext): Promise<ProfileSettingsResponse>;
  putProfileSettings(request: ProfileSettingsPutRequest, context: ApiRequestContext): Promise<ProfileSettingsResponse>;
  listAssistantConversations(context: ApiRequestContext, includeArchived?: boolean): Promise<AssistantConversationListResponse>;
  getAssistantConversation(conversationId: string, context: ApiRequestContext): Promise<AssistantConversationDetail>;
  appendAssistantConversationMessages(
    conversationId: string,
    request: AssistantConversationMessageAppendRequest,
    context: ApiRequestContext
  ): Promise<AssistantConversationDetail>;
  updateAssistantConversation(
    conversationId: string,
    request: AssistantConversationPatchRequest,
    context: ApiRequestContext
  ): Promise<AssistantConversationDetail>;
  replaceAssistantConversationShares(
    conversationId: string,
    request: AssistantConversationShareReplaceRequest,
    context: ApiRequestContext
  ): Promise<AssistantConversationDetail>;
}

export interface IngestionApiClient {
  listJobs(context: ApiRequestContext): Promise<IngestionJob[]>;
  getJob(jobId: string, context: ApiRequestContext): Promise<IngestionJob>;
  createJob(request: CreateIngestionJobRequest, context: ApiRequestContext): Promise<IngestionJob>;
  getReport(jobId: string, context: ApiRequestContext): Promise<IngestionReport>;
  cancelJob(jobId: string, context: ApiRequestContext): Promise<IngestionJob>;
  getEntityFacets(context: ApiRequestContext, options?: { limit?: number; valueLimit?: number }): Promise<EntityFacetReport>;
  searchEntities(request: EntitySearchRequest, context: ApiRequestContext): Promise<EntitySearchResponse>;
  analystSearch(request: AnalystSearchRequest, context: ApiRequestContext): Promise<AnalystSearchResponse>;
  getEntityRelationships(
    request: EntityRelationshipRequest,
    context: ApiRequestContext
  ): Promise<EntityRelationshipResponse>;
}

export interface RagApiClient {
  query(request: RagQueryRequest, context: ApiRequestContext): Promise<RagAnswer>;
  openCitation(chunkId: string, context: ApiRequestContext): Promise<SourceContext>;
  openAssistantCitation(chunkId: string, context: ApiRequestContext): Promise<SourceContext>;
  assistantChat(request: AssistantChatRequest, context: ApiRequestContext): Promise<AssistantChatResponse>;
  assistantClarify(request: AssistantChatRequest, context: ApiRequestContext): Promise<AssistantChatResponse>;
  assistantSuggestions(context: ApiRequestContext, language?: AklLanguage): Promise<AssistantSuggestionsResponse>;
  assistantConversation(conversationId: string, context: ApiRequestContext): Promise<AssistantConversationResponse>;
}

export interface GovernanceApiClient {
  compareVersions(request: CompareVersionsRequest, context: ApiRequestContext): Promise<CompareVersionsResponse>;
  checkCompliance(request: ComplianceCheckRequest, context: ApiRequestContext): Promise<ComplianceCheckResponse>;
  detectConflicts(request: ConflictDetectionRequest, context: ApiRequestContext): Promise<ConflictDetectionResponse>;
}

export interface EvaluationApiClient {
  getQualityOverview(
    context: ApiRequestContext,
    options?: { datasetId?: string; limit?: number }
  ): Promise<EvaluationQualityOverview>;
  createDataset(
    request: EvaluationDatasetCreate,
    context: ApiRequestContext
  ): Promise<EvaluationDataset>;
  runEvaluation(
    request: EvaluationRunRequest,
    context: ApiRequestContext
  ): Promise<EvaluationRun>;
}

export interface ApiClients {
  registry: RegistryApiClient;
  ingestion: IngestionApiClient;
  rag: RagApiClient;
  governance: GovernanceApiClient;
  evaluation: EvaluationApiClient;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly traceId: string;

  constructor(message: string, status: number, code: string, traceId: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.traceId = traceId;
  }
}
