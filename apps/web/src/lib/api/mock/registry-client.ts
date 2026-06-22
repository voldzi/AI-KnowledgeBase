import type {
  ApiRequestContext,
  ApplyWorkflowTaskActionRequest,
  AuditEvent,
  AuditEventListOptions,
  AuthorizationHint,
  AssistantConversationDetail,
  AssistantConversationListResponse,
  AssistantConversationMessageAppendRequest,
  AssistantConversationPatchRequest,
  AssistantConversationShareReplaceRequest,
  CreateAuditEventRequest,
  CreateDocumentRequest,
  CreateVersionRequest,
  DirectoryUser,
  Document,
  DocumentListOptions,
  DocumentAssignment,
  DocumentMetadataSummary,
  DocumentMetadataSummaryBucket,
  DocumentMetadataSummaryOptions,
  DocumentMetadataSummaryTopic,
  DocumentVersion,
  RegistryApiClient,
  ReplaceDocumentAssignmentsRequest,
  RegistryWorkflowTask,
  RoleMapping,
  UpsertRoleMappingRequest,
  WorkflowTaskListOptions
} from "@/lib/types";
import { ApiClientError } from "@/lib/types";

import { cloneMock, mockAuditEvents, mockAuthorization, mockDocuments, mockVersions } from "./data";

export class MockRegistryClient implements RegistryApiClient {
  private readonly documents = cloneMock(mockDocuments);
  private readonly versions = cloneMock(mockVersions);
  private readonly auditEvents = cloneMock(mockAuditEvents);
  private readonly workflowTaskOverrides = new Map<string, RegistryWorkflowTask>();
  private readonly assistantConversations = new Map<string, AssistantConversationDetail>();

  async listDocuments(_context: ApiRequestContext, options: DocumentListOptions = {}): Promise<Document[]> {
    return cloneMock(this.documents.filter((document) => documentMatchesListOptions(document, options)));
  }

