import type {
  ApiRequestContext,
  ApplyWorkflowTaskActionRequest,
  AuditEvent,
  AuditEventListOptions,
  AuthorizationHint,
  CreateAuditEventRequest,
  CreateDocumentRequest,
  CreateVersionRequest,
  DirectoryUser,
  Document,
  DocumentListOptions,
  DocumentAssignment,
  DocumentMetadataSummary,
  DocumentMetadataSummaryOptions,
  DocumentVersion,
  RegistryApiClient,
  ReplaceDocumentAssignmentsRequest,
  RegistryWorkflowTask,
  RoleMapping,
  UpsertRoleMappingRequest,
  WorkflowTaskListOptions
} from "@/lib/types";

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
    const params = new URLSearchParams({ query, limit: String(limit) });
    const response = await this.get<{ users: DirectoryUser[] }>(
      `/admin/directory/users?${params}`,
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
