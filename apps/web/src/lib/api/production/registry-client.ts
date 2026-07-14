import type {
  ApiRequestContext,
  ApplyWorkflowTaskActionRequest,
  AuditEvent,
  AuditEventListOptions,
  AnalystCase,
  AuthorizationHint,
  AssistantConversationDetail,
  AssistantConversationListResponse,
  AssistantConversationMessageAppendRequest,
  AssistantConversationPatchRequest,
  AssistantConversationShareReplaceRequest,
  CreateAnalystCaseRequest,
  CreateAnalystEvidenceRequest,
  CreateAnalystSavedQueryRequest,
  CreateAuditEventRequest,
  CreateDocumentRequest,
  CreateVersionRequest,
  DirectoryUser,
  Document,
  DocumentAuthorizationDecision,
  DocumentListOptions,
  DocumentAssignment,
  DocumentMetadataSummary,
  DocumentMetadataSummaryOptions,
  DocumentPublication,
  DocumentReadinessReport,
  DocumentReadinessReportOptions,
  DocumentVersion,
  IngestionAuthorizationRequest,
  IngestionAuthorizationResponse,
  RegistryIngestionAttempt,
  IntelligenceScopeAuthorizationRequest,
  IntelligenceScopeAuthorizationResponse,
  ProfileSettingsPutRequest,
  ProfileSettingsResponse,
  RegistryApiClient,
  ReplaceDocumentAssignmentsRequest,
  RegistryWorkflowTask,
  RoleMapping,
  UpdateAnalystCaseRequest,
  UpsertRoleMappingRequest,
  WorkflowTaskListOptions
} from "@/lib/types";
import { ApiClientError } from "@/lib/types";

import type { AklFetch } from "../http-client";
import { requestJson } from "../http-client";

interface AuthzCheckResponse {
  allowed: boolean;
}

interface ListEnvelope<T> {
  items: T[];
}

const DOCUMENT_PAGE_SIZE = 200;
const DOCUMENT_PAGE_LIMIT = 100;