  async getDocumentMetadataSummary(
    _context: ApiRequestContext,
    options: DocumentMetadataSummaryOptions = {}
  ): Promise<DocumentMetadataSummary> {
    const topics = options.topics?.length ? options.topics : ["all documents"];
    const documents = this.documents.filter((document) => documentMatchesSummaryOptions(document, options));
    const topicSummaries = topics.map((topic) => {
      const topicDocuments = isAllDocumentsTopic(topic)
        ? documents
        : documents.filter((document) => documentMatchesTopic(document, topic));
      return documentMetadataSummaryTopic(topic, topicDocuments);
    });
    const matchedIds = new Set<string>();
    topicSummaries.forEach((summary) => {
      if (isAllDocumentsTopic(summary.topic)) {
        documents.forEach((document) => matchedIds.add(document.document_id));
      } else {
        documents
          .filter((document) => documentMatchesTopic(document, summary.topic))
          .forEach((document) => matchedIds.add(document.document_id));
      }
    });
    return {
      total_visible_documents: documents.length,
      total_matched_documents: matchedIds.size,
      topics: topicSummaries,
      by_document_type: summaryBuckets(documents.map((document) => document.document_type)),
      by_classification: summaryBuckets(documents.map((document) => document.classification)),
      by_status: summaryBuckets(documents.map((document) => document.status)),
      by_owner: summaryBuckets(documents.map((document) => document.gestor_unit ?? document.owner ?? document.owner_id)),
      warnings: ["REGISTRY_METADATA_SUMMARY"]
    };
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
      metadata,
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
      metadata: metadata ?? {},
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

  async listAuditEvents(_context: ApiRequestContext, options: AuditEventListOptions = {}): Promise<AuditEvent[]> {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    const events = this.auditEvents.filter((event) => auditEventMatchesOptions(event, options));
    return cloneMock(events.slice(offset, offset + limit));
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

  async searchDirectoryUsers(_query: string, _context: ApiRequestContext, _limit = 20): Promise<DirectoryUser[]> {
    return [
      { subject_id: "mock-user-1", display_name: "Jan Novák", email: "jan.novak@example.cz", groups: ["staff"] },
      { subject_id: "mock-user-2", display_name: "Eva Horáková", email: "eva.horakova@example.cz", groups: ["staff", "admins"] }
    ];
  }

  async listRoleMappings(_context: ApiRequestContext, _includeRemoved = false): Promise<RoleMapping[]> {
    return [];
  }

  async importDirectoryUser(subjectId: string, _context: ApiRequestContext): Promise<DirectoryUser> {
    return { subject_id: subjectId, display_name: null, email: null, groups: [] };
  }

  async upsertRoleMapping(request: UpsertRoleMappingRequest, _context: ApiRequestContext): Promise<RoleMapping> {
    const now = new Date().toISOString();
    return {
      role_mapping_id: `rm_mock_${Date.now()}`,
      ...request,
      display_name: null,
      created_at: now,
      updated_at: now
    };
  }

  async updateRoleMappingStatus(roleMappingId: string, status: string, _context: ApiRequestContext): Promise<RoleMapping> {
    const now = new Date().toISOString();
    return {
      role_mapping_id: roleMappingId,
      subject_type: "user",
      subject_id: "unknown",
      role: "unknown",
      status,
      display_name: null,
      created_at: now,
      updated_at: now
    };
  }

  async listAssistantConversations(
    context: ApiRequestContext,
    includeArchived = false
  ): Promise<AssistantConversationListResponse> {
    const items = [...this.assistantConversations.values()]
      .filter((conversation) => conversation.user_id === context.subjectId || conversation.shared_with.some((share) => share.status === "active" && share.subject_id === context.subjectId))
      .filter((conversation) => includeArchived || conversation.status !== "archived")
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .map((conversation) => ({
        conversation_id: conversation.conversation_id,
        user_id: conversation.user_id,
        status: conversation.status,
        title: conversation.title,
        visibility: conversation.visibility,
        retention_until: conversation.retention_until,
        archived_at: conversation.archived_at,
        created_at: conversation.created_at,
        updated_at: conversation.updated_at,
        shared_with: conversation.shared_with,
        message_count: conversation.messages.length
      }));
    return cloneMock({ items, limit: 50, offset: 0 });
  }

  async getAssistantConversation(conversationId: string, context: ApiRequestContext): Promise<AssistantConversationDetail> {
    const conversation = this.requireAssistantConversation(conversationId);
    if (conversation.user_id !== context.subjectId && !conversation.shared_with.some((share) => share.status === "active" && share.subject_id === context.subjectId)) {
      throw new ApiClientError("Conversation access denied", 403, "CONVERSATION_ACCESS_DENIED", "mock-trace");
    }
    return cloneMock(conversation);
  }

  async appendAssistantConversationMessages(
    conversationId: string,
    request: AssistantConversationMessageAppendRequest,
    context: ApiRequestContext
  ): Promise<AssistantConversationDetail> {
    const now = new Date().toISOString();
    const existing = this.assistantConversations.get(conversationId);
    const conversation: AssistantConversationDetail = existing ?? {
      conversation_id: conversationId,
      user_id: request.user_id || context.subjectId,
      status: "active",
      title: request.title ?? null,
      visibility: request.visibility ?? "private",
      retention_until: request.retention_until ?? null,
      archived_at: null,
      created_at: now,
      updated_at: now,
      shared_with: [],
      messages: []
    };
    if (conversation.user_id !== request.user_id && conversation.user_id !== context.subjectId) {
      throw new ApiClientError("Conversation belongs to a different user", 403, "CONVERSATION_USER_MISMATCH", "mock-trace");
    }
    const appended = request.messages.map((message, index) => ({
      message_id: `msg_mock_${Date.now()}_${index}`,
      role: message.role,
      content: message.content,
      response_type: message.response_type ?? null,
      citations: message.citations ?? [],
      metadata: message.metadata ?? {},
      created_at: now
    }));
    const updated: AssistantConversationDetail = {
      ...conversation,
      title: conversation.title ?? request.title ?? null,
      visibility: request.visibility ?? conversation.visibility,
      retention_until: request.retention_until ?? conversation.retention_until,
      updated_at: now,
      messages: [...conversation.messages, ...appended]
    };
    this.assistantConversations.set(conversationId, cloneMock(updated));
    return cloneMock(updated);
  }

  async updateAssistantConversation(
    conversationId: string,
    request: AssistantConversationPatchRequest,
    context: ApiRequestContext
  ): Promise<AssistantConversationDetail> {
    const conversation = await this.getAssistantConversation(conversationId, context);
    if (conversation.user_id !== context.subjectId) {
      throw new ApiClientError("Conversation owner required", 403, "CONVERSATION_OWNER_REQUIRED", "mock-trace");
    }
    const updated: AssistantConversationDetail = {
      ...conversation,
      title: request.title === undefined ? conversation.title : request.title,
      status: request.status ?? conversation.status,
      visibility: request.visibility ?? conversation.visibility,
      retention_until: request.retention_until === undefined ? conversation.retention_until : request.retention_until,
      archived_at: request.status === "archived" ? new Date().toISOString() : request.status === "active" ? null : conversation.archived_at,
      updated_at: new Date().toISOString()
    };
    this.assistantConversations.set(conversationId, cloneMock(updated));
    return cloneMock(updated);
  }

  async replaceAssistantConversationShares(
    conversationId: string,
    request: AssistantConversationShareReplaceRequest,
    context: ApiRequestContext
  ): Promise<AssistantConversationDetail> {
    const conversation = await this.getAssistantConversation(conversationId, context);
    if (conversation.user_id !== context.subjectId) {
      throw new ApiClientError("Conversation owner required", 403, "CONVERSATION_OWNER_REQUIRED", "mock-trace");
    }
    const now = new Date().toISOString();
    const updated: AssistantConversationDetail = {
      ...conversation,
      visibility: request.shares.length ? request.visibility ?? "shared" : "private",
      shared_with: request.shares.map((share, index) => ({
        conversation_share_id: `share_mock_${index + 1}`,
        subject_type: share.subject_type,
        subject_id: share.subject_id,
        permission: share.permission,
        status: "active",
        created_by: context.subjectId,
        created_at: now,
        updated_at: now
      })),
      updated_at: now
    };
    this.assistantConversations.set(conversationId, cloneMock(updated));
    return cloneMock(updated);
  }

  private requireDocument(documentId: string): Document {
    const document = this.documents.find((candidate) => candidate.document_id === documentId);
    if (!document) {
      throw new ApiClientError("Document not found", 404, "DOCUMENT_NOT_FOUND", "mock-trace");
    }
    return document;
  }

  private requireAssistantConversation(conversationId: string): AssistantConversationDetail {
    const existing = this.assistantConversations.get(conversationId);
    if (existing) {
      return existing;
    }
    const now = new Date().toISOString();
    const created: AssistantConversationDetail = {
      conversation_id: conversationId,
      user_id: "user_dev",
      status: "active",
      title: null,
      visibility: "private",
      retention_until: null,
      archived_at: null,
      created_at: now,
      updated_at: now,
      shared_with: [],
      messages: []
    };
    this.assistantConversations.set(conversationId, created);
    return created;
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

function auditEventMatchesOptions(event: AuditEvent, options: AuditEventListOptions): boolean {
  if (options.actorId && event.actor_id !== options.actorId) {
    return false;
  }
  if (options.eventType && event.event_type !== options.eventType) {
    return false;
  }
  if (options.resourceType && event.resource_type !== options.resourceType) {
    return false;
  }
  if (options.resourceId && event.resource_id !== options.resourceId) {
    return false;
  }
  return true;
}

function documentMatchesSummaryOptions(document: Document, options: DocumentMetadataSummaryOptions): boolean {
  if (options.status && document.status !== options.status) {
    return false;
  }
  if (options.classification && document.classification !== options.classification) {
    return false;
  }
  if (options.documentType && document.document_type !== options.documentType) {
    return false;
  }
  if (options.ownerId && document.owner_id !== options.ownerId) {
    return false;
  }
  if (options.tag && !document.tags.includes(options.tag)) {
    return false;
  }
  if (options.tenantId && metadataString(document.metadata, "tenant_id") !== options.tenantId) {
    return false;
  }
  if (options.externalSystem && metadataString(document.metadata, "external_system") !== options.externalSystem) {
    return false;
  }
  if (options.entityType && metadataString(document.metadata, "entity_type") !== options.entityType) {
    return false;
  }
  if (options.entityId && metadataString(document.metadata, "entity_id") !== options.entityId) {
    return false;
  }
  if (options.externalRef && metadataString(document.metadata, "external_ref") !== options.externalRef) {
    return false;
  }
  if (options.contextTags?.length && !options.contextTags.every((tag) => documentMatchesContextTag(document, tag))) {
    return false;
  }
  return true;
}

function documentMatchesListOptions(document: Document, options: DocumentListOptions): boolean {
  if (!documentMatchesSummaryOptions(document, options)) {
    return false;
  }
  const topics = options.topics?.filter((topic) => !isAllDocumentsTopic(topic)) ?? [];
  if (!topics.length) {
    return true;
  }
  return topics.some((topic) => documentMatchesTopic(document, topic));
}

function documentMetadataSummaryTopic(topic: string, documents: Document[]): DocumentMetadataSummaryTopic {
  return {
    topic,
    document_count: documents.length,
    valid_or_approved_count: documents.filter((document) => document.status === "valid" || document.status === "approved").length,
    document_types: summaryBuckets(documents.map((document) => document.document_type)),
    classifications: summaryBuckets(documents.map((document) => document.classification)),
    statuses: summaryBuckets(documents.map((document) => document.status)),
    owners: summaryBuckets(documents.map((document) => document.gestor_unit ?? document.owner ?? document.owner_id)),
    example_documents: documents.slice(0, 5).map((document) => document.title)
  };
}

function summaryBuckets(values: string[]): DocumentMetadataSummaryBucket[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "cs"))
    .slice(0, 12)
    .map(([key, count]) => ({ key, label: key, count }));
}

function documentMatchesTopic(document: Document, topic: string): boolean {
  const topicText = normalizeSummaryText(topic);
  if (!topicText) {
    return false;
  }
  const haystack = normalizeSummaryText([
    document.document_id,
    document.title,
    document.document_type,
    document.status,
    document.classification,
    document.owner_id,
    document.owner,
    document.gestor_unit ?? "",
    ...document.tags,
    ...metadataSummaryValues(document.metadata)
  ].join(" "));
  if (haystack.includes(topicText)) {
    return true;
  }
  const tokens = topicText.split(/\s+/).filter((token) => token.length >= 3);
  return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
}

function metadataSummaryValues(metadata: Record<string, unknown> | undefined): string[] {
  if (!metadata) {
    return [];
  }
  return Object.entries(metadata).flatMap(([key, value]) => metadataEntryValues(key, value));
}

function metadataEntryValues(key: string, value: unknown): string[] {
    if (value === null || value === undefined) {
      return [key];
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return [key, String(value)];
    }
    if (Array.isArray(value)) {
      return [key, ...value.filter((item) => ["string", "number", "boolean"].includes(typeof item)).map(String)];
    }
    if (typeof value === "object") {
      return [
        key,
        ...Object.entries(value as Record<string, unknown>).flatMap(([nestedKey, nestedValue]) =>
          metadataEntryValues(nestedKey, nestedValue)
        )
      ];
    }
    return [key];
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const direct = metadata?.[key];
  if (typeof direct === "string") {
    return direct;
  }
  for (const nestedKey of ["stratos", "external"]) {
    const nested = metadata?.[nestedKey];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const value = (nested as Record<string, unknown>)[key];
      if (typeof value === "string") {
        return value;
      }
    }
  }
  return null;
}

function documentMatchesContextTag(document: Document, contextTag: string): boolean {
  const normalized = normalizeSummaryText(contextTag);
  if (!normalized) {
    return true;
  }
  if (document.tags.some((tag) => normalizeSummaryText(tag) === normalized)) {
    return true;
  }
  return metadataSummaryValues(document.metadata).some((value) => normalizeSummaryText(value).includes(normalized));
}

function normalizeSummaryText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isAllDocumentsTopic(topic: string): boolean {
  return ["all documents", "vsechny dokumenty", "dokumenty"].includes(normalizeSummaryText(topic));
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
