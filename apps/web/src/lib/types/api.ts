import type { AuditEvent, CreateAuditEventRequest } from "./audit";
import type {
  AuthorizationHint,
  CreateDocumentRequest,
  CreateVersionRequest,
  Document,
  DocumentVersion
} from "./documents";
import type { CreateIngestionJobRequest, IngestionJob, IngestionReport } from "./ingestion";
import type { RagAnswer, RagQueryRequest } from "./rag";

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
  getAuthorizationHints(context: ApiRequestContext): Promise<AuthorizationHint>;
  listAuditEvents(context: ApiRequestContext): Promise<AuditEvent[]>;
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
}

export interface ApiClients {
  registry: RegistryApiClient;
  ingestion: IngestionApiClient;
  rag: RagApiClient;
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
