import type {
  ApiRequestContext,
  ApplyWorkflowTaskActionRequest,
  AuditEvent,
  AuthorizationHint,
  CreateAuditEventRequest,
  CreateDocumentRequest,
  CreateVersionRequest,
  Document,
  DocumentVersion,
  RegistryWorkflowTask,
  WorkflowTaskListOptions,
  RegistryApiClient
} from "@/lib/types";

import type { AklFetch } from "../http-client";
import { requestJson } from "../http-client";

interface AuthzCheckResponse {
  allowed: boolean;
}

interface ListEnvelope<T> {
  items: T[];
}

export class ProductionRegistryClient implements RegistryApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher?: AklFetch
  ) {}

  async listDocuments(context: ApiRequestContext): Promise<Document[]> {
    const response = await this.get<ListEnvelope<Document>>("/documents", "listDocuments", context);
    return response.items;
  }

  getDocument(documentId: string, context: ApiRequestContext): Promise<Document> {
    return this.get<Document>(`/documents/${documentId}`, "getDocument", context);
  }

  createDocument(request: CreateDocumentRequest, context: ApiRequestContext): Promise<Document> {
    return this.post<Document>("/documents", request, "createDocument", context);
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

  async listAuditEvents(context: ApiRequestContext): Promise<AuditEvent[]> {
    const response = await this.get<ListEnvelope<AuditEvent>>("/audit/events", "listAuditEvents", context);
    return response.items;
  }

  createAuditEvent(request: CreateAuditEventRequest, context: ApiRequestContext): Promise<AuditEvent> {
    return this.post<AuditEvent>("/audit/events", request, "createAuditEvent", context);
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
}
