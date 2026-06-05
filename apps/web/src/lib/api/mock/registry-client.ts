import type {
  ApiRequestContext,
  AuditEvent,
  AuthorizationHint,
  CreateAuditEventRequest,
  CreateDocumentRequest,
  CreateVersionRequest,
  Document,
  DocumentVersion,
  RegistryApiClient
} from "@/lib/types";
import { ApiClientError } from "@/lib/types";

import { cloneMock, mockAuditEvents, mockAuthorization, mockDocuments, mockVersions } from "./data";

export class MockRegistryClient implements RegistryApiClient {
  private readonly documents = cloneMock(mockDocuments);
  private readonly versions = cloneMock(mockVersions);
  private readonly auditEvents = cloneMock(mockAuditEvents);

  async listDocuments(_context: ApiRequestContext): Promise<Document[]> {
    return cloneMock(this.documents);
  }

  async getDocument(documentId: string, _context: ApiRequestContext): Promise<Document> {
    const document = this.documents.find((candidate) => candidate.document_id === documentId);
    if (!document) {
      throw new ApiClientError("Document not found", 404, "DOCUMENT_NOT_FOUND", "mock-trace");
    }
    return cloneMock(document);
  }

  async createDocument(request: CreateDocumentRequest, _context: ApiRequestContext): Promise<Document> {
    const now = new Date().toISOString();
    const document: Document = {
      document_id: `doc_${this.documents.length + 201}`,
      status: "draft",
      created_at: now,
      updated_at: now,
      owner: request.owner_id,
      ...request
    };
    this.documents.unshift(document);
    return cloneMock(document);
  }

  async listDocumentVersions(documentId: string, _context: ApiRequestContext): Promise<DocumentVersion[]> {
    return cloneMock(this.versions.filter((version) => version.document_id === documentId));
  }

  async createDocumentVersion(
    documentId: string,
    request: CreateVersionRequest,
    _context: ApiRequestContext
  ): Promise<DocumentVersion> {
    const now = new Date().toISOString();
    const version: DocumentVersion = {
      document_version_id: `ver_${documentId.replace("doc_", "")}_${this.versions.length + 1}`,
      document_id: documentId,
      status: "draft",
      file_hash: "sha256:mock-pending",
      created_at: now,
      published_at: null,
      ...request
    };
    this.versions.unshift(version);
    return cloneMock(version);
  }

  async publishDocumentVersion(
    documentId: string,
    versionId: string,
    _context: ApiRequestContext
  ): Promise<DocumentVersion> {
    const version = this.versions.find(
      (candidate) => candidate.document_id === documentId && candidate.document_version_id === versionId
    );
    if (!version) {
      throw new ApiClientError("Document version not found", 404, "VERSION_NOT_FOUND", "mock-trace");
    }
    version.status = "valid";
    version.published_at = new Date().toISOString();
    return cloneMock(version);
  }

  async getAuthorizationHints(_context: ApiRequestContext): Promise<AuthorizationHint> {
    return cloneMock(mockAuthorization);
  }

  async listAuditEvents(_context: ApiRequestContext): Promise<AuditEvent[]> {
    return cloneMock(this.auditEvents);
  }

  async createAuditEvent(request: CreateAuditEventRequest, context: ApiRequestContext): Promise<AuditEvent> {
    const event: AuditEvent = {
      audit_event_id: `audit_${this.auditEvents.length + 600}`,
      correlation_id: context.correlationId ?? context.requestId ?? "mock-correlation",
      created_at: new Date().toISOString(),
      ...request
    };
    this.auditEvents.unshift(event);
    return cloneMock(event);
  }
}
