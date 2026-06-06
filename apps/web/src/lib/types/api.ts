import type { AuditEvent, AuditEventListOptions, CreateAuditEventRequest } from "./audit";
import type {
  AuthorizationHint,
  CreateDocumentRequest,
  CreateVersionRequest,
  Document,
  DocumentAssignment,
  DocumentVersion,
  ReplaceDocumentAssignmentsRequest
} from "./documents";
import type { CreateIngestionJobRequest, IngestionJob, IngestionReport } from "./ingestion";
import type {
  CompareVersionsRequest,
  CompareVersionsResponse,
  ComplianceCheckRequest,
  ComplianceCheckResponse,
  ConflictDetectionRequest,
  ConflictDetectionResponse
} from "./governance";
import type { ApplyWorkflowTaskActionRequest, RegistryWorkflowTask, WorkflowTaskListOptions } from "./workflow";
import type {
  AssistantChatRequest,
  AssistantChatResponse,
  AssistantConversationResponse,
  AssistantSuggestionsResponse,
  RagAnswer,
  RagQueryRequest,
  SourceContext
} from "./rag";
import type { AklLanguage } from "../language";

export interface ApiRequestContext {
  subjectId: string;
  roles?: string[];
  groups?: string[];
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
  listDocuments(context: ApiRequestContext): Promise<Document[]>;
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
  listAuditEvents(context: ApiRequestContext, options?: AuditEventListOptions): Promise<AuditEvent[]>;
  createAuditEvent(request: CreateAuditEventRequest, context: ApiRequestContext): Promise<AuditEvent>;
}

export interface IngestionApiClient {
  listJobs(context: ApiRequestContext): Promise<IngestionJob[]>;
  getJob(jobId: string, context: ApiRequestContext): Promise<IngestionJob>;
  createJob(request: CreateIngestionJobRequest, context: ApiRequestContext): Promise<IngestionJob>;
  getReport(jobId: string, context: ApiRequestContext): Promise<IngestionReport>;
  cancelJob(jobId: string, context: ApiRequestContext): Promise<IngestionJob>;
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

export interface ApiClients {
  registry: RegistryApiClient;
  ingestion: IngestionApiClient;
  rag: RagApiClient;
  governance: GovernanceApiClient;
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