export class ProductionRegistryClient implements RegistryApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher?: AklFetch
  ) {}

  async listDocuments(context: ApiRequestContext, options: DocumentListOptions = {}): Promise<Document[]> {
    const documents: Document[] = [];
    for (let page = 0; page < DOCUMENT_PAGE_LIMIT; page += 1) {
      const offset = page * DOCUMENT_PAGE_SIZE;
      const params = registryDocumentParams(options);
      params.set("limit", String(DOCUMENT_PAGE_SIZE));
      params.set("offset", String(offset));
      const response = await this.get<ListEnvelope<Document>>(
        `/documents?${params.toString()}`,
        "listDocuments",
        context
      );
      documents.push(...response.items);
      if (response.items.length < DOCUMENT_PAGE_SIZE) {
        break;
      }
    }
    return documents;
  }

  getDocumentMetadataSummary(
    context: ApiRequestContext,
    options: DocumentMetadataSummaryOptions = {}
  ): Promise<DocumentMetadataSummary> {
    const params = registryDocumentParams(options);
    const query = params.toString();
    return this.get<DocumentMetadataSummary>(
      `/documents/metadata-summary${query ? `?${query}` : ""}`,
      "getDocumentMetadataSummary",
      context
    );
  }

  getDocumentReadinessReport(
    context: ApiRequestContext,
    options: DocumentReadinessReportOptions = {}
  ): Promise<DocumentReadinessReport> {
    const params = registryDocumentParams(options);
    if (options.maxIssues !== undefined) {
      params.set("max_issues", String(options.maxIssues));
    }
    const query = params.toString();
    return this.get<DocumentReadinessReport>(
      `/documents/readiness-report${query ? `?${query}` : ""}`,
      "getDocumentReadinessReport",
      context
    );
  }

  getDocument(documentId: string, context: ApiRequestContext): Promise<Document> {
    return this.get<Document>(`/documents/${documentId}`, "getDocument", context);
  }

  createDocument(request: CreateDocumentRequest, context: ApiRequestContext): Promise<Document> {
    return this.post<Document>("/documents", request, "createDocument", context);
  }

  async listDocumentAssignments(documentId: string, context: ApiRequestContext): Promise<DocumentAssignment[]> {
    const response = await this.get<ListEnvelope<DocumentAssignment>>(
      `/documents/${documentId}/assignments`,
      "listDocumentAssignments",
      context
    );
    return response.items;
  }

  async replaceDocumentAssignments(
    documentId: string,
    request: ReplaceDocumentAssignmentsRequest,
    context: ApiRequestContext
  ): Promise<DocumentAssignment[]> {
    const response = await this.put<ListEnvelope<DocumentAssignment>>(
      `/documents/${documentId}/assignments`,
      request,
      "replaceDocumentAssignments",
      context
    );
    return response.items;
  }

  async listDocumentVersions(documentId: string, context: ApiRequestContext): Promise<DocumentVersion[]> {
    const response = await this.get<ListEnvelope<DocumentVersion>>(
      `/documents/${documentId}/versions`,
      "listDocumentVersions",
      context
    );
    return response.items;
  }

  getDocumentPublication(
    documentId: string,
    versionId: string,
    context: ApiRequestContext
  ): Promise<DocumentPublication> {
    return this.get<DocumentPublication>(
      `/documents/${documentId}/versions/${versionId}/publication`,
      "getDocumentPublication",
      context
    );
  }

  createDocumentVersion(
    documentId: string,
    request: CreateVersionRequest,
    context: ApiRequestContext
  ): Promise<DocumentVersion> {
    return this.post<DocumentVersion>(
      `/documents/${documentId}/versions`,
      request,
      "createDocumentVersion",
      context
    );
  }

  publishDocumentVersion(
    documentId: string,
    versionId: string,
    context: ApiRequestContext
  ): Promise<DocumentVersion> {
    return this.post<DocumentVersion>(
      `/documents/${documentId}/versions/${versionId}/publish`,
      undefined,
      "publishDocumentVersion",
      context
    );
  }

  archiveDocumentVersion(
    documentId: string,
    versionId: string,
    context: ApiRequestContext
  ): Promise<DocumentVersion> {
    return this.post<DocumentVersion>(
      `/documents/${documentId}/versions/${versionId}/archive`,
      undefined,
      "archiveDocumentVersion",
      context
    );
  }

  async getAuthorizationHints(context: ApiRequestContext): Promise<AuthorizationHint> {
    const check = (action: string) =>
      this.post<AuthzCheckResponse>(
        "/authz/check",
        {
          subject_id: context.subjectId,
          action,
          resource: {
            classification: "internal"
          },
          roles: context.roles ?? [],
          groups: context.groups ?? []
        },
        `authz:${action}`,
        context
      ).then((response) => response.allowed);

    const [canRead, canUpdate, canIngest, canPublish, canReadAudit, canManageAdmin] = await Promise.all([
      check("document.read"),
      check("document.update"),
      check("document.ingest"),
      check("document.version.publish"),
      check("audit.read"),
      check("admin.manage")
    ]);

    return {
      can_read: canRead,
      can_update: canUpdate,
      can_ingest: canIngest,
      can_publish: canPublish,
      can_read_audit: canReadAudit,
      can_manage_admin: canManageAdmin
    };
  }

  authorizeDocument(
    documentId: string,
    action: string,
    context: ApiRequestContext
  ): Promise<DocumentAuthorizationDecision> {
    return this.post<DocumentAuthorizationDecision>(
      "/authz/check",
      {
        subject_id: context.subjectId,
        action,
        resource: { document_id: documentId }
      },
      `authz:${action}:${documentId}`,
      context
    );
  }

  createIngestionAuthorization(
    documentId: string,
    versionId: string,
    request: IngestionAuthorizationRequest,
    context: ApiRequestContext,
  ): Promise<IngestionAuthorizationResponse> {
    return this.post<IngestionAuthorizationResponse>(
      `/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/ingestion-authorization`,
      request,
      `createIngestionAuthorization:${documentId}:${versionId}`,
      context,
    );
  }

  async getDocumentIngestionAttempt(
    documentId: string,
    context: ApiRequestContext,
  ): Promise<RegistryIngestionAttempt | null> {
    const response = await this.get<{
      document_id: string;
      ingestion_attempt: RegistryIngestionAttempt | null;
    }>(
      `/documents/${encodeURIComponent(documentId)}/external-references/current`,
      `getDocumentIngestionAttempt:${documentId}`,
      context,
    );
    if (response.document_id !== documentId) {
      throw new ApiClientError(
        "Registry returned an ingestion attempt for another document.",
        502,
        "INGESTION_ATTEMPT_CONFLICT",
        context.correlationId ?? context.requestId ?? "registry-ingestion-projection",
      );
    }
    if (
      response.ingestion_attempt !== null
      && (
        !isRegistryIngestionAttempt(response.ingestion_attempt)
        || response.ingestion_attempt.document_id !== documentId
      )
    ) {
      throw new ApiClientError(
        "Registry returned a mismatched ingestion attempt projection.",
        502,
        "INGESTION_ATTEMPT_CONFLICT",
        context.correlationId ?? context.requestId ?? "registry-ingestion-projection",
      );
    }
    return response.ingestion_attempt;
  }

  createIntelligenceScopeAuthorization(
    request: IntelligenceScopeAuthorizationRequest,
    context: ApiRequestContext,
  ): Promise<IntelligenceScopeAuthorizationResponse> {
    return this.post<IntelligenceScopeAuthorizationResponse>(
      "/intelligence/authorization",
      request,
      "createIntelligenceScopeAuthorization",
      context,
    );
  }

  async listWorkflowTasks(
    context: ApiRequestContext,
    options: WorkflowTaskListOptions = {}
  ): Promise<RegistryWorkflowTask[]> {
    const params = new URLSearchParams();
    if (options.status) {
      params.set("status", options.status);
    }
    if (options.kind) {
      params.set("kind", options.kind);
    }
    if (options.priority) {
      params.set("priority", options.priority);
    }
    if (options.documentId) {
      params.set("document_id", options.documentId);
    }
    if (options.ownerId) {
      params.set("owner_id", options.ownerId);
    }
    if (options.includeResolved !== undefined) {
      params.set("include_resolved", String(options.includeResolved));
    }
    if (options.limit !== undefined) {
      params.set("limit", String(options.limit));
    }
    if (options.offset !== undefined) {
      params.set("offset", String(options.offset));
    }
    const query = params.toString();
    const response = await this.get<ListEnvelope<RegistryWorkflowTask>>(
      `/workflow/tasks${query ? `?${query}` : ""}`,
      "listWorkflowTasks",
      context
    );
    return response.items;
  }

  applyWorkflowTaskAction(
    taskId: string,
    request: ApplyWorkflowTaskActionRequest,
    context: ApiRequestContext
  ): Promise<RegistryWorkflowTask> {
    return this.post<RegistryWorkflowTask>(
      `/workflow/tasks/${encodeURIComponent(taskId)}/actions`,
      request,
      "applyWorkflowTaskAction",
      context
    );
  }

  async listAnalystCases(context: ApiRequestContext, includeArchived = false): Promise<AnalystCase[]> {
    const params = new URLSearchParams({ include_archived: String(includeArchived), limit: "50", offset: "0" });
    const response = await this.get<ListEnvelope<AnalystCase>>(
      `/intelligence/cases?${params}`,
      "listAnalystCases",
      context
    );
    return response.items;
  }

  createAnalystCase(request: CreateAnalystCaseRequest, context: ApiRequestContext): Promise<AnalystCase> {
    return this.post<AnalystCase>("/intelligence/cases", request, "createAnalystCase", context);
  }

  getAnalystCase(caseId: string, context: ApiRequestContext): Promise<AnalystCase> {
    return this.get<AnalystCase>(
      `/intelligence/cases/${encodeURIComponent(caseId)}`,
      "getAnalystCase",
      context
    );
  }

  updateAnalystCase(
    caseId: string,
    request: UpdateAnalystCaseRequest,
    context: ApiRequestContext
  ): Promise<AnalystCase> {
    return this.patch<AnalystCase>(
      `/intelligence/cases/${encodeURIComponent(caseId)}`,
      request,
      "updateAnalystCase",
      context
    );
  }

  createAnalystSavedQuery(
    caseId: string,
    request: CreateAnalystSavedQueryRequest,
    context: ApiRequestContext
  ): Promise<AnalystCase["saved_queries"][number]> {
    return this.post<AnalystCase["saved_queries"][number]>(
      `/intelligence/cases/${encodeURIComponent(caseId)}/saved-queries`,
      request,
      "createAnalystSavedQuery",
      context
    );
  }

  createAnalystEvidence(
    caseId: string,
    request: CreateAnalystEvidenceRequest,
    context: ApiRequestContext
  ): Promise<AnalystCase["evidence_items"][number]> {
    return this.post<AnalystCase["evidence_items"][number]>(
      `/intelligence/cases/${encodeURIComponent(caseId)}/evidence`,
      request,
      "createAnalystEvidence",
      context
    );
  }

  async listAuditEvents(context: ApiRequestContext, options: AuditEventListOptions = {}): Promise<AuditEvent[]> {
    const params = new URLSearchParams();
    if (options.actorId) {
      params.set("actor_id", options.actorId);
    }
    if (options.eventType) {
      params.set("event_type", options.eventType);
    }
    if (options.resourceType) {
      params.set("resource_type", options.resourceType);
    }
    if (options.resourceId) {
      params.set("resource_id", options.resourceId);
    }
    if (options.limit !== undefined) {
      params.set("limit", String(options.limit));
    }
    if (options.offset !== undefined) {
      params.set("offset", String(options.offset));
    }
    const query = params.toString();
    const response = await this.get<ListEnvelope<AuditEvent>>(
      `/audit/events${query ? `?${query}` : ""}`,
      "listAuditEvents",
      context
    );
    return response.items;
  }

  createAuditEvent(request: CreateAuditEventRequest, context: ApiRequestContext): Promise<AuditEvent> {
    return this.post<AuditEvent>("/audit/events", request, "createAuditEvent", context);
  }

  async searchDirectoryUsers(query: string, context: ApiRequestContext, limit = 20): Promise<DirectoryUser[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    const normalizedQuery = query.trim();
    if (normalizedQuery) {
      params.set("query", normalizedQuery);
    }
    const response = await this.get<{ users: DirectoryUser[] }>(
      `/directory/users?${params}`,
      "searchDirectoryUsers",
      context
    );
    return response.users;
  }

  async listRoleMappings(context: ApiRequestContext, includeRemoved = false): Promise<RoleMapping[]> {
    const params = new URLSearchParams({ include_removed: String(includeRemoved) });
    const response = await this.get<{ members: RoleMapping[] }>(
      `/admin/role-mappings?${params}`,
      "listRoleMappings",
      context
    );
    return response.members;
  }

  importDirectoryUser(subjectId: string, context: ApiRequestContext): Promise<DirectoryUser> {
    return this.post<DirectoryUser>(
      "/admin/directory/users/import",
      { subject_id: subjectId },
      "importDirectoryUser",
      context
    );
  }

  upsertRoleMapping(request: UpsertRoleMappingRequest, context: ApiRequestContext): Promise<RoleMapping> {
    return this.post<RoleMapping>("/admin/role-mappings", request, "upsertRoleMapping", context);
  }

  updateRoleMappingStatus(roleMappingId: string, status: string, context: ApiRequestContext): Promise<RoleMapping> {
    return this.patch<RoleMapping>(
      `/admin/role-mappings/${encodeURIComponent(roleMappingId)}/status`,
      { status },
      "updateRoleMappingStatus",
      context
    );
  }

  getProfileSettings(context: ApiRequestContext): Promise<ProfileSettingsResponse> {
    return this.get<ProfileSettingsResponse>("/user-profiles/me/settings", "getProfileSettings", context);
  }

  putProfileSettings(request: ProfileSettingsPutRequest, context: ApiRequestContext): Promise<ProfileSettingsResponse> {
    return this.put<ProfileSettingsResponse>("/user-profiles/me/settings", request, "putProfileSettings", context);
  }

  listAssistantConversations(
    context: ApiRequestContext,
    includeArchived = false
  ): Promise<AssistantConversationListResponse> {
    const params = new URLSearchParams({ include_archived: String(includeArchived), limit: "50", offset: "0" });
    return this.get<AssistantConversationListResponse>(
      `/assistant/conversation-history?${params}`,
      "listAssistantConversations",
      context
    );
  }

  getAssistantConversation(conversationId: string, context: ApiRequestContext): Promise<AssistantConversationDetail> {
    return this.get<AssistantConversationDetail>(
      `/assistant/conversation-history/${encodeURIComponent(conversationId)}`,
      "getAssistantConversation",
      context
    );
  }

  appendAssistantConversationMessages(
    conversationId: string,
    request: AssistantConversationMessageAppendRequest,
    context: ApiRequestContext
  ): Promise<AssistantConversationDetail> {
    return this.post<AssistantConversationDetail>(
      `/assistant/conversations/${encodeURIComponent(conversationId)}/messages`,
      request,
      "appendAssistantConversationMessages",
      context
    );
  }

  updateAssistantConversation(
    conversationId: string,
    request: AssistantConversationPatchRequest,
    context: ApiRequestContext
  ): Promise<AssistantConversationDetail> {
    return this.patch<AssistantConversationDetail>(
      `/assistant/conversation-history/${encodeURIComponent(conversationId)}`,
      request,
      "updateAssistantConversation",
      context
    );
  }

  replaceAssistantConversationShares(
    conversationId: string,
    request: AssistantConversationShareReplaceRequest,
    context: ApiRequestContext
  ): Promise<AssistantConversationDetail> {
    return this.put<AssistantConversationDetail>(
      `/assistant/conversation-history/${encodeURIComponent(conversationId)}/shares`,
      request,
      "replaceAssistantConversationShares",
      context
    );
  }

  private get<T>(path: string, operation: string, context: ApiRequestContext): Promise<T> {
    return requestJson<T>({
      service: "registry-api",
      operation,
      baseUrl: this.baseUrl,
      path,
      context,
      fetcher: this.fetcher
    });
  }

  private post<T>(path: string, body: unknown, operation: string, context: ApiRequestContext): Promise<T> {
    return requestJson<T>({
      service: "registry-api",
      operation,
      baseUrl: this.baseUrl,
      path,
      method: "POST",
      body,
      context,
      fetcher: this.fetcher
    });
  }

  private put<T>(path: string, body: unknown, operation: string, context: ApiRequestContext): Promise<T> {
    return requestJson<T>({
      service: "registry-api",
      operation,
      baseUrl: this.baseUrl,
      path,
      method: "PUT",
      body,
      context,
      fetcher: this.fetcher
    });
  }

  private patch<T>(path: string, body: unknown, operation: string, context: ApiRequestContext): Promise<T> {
    return requestJson<T>({
      service: "registry-api",
      operation,
      baseUrl: this.baseUrl,
      path,
      method: "PATCH",
      body,
      context,
      fetcher: this.fetcher
    });
  }
}

