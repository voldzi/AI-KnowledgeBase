import type {
  ApiRequestContext,
  ApplyWorkflowTaskActionRequest,
  AuditEvent,
  AuthorizationHint,
  CreateAuditEventRequest,
  CreateDocumentRequest,
  CreateVersionRequest,
  Document,
  DocumentAssignment,
  DocumentVersion,
  ReplaceDocumentAssignmentsRequest,
  RegistryWorkflowTask,
  WorkflowTaskListOptions,
  RegistryApiClient
} from "@/lib/types";
import { ApiClientError } from "@/lib/types";

import { cloneMock, mockAuditEvents, mockAuthorization, mockDocuments, mockVersions } from "./data";

export class MockRegistryClient implements RegistryApiClient {
  private readonly documents = cloneMock(mockDocuments);
  private readonly versions = cloneMock(mockVersions);
  private readonly auditEvents = cloneMock(mockAuditEvents);
  private readonly workflowTaskOverrides = new Map<string, RegistryWorkflowTask>();

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
    const {
      access_policies: _accessPolicies,
      assignments: assignmentRequests,
      metadata: _metadata,
      ...documentRequest
    } = request;
    const documentId = `doc_${this.documents.length + 201}`;
    const document: Document = {
      ...documentRequest,
      document_id: documentId,
      status: "draft",
      created_at: now,
      updated_at: now,
      owner: request.owner_id,
      assignments: assignmentRequests?.map((assignment, index) => ({
        assignment_id: `assign_${documentId}_${index + 1}`,
        document_id: documentId,
        role: assignment.role,
        subject_type: assignment.subject_type ?? "user",
        subject_id: assignment.subject_id,
        display_label: assignment.display_label ?? null,
        is_primary: assignment.is_primary ?? false,
        active: assignment.active ?? true,
        sla_days: assignment.sla_days ?? null,
        escalation_subject_type: assignment.escalation_subject_type ?? null,
        escalation_subject_id: assignment.escalation_subject_id ?? null,
        escalation_label: assignment.escalation_label ?? null,
        assigned_by: "mock",
        assigned_at: now,
        last_audit_event_id: null,
        metadata: assignment.metadata ?? {},
        created_at: now,
        updated_at: now
      }))
    };
    this.documents.unshift(document);
    return cloneMock(document);
  }

  async listDocumentAssignments(documentId: string, _context: ApiRequestContext): Promise<DocumentAssignment[]> {
    return cloneMock(this.requireDocument(documentId).assignments ?? []);
  }

  async replaceDocumentAssignments(
    documentId: string,
    request: ReplaceDocumentAssignmentsRequest,
    context: ApiRequestContext
  ): Promise<DocumentAssignment[]> {
    if (request.assignments.length === 0) {
      throw new ApiClientError("At least one document assignment is required", 422, "VALIDATION_ERROR", "mock-trace");
    }

    const document = this.requireDocument(documentId);
    const now = new Date().toISOString();
    document.assignments = request.assignments.map((assignment, index) => ({
      assignment_id: `assign_${documentId}_${index + 1}`,
      document_id: documentId,
      role: assignment.role,
      subject_type: assignment.subject_type ?? "user",
      subject_id: assignment.subject_id,
      display_label: assignment.display_label ?? null,
      is_primary: assignment.is_primary ?? false,
      active: assignment.active ?? true,
      sla_days: assignment.sla_days ?? null,
      escalation_subject_type: assignment.escalation_subject_type ?? null,
      escalation_subject_id: assignment.escalation_subject_id ?? null,
      escalation_label: assignment.escalation_label ?? null,
      assigned_by: context.subjectId,
      assigned_at: now,
      last_audit_event_id: `audit_${this.auditEvents.length + 601}`,
      metadata: assignment.metadata ?? {},
      created_at: now,
      updated_at: now
    }));
    const owner = document.assignments.find((assignment) => assignment.role === "owner" && assignment.active);
    const gestor = document.assignments.find((assignment) => assignment.role === "gestor" && assignment.active);
    if (owner) {
      document.owner_id = owner.subject_id;
      document.owner = owner.display_label ?? owner.subject_id;
    }
    if (gestor) {
      document.gestor_unit = gestor.display_label ?? gestor.subject_id;
    }
    document.updated_at = now;
    return cloneMock(document.assignments);
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
    const document = this.documents.find((candidate) => candidate.document_id === documentId);
    if (!document) {
      throw new ApiClientError("Document not found", 404, "DOCUMENT_NOT_FOUND", "mock-trace");
    }
    if (document.status !== "approved") {
      throw new ApiClientError("Document must be approved before publishing", 409, "PUBLISH_REQUIRES_APPROVAL", "mock-trace");
    }
    const version = this.versions.find(
      (candidate) => candidate.document_id === documentId && candidate.document_version_id === versionId
    );
    if (!version) {
      throw new ApiClientError("Document version not found", 404, "VERSION_NOT_FOUND", "mock-trace");
    }
    for (const activeVersion of this.versions) {
      if (
        activeVersion.document_id === documentId &&
        activeVersion.document_version_id !== versionId &&
        activeVersion.status === "valid"
      ) {
        activeVersion.status = "superseded";
      }
    }
    version.status = "valid";
    version.published_at = new Date().toISOString();
    document.status = "valid";
    return cloneMock(version);
  }

  async archiveDocumentVersion(
    documentId: string,
    versionId: string,
    _context: ApiRequestContext
  ): Promise<DocumentVersion> {
    const document = this.documents.find((candidate) => candidate.document_id === documentId);
    if (!document) {
      throw new ApiClientError("Document not found", 404, "DOCUMENT_NOT_FOUND", "mock-trace");
    }
    const version = this.versions.find(
      (candidate) => candidate.document_id === documentId && candidate.document_version_id === versionId
    );
    if (!version) {
      throw new ApiClientError("Document version not found", 404, "VERSION_NOT_FOUND", "mock-trace");
    }
    version.status = "archived";
    if (!this.versions.some((candidate) => candidate.document_id === documentId && candidate.status === "valid")) {
      document.status = "archived";
    }
    return cloneMock(version);
  }

  async getAuthorizationHints(_context: ApiRequestContext): Promise<AuthorizationHint> {
    return cloneMock(mockAuthorization);
  }

  async listWorkflowTasks(
    _context: ApiRequestContext,
    options: WorkflowTaskListOptions = {}
  ): Promise<RegistryWorkflowTask[]> {
    const now = new Date().toISOString();
    const generatedTasks: RegistryWorkflowTask[] = [];
    for (const document of this.documents) {
      const draftAssignment = assignmentFor(document, ["owner", "gestor"]);
      const reviewAssignment = assignmentFor(document, ["reviewer", "approver", "gestor", "owner"]);
      const governanceAssignment = assignmentFor(document, ["auditor", "gestor", "owner"]);
      if (document.status === "review") {
        generatedTasks.push({
          task_id: `task_review_${document.document_id}`,
          source_key: `document-review:${document.document_id}`,
          kind: "review",
          priority: document.classification === "restricted" || document.classification === "confidential" ? "high" : "medium",
          status: "open",
          title: "Document review required",
          description: "Review metadata, source context, access classification and publication readiness.",
          source: "Registry document status",
          owner_id: reviewAssignment?.subject_id ?? document.owner_id,
          owner_label: assignmentLabel(reviewAssignment) ?? document.gestor_unit ?? document.owner,
          role: assignmentRoleLabel(reviewAssignment) ?? "Owner / gestor",
          document_id: document.document_id,
          document_title: document.title,
          document_version_id: null,
          audit_event_id: null,
          job_id: null,
          due_at: document.updated_at,
          resolved_at: null,
          metadata: { derived: true, ...assignmentTaskMetadata(reviewAssignment) },
          created_at: document.updated_at,
          updated_at: now
        });
      }
      if (document.status === "draft") {
        generatedTasks.push({
          task_id: `task_draft_${document.document_id}`,
          source_key: `document-draft:${document.document_id}`,
          kind: "draft",
          priority: "medium",
          status: "waiting",
          title: "Draft needs completion",
          description: "Complete source file, validity metadata and ingestion preparation before review.",
          source: "Registry draft state",
          owner_id: draftAssignment?.subject_id ?? document.owner_id,
          owner_label: assignmentLabel(draftAssignment) ?? document.owner,
          role: assignmentRoleLabel(draftAssignment) ?? "Document manager",
          document_id: document.document_id,
          document_title: document.title,
          document_version_id: null,
          audit_event_id: null,
          job_id: null,
          due_at: document.updated_at,
          resolved_at: null,
          metadata: { derived: true, ...assignmentTaskMetadata(draftAssignment) },
          created_at: document.updated_at,
          updated_at: now
        });
      }
      if ((document.classification === "restricted" || document.classification === "confidential") && document.status !== "valid") {
        generatedTasks.push({
          task_id: `task_governance_${document.document_id}`,
          source_key: `document-governance:${document.document_id}`,
          kind: "governance",
          priority: document.classification === "confidential" ? "critical" : "high",
          status: "open",
          title: "Governance check before publication",
          description: "Restricted sources require access, conflict and compliance checks before publication.",
          source: "Document classification policy",
          owner_id: governanceAssignment?.subject_id ?? document.owner_id,
          owner_label: assignmentLabel(governanceAssignment) ?? document.gestor_unit ?? document.owner,
          role: assignmentRoleLabel(governanceAssignment) ?? "Governance / auditor",
          document_id: document.document_id,
          document_title: document.title,
          document_version_id: null,
          audit_event_id: null,
          job_id: null,
          due_at: document.updated_at,
          resolved_at: null,
          metadata: { derived: true, ...assignmentTaskMetadata(governanceAssignment) },
          created_at: document.updated_at,
          updated_at: now
        });
      }
    }
    const tasks = generatedTasks.map((task) => this.workflowTaskOverrides.get(task.task_id) ?? task);
    return cloneMock(tasks.filter((task) => workflowTaskMatchesOptions(task, options)));
  }

  async applyWorkflowTaskAction(
    taskId: string,
    request: ApplyWorkflowTaskActionRequest,
    context: ApiRequestContext
  ): Promise<RegistryWorkflowTask> {
    const task = (await this.listWorkflowTasks(context, { includeResolved: true })).find(
      (candidate) => candidate.task_id === taskId
    );
    if (!task) {
      throw new ApiClientError("Workflow task not found", 404, "WORKFLOW_TASK_NOT_FOUND", "mock-trace");
    }

    const now = new Date().toISOString();
    const resolvesTask = ["approve", "publish", "archive", "resolve"].includes(request.action);
    const document = task.document_id
      ? this.documents.find((candidate) => candidate.document_id === task.document_id)
      : undefined;
    const latestVersion = task.document_id
      ? this.versions
          .filter((candidate) => candidate.document_id === task.document_id)
          .sort((left, right) => right.created_at.localeCompare(left.created_at))[0]
      : undefined;

    if (request.action === "approve" && document && task.kind === "review") {
      document.status = "approved";
      if (latestVersion && ["draft", "review"].includes(latestVersion.status)) {
        latestVersion.status = "approved";
      }
    }
    if (request.action === "request_changes" && document && ["review", "approved"].includes(document.status)) {
      document.status = "draft";
      if (latestVersion?.status === "approved") {
        latestVersion.status = "draft";
      }
    }
    if (request.action === "publish" && document && latestVersion) {
      if (document.status !== "approved") {
        throw new ApiClientError("Document must be approved before publishing", 409, "PUBLISH_REQUIRES_APPROVAL", "mock-trace");
      }
      for (const activeVersion of this.versions) {
        if (
          activeVersion.document_id === document.document_id &&
          activeVersion.document_version_id !== latestVersion.document_version_id &&
          activeVersion.status === "valid"
        ) {
          activeVersion.status = "superseded";
        }
      }
      latestVersion.status = "valid";
      latestVersion.published_at = now;
      document.status = "valid";
    }
    if (request.action === "archive" && document) {
      const version =
        this.versions.find((candidate) => candidate.document_id === document.document_id && candidate.status === "valid") ??
        latestVersion;
      if (version) {
        version.status = "archived";
      }
      if (!this.versions.some((candidate) => candidate.document_id === document.document_id && candidate.status === "valid")) {
        document.status = "archived";
      }
    }

    const nextTask: RegistryWorkflowTask = {
      ...task,
      status: resolvesTask ? "resolved" : "open",
      owner_id: request.assignee_id ?? task.owner_id,
      owner_label: request.assignee_id ?? task.owner_label,
      resolved_at: resolvesTask ? now : request.action === "request_changes" ? null : task.resolved_at,
      metadata: {
        ...task.metadata,
        last_action: request.action,
        last_actor_id: context.subjectId,
        last_comment: request.comment ?? null,
        last_action_at: now,
        decision_metadata: request.metadata ?? {}
      },
      updated_at: now
    };
    this.workflowTaskOverrides.set(taskId, cloneMock(nextTask));
    return cloneMock(nextTask);
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

  private requireDocument(documentId: string): Document {
    const document = this.documents.find((candidate) => candidate.document_id === documentId);
    if (!document) {
      throw new ApiClientError("Document not found", 404, "DOCUMENT_NOT_FOUND", "mock-trace");
    }
    return document;
  }
}