function isRegistryIngestionAttempt(value: unknown): value is RegistryIngestionAttempt {
  if (typeof value !== "object" || value === null) return false;
  const attempt = value as Partial<RegistryIngestionAttempt>;
  return (
    typeof attempt.document_id === "string"
    && attempt.document_id.length > 0
    && typeof attempt.document_version_id === "string"
    && attempt.document_version_id.length > 0
    && typeof attempt.ingestion_job_id === "string"
    && attempt.ingestion_job_id.length > 0
    && ["QUEUED", "INGESTING", "INDEXED", "FAILED"].includes(
      attempt.ingestion_status ?? "",
    )
    && typeof attempt.created_at === "string"
    && Number.isFinite(Date.parse(attempt.created_at))
    && typeof attempt.updated_at === "string"
    && Number.isFinite(Date.parse(attempt.updated_at))
  );
}

function registryDocumentParams(options: DocumentMetadataSummaryOptions | DocumentListOptions): URLSearchParams {
  const params = new URLSearchParams();
  for (const topic of options.topics ?? []) {
    if (topic.trim()) {
      params.append("topic", topic.trim());
    }
  }
  if (options.status) {
    params.set("status", options.status);
  }
  if (options.classification) {
    params.set("classification", options.classification);
  }
  if (options.documentType) {
    params.set("document_type", options.documentType);
  }
  if (options.ownerId) {
    params.set("owner_id", options.ownerId);
  }
  if (options.tag) {
    params.set("tag", options.tag);
  }
  if (options.tenantId) {
    params.set("tenant_id", options.tenantId);
  }
  if (options.externalSystem) {
    params.set("external_system", options.externalSystem);
  }
  if (options.entityType) {
    params.set("entity_type", options.entityType);
  }
  if (options.entityId) {
    params.set("entity_id", options.entityId);
  }
  if (options.externalRef) {
    params.set("external_ref", options.externalRef);
  }
  for (const contextTag of options.contextTags ?? []) {
    if (contextTag.trim()) {
      params.append("context_tag", contextTag.trim());
    }
  }
  return params;
}