function workflowTaskMatchesOptions(task: RegistryWorkflowTask, options: WorkflowTaskListOptions): boolean {
  if (!options.includeResolved && !["open", "waiting", "blocked"].includes(task.status)) {
    return false;
  }
  if (options.status && task.status !== options.status) {
    return false;
  }
  if (options.kind && task.kind !== options.kind) {
    return false;
  }
  if (options.priority && task.priority !== options.priority) {
    return false;
  }
  if (options.documentId && task.document_id !== options.documentId) {
    return false;
  }
  if (options.ownerId && task.owner_id !== options.ownerId) {
    return false;
  }
  return true;
}

function assignmentFor(document: Document, roles: DocumentAssignment["role"][]): DocumentAssignment | undefined {
  const assignments = document.assignments ?? [];
  return roles
    .flatMap((role) =>
      assignments
        .filter((assignment) => assignment.active && assignment.role === role)
        .sort((left, right) => Number(right.is_primary) - Number(left.is_primary))
    )
    .at(0);
}

function assignmentLabel(assignment: DocumentAssignment | undefined): string | undefined {
  if (!assignment) {
    return undefined;
  }
  return assignment.display_label ?? assignment.subject_id;
}

function assignmentRoleLabel(assignment: DocumentAssignment | undefined): string | undefined {
  if (!assignment) {
    return undefined;
  }
  return assignment.role.replaceAll("_", " ");
}

function assignmentTaskMetadata(assignment: DocumentAssignment | undefined): Record<string, unknown> {
  if (!assignment) {
    return {};
  }
  return {
    assignment_id: assignment.assignment_id,
    assignment_role: assignment.role,
    sla_days: assignment.sla_days,
    escalation_subject_id: assignment.escalation_subject_id,
    escalated: false
  };
}
