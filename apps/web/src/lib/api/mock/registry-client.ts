import { createHash } from "node:crypto";

import type {
  ApiRequestContext,
  ApplyWorkflowTaskActionRequest,
  AuditEvent,
  AuditEventListOptions,
  AnalystCase,
  AuthorizationHint,
  CreateAnalystCaseRequest,
  CreateAnalystEvidenceRequest,
  CreateAnalystSavedQueryRequest,
  CreateAuditEventRequest,
  CreateDocumentRequest,
  CreateVersionRequest,
  DirectoryUser,
  Document,
  DocumentAssignment,
  DocumentMetadataSummary,
  DocumentMetadataSummaryBucket,
  DocumentMetadataSummaryOptions,
  DocumentPublication,
  DocumentReadinessIssue,
  DocumentReadinessReport,
  DocumentReadinessReportOptions,
  DocumentVersion,
  IntelligenceScopeAuthorizationRequest,
  IntelligenceScopeAuthorizationResponse,
  ProfileSettingsBundle,
  ProfileSettingsPutRequest,
  ProfileSettingsResponse,
  RegistryApiClient,
  ReplaceDocumentAssignmentsRequest,
  RegistryWorkflowTask,
  RoleMapping,
  UpdateAnalystCaseRequest,
  UpsertRoleMappingRequest,
  WorkflowTaskListOptions,
  AssistantConversationDetail,
  AssistantConversationListResponse,
  AssistantConversationMessageAppendRequest,
  AssistantConversationPatchRequest,
  AssistantConversationShareReplaceRequest,
} from "@/lib/types";
import { canUseAdminSurface } from "@/lib/auth/authorization";
import { ApiClientError } from "@/lib/types";

import {
  cloneMock,
  mockAuditEvents,
  mockAuthorization,
  mockDocuments,
  mockVersions,
} from "./data";

export class MockRegistryClient implements RegistryApiClient {
  private readonly documents = cloneMock(mockDocuments);
  private readonly versions = cloneMock(mockVersions);
  private readonly auditEvents = cloneMock(mockAuditEvents);
  private readonly workflowTaskOverrides = new Map<
    string,
    RegistryWorkflowTask
  >();
  private readonly profileSettings = new Map<string, ProfileSettingsBundle>();
  private readonly assistantConversations = new Map<
    string,
    AssistantConversationDetail
  >();
  private readonly analystCases = new Map<string, AnalystCase>();
  private readonly roleMappings = new Map<string, RoleMapping>();

  async listDocuments(
    _context: ApiRequestContext,
    options: DocumentMetadataSummaryOptions = {},
  ): Promise<Document[]> {
    return cloneMock(
      this.documents.filter((document) =>
        documentMatchesSummaryOptions(document, options),
      ),
    );
  }

  async getDocumentMetadataSummary(
    context: ApiRequestContext,
    options: DocumentMetadataSummaryOptions = {},
  ): Promise<DocumentMetadataSummary> {
    const documents = await this.listDocuments(context, options);
    return {
      total_visible_documents: documents.length,
      total_matched_documents: documents.length,
      topics: (options.topics?.length ? options.topics : ["dokumenty"]).map(
        (topic) => ({
          topic,
          document_count: documents.length,
          valid_or_approved_count: documents.filter((document) =>
            ["approved", "valid"].includes(document.status),
          ).length,
          document_types: summarizeDocuments(
            documents,
            (document) => document.document_type ?? "ostatní",
          ),
          classifications: summarizeDocuments(
            documents,
            (document) => document.classification ?? "internal",
          ),
          statuses: summarizeDocuments(
            documents,
            (document) => document.status ?? "draft",
          ),
          owners: summarizeDocuments(
            documents,
            (document) =>
              document.owner ?? document.owner_id ?? "Bez vlastníka",
          ),
          example_documents: documents
            .slice(0, 5)
            .map((document) => document.document_id),
        }),
      ),
      by_document_type: summarizeDocuments(
        documents,
        (document) => document.document_type ?? "ostatní",
      ),
      by_classification: summarizeDocuments(
        documents,
        (document) => document.classification ?? "internal",
      ),
      by_status: summarizeDocuments(
        documents,
        (document) => document.status ?? "draft",
      ),
      by_owner: summarizeDocuments(
        documents,
        (document) => document.owner ?? document.owner_id ?? "Bez vlastníka",
      ),
      warnings: ["REGISTRY_METADATA_SUMMARY"],
    };
  }

  async getDocumentReadinessReport(
    context: ApiRequestContext,
    options: DocumentReadinessReportOptions = {},
  ): Promise<DocumentReadinessReport> {
    const documents = await this.listDocuments(context, options);
    const issues = documents.flatMap((document) =>
      mockReadinessIssues(document),
    );
    const issueDocumentIds = new Set(issues.map((issue) => issue.document_id));
    const blockedDocumentIds = new Set(
      issues
        .filter((issue) => issue.severity === "critical")
        .map((issue) => issue.document_id),
    );
    const reviewDocumentIds = new Set(
      issues
        .filter((issue) => issue.severity === "warning")
        .map((issue) => issue.document_id),
    );
    const blockedDocuments = blockedDocumentIds.size;
    const reviewDocuments = [...issueDocumentIds].filter(
      (documentId) => !blockedDocumentIds.has(documentId) && reviewDocumentIds.has(documentId),
    ).length;
    const readyDocuments = Math.max(
      documents.length - blockedDocuments - reviewDocuments,
      0,
    );
    const maxIssues = options.maxIssues ?? 50;

    return {
      generated_at: new Date().toISOString(),
      total_visible_documents: documents.length,
      ready_documents: readyDocuments,
      review_documents: reviewDocuments,
      blocked_documents: blockedDocuments,
      readiness_score:
        documents.length > 0 ? Number((readyDocuments / documents.length).toFixed(4)) : 1,
      issue_counts: summarizeValues(issues.map((issue) => issue.code)),
      by_severity: summarizeValues(issues.map((issue) => issue.severity)),
      by_document_type: summarizeDocuments(
        documents,
        (document) => document.document_type ?? "other",
      ),
      by_classification: summarizeDocuments(
        documents,
        (document) => document.classification ?? "internal",
      ),
      by_status: summarizeDocuments(
        documents,
        (document) => document.status ?? "draft",
      ),
      issues: issues.slice(0, maxIssues),
      warnings: ["REGISTRY_DOCUMENT_READINESS_REPORT"],
    };
  }

  async getDocument(
    documentId: string,
    _context: ApiRequestContext,
  ): Promise<Document> {
    const document = this.documents.find(
      (candidate) => candidate.document_id === documentId,
    );
    if (!document) {
      throw new ApiClientError(
        "Document not found",
        404,
        "DOCUMENT_NOT_FOUND",
        "mock-trace",
      );
    }
    return cloneMock(document);
  }

  async createDocument(
    request: CreateDocumentRequest,
    _context: ApiRequestContext,
  ): Promise<Document> {
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
      metadata,
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
        updated_at: now,
      })),
    };
    this.documents.unshift(document);
    return cloneMock(document);
  }

  async listDocumentAssignments(
    documentId: string,
    _context: ApiRequestContext,
  ): Promise<DocumentAssignment[]> {
    return cloneMock(this.requireDocument(documentId).assignments ?? []);
  }

  async replaceDocumentAssignments(
    documentId: string,
    request: ReplaceDocumentAssignmentsRequest,
    context: ApiRequestContext,
  ): Promise<DocumentAssignment[]> {
    if (request.assignments.length === 0) {
      throw new ApiClientError(
        "At least one document assignment is required",
        422,
        "VALIDATION_ERROR",
        "mock-trace",
      );
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
      updated_at: now,
    }));
    const owner = document.assignments.find(
      (assignment) => assignment.role === "owner" && assignment.active,
    );
    const gestor = document.assignments.find(
      (assignment) => assignment.role === "gestor" && assignment.active,
    );
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

  async listDocumentVersions(
    documentId: string,
    _context: ApiRequestContext,
  ): Promise<DocumentVersion[]> {
    return cloneMock(
      this.versions.filter((version) => version.document_id === documentId),
    );
  }

  async getDocumentPublication(
    _documentId: string,
    _versionId: string,
    _context: ApiRequestContext,
  ): Promise<DocumentPublication> {
    throw new ApiClientError(
      "Document publication not found",
      404,
      "DOCUMENT_PUBLICATION_NOT_FOUND",
      "mock-trace",
    );
  }

  async createDocumentVersion(
    documentId: string,
    request: CreateVersionRequest,
    _context: ApiRequestContext,
  ): Promise<DocumentVersion> {
    const now = new Date().toISOString();
    const version: DocumentVersion = {
      document_version_id: `ver_${documentId.replace("doc_", "")}_${this.versions.length + 1}`,
      document_id: documentId,
      status: "draft",
      file_hash: "sha256:mock-pending",
      created_at: now,
      published_at: null,
      ...request,
    };
    this.versions.unshift(version);
    return cloneMock(version);
  }

  async publishDocumentVersion(
    documentId: string,
    versionId: string,
    _context: ApiRequestContext,
  ): Promise<DocumentVersion> {
    const document = this.documents.find(
      (candidate) => candidate.document_id === documentId,
    );
    if (!document) {
      throw new ApiClientError(
        "Document not found",
        404,
        "DOCUMENT_NOT_FOUND",
        "mock-trace",
      );
    }
    if (document.status !== "approved") {
      throw new ApiClientError(
        "Document must be approved before publishing",
        409,
        "PUBLISH_REQUIRES_APPROVAL",
        "mock-trace",
      );
    }
    const version = this.versions.find(
      (candidate) =>
        candidate.document_id === documentId &&
        candidate.document_version_id === versionId,
    );
    if (!version) {
      throw new ApiClientError(
        "Document version not found",
        404,
        "VERSION_NOT_FOUND",
        "mock-trace",
      );
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
    _context: ApiRequestContext,
  ): Promise<DocumentVersion> {
    const document = this.documents.find(
      (candidate) => candidate.document_id === documentId,
    );
    if (!document) {
      throw new ApiClientError(
        "Document not found",
        404,
        "DOCUMENT_NOT_FOUND",
        "mock-trace",
      );
    }
    const version = this.versions.find(
      (candidate) =>
        candidate.document_id === documentId &&
        candidate.document_version_id === versionId,
    );
    if (!version) {
      throw new ApiClientError(
        "Document version not found",
        404,
        "VERSION_NOT_FOUND",
        "mock-trace",
      );
    }
    version.status = "archived";
    if (
      !this.versions.some(
        (candidate) =>
          candidate.document_id === documentId && candidate.status === "valid",
      )
    ) {
      document.status = "archived";
    }
    return cloneMock(version);
  }

  async getAuthorizationHints(
    context: ApiRequestContext,
  ): Promise<AuthorizationHint> {
    return cloneMock({
      ...mockAuthorization,
      can_manage_admin: canUseAdminSurface(context),
      can_publish: mockAuthorization.can_publish || canUseAdminSurface(context),
    });
  }

  async authorizeDocument(
    documentId: string,
    _action: string,
    _context: ApiRequestContext,
  ) {
    const document = this.documents.find(
      (candidate) => candidate.document_id === documentId,
    );
    return {
      allowed: Boolean(document),
      reason: document ? "Mock document is visible" : "Mock document was not found",
      reason_codes: document ? ["MOCK_ALLOW"] : ["DOCUMENT_NOT_FOUND"],
      constraints: document
        ? {
            policy_binding_id: document.policy_binding_id,
            policy_hash: document.policy_hash,
            obligations: Array.isArray(document.policy_summary?.obligations)
              ? document.policy_summary.obligations
              : [],
          }
        : {},
    };
  }

  async createIngestionAuthorization(
    documentId: string,
    versionId: string,
    request: {
      action: "document.ingest" | "document.read" | "document.reindex";
      correlation_id: string;
      idempotency_key: string;
    },
    context: ApiRequestContext,
  ) {
    const document = this.documents.find(
      (candidate) => candidate.document_id === documentId,
    );
    const version = this.versions.find(
      (candidate) =>
        candidate.document_id === documentId &&
        candidate.document_version_id === versionId,
    );
    if (!document || !version) {
      throw new ApiClientError(
        "Document version not found",
        404,
        "VERSION_NOT_FOUND",
        context.correlationId ?? context.requestId ?? "mock-correlation",
      );
    }
    return {
      authorization_token: `mock-registry-ingestion-authorization-${documentId}-${versionId}`,
      authorization_id: `iauth_mock_${versionId}`,
      confirmed_subject_id: context.subjectId,
      action: request.action,
      document_id: documentId,
      document_version_id: versionId,
      correlation_id: request.correlation_id,
      idempotency_key: request.idempotency_key,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
  }

  async getDocumentIngestionAttempt(
    documentId: string,
    context: ApiRequestContext,
  ): Promise<null> {
    if (!this.documents.some((candidate) => candidate.document_id === documentId)) {
      throw new ApiClientError(
        "Document not found",
        404,
        "DOCUMENT_NOT_FOUND",
        context.correlationId ?? context.requestId ?? "mock-correlation",
      );
    }
    return null;
  }

  async createIntelligenceScopeAuthorization(
    request: IntelligenceScopeAuthorizationRequest,
    context: ApiRequestContext,
  ): Promise<IntelligenceScopeAuthorizationResponse> {
    const requestedIds = [...new Set(request.document_ids)].sort();
    const documents = requestedIds.map((documentId) => {
      const document = this.documents.find(
        (candidate) => candidate.document_id === documentId,
      );
      const version = this.versions.find(
        (candidate) =>
          candidate.document_id === documentId &&
          ["approved", "valid"].includes(candidate.status),
      ) ?? this.versions.find((candidate) => candidate.document_id === documentId);
      if (!document || !version) {
        throw new ApiClientError(
          "Document version not found",
          404,
          "VERSION_NOT_FOUND",
          context.correlationId ?? context.requestId ?? "mock-correlation",
        );
      }
      return {
        document_id: documentId,
        document_version_id: version.document_version_id,
        policy_hash:
          version.policy_hash ??
          document.policy_hash ??
          `sha256:${"0".repeat(64)}`,
      };
    });
    return {
      authorization_token: "mock-registry-intelligence-authorization-proof-token-v1",
      authorization_id: "iscope_mock_authorization",
      confirmed_subject_id: context.subjectId,
      action: "intelligence.query",
      document_scope_hash: `sha256:${createHash("sha256")
        .update(JSON.stringify(documents))
        .digest("hex")}`,
      document_count: documents.length,
      documents,
      correlation_id: request.correlation_id,
      idempotency_key: request.idempotency_key,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
  }

  async listWorkflowTasks(
    _context: ApiRequestContext,
    options: WorkflowTaskListOptions = {},
  ): Promise<RegistryWorkflowTask[]> {
    const now = new Date().toISOString();
    const generatedTasks: RegistryWorkflowTask[] = [];
    for (const document of this.documents) {
      const draftAssignment = assignmentFor(document, ["owner", "gestor"]);
      const reviewAssignment = assignmentFor(document, [
        "reviewer",
        "approver",
        "gestor",
        "owner",
      ]);
      const governanceAssignment = assignmentFor(document, [
        "auditor",
        "gestor",
        "owner",
      ]);
      if (document.status === "review") {
        generatedTasks.push({
          task_id: `task_review_${document.document_id}`,
          source_key: `document-review:${document.document_id}`,
          kind: "review",
          priority:
            document.classification === "restricted" ||
            document.classification === "confidential"
              ? "high"
              : "medium",
          status: "open",
          title: "Document review required",
          description:
            "Review metadata, source context, access classification and publication readiness.",
          source: "Registry document status",
          owner_id: reviewAssignment?.subject_id ?? document.owner_id,
          owner_label:
            assignmentLabel(reviewAssignment) ??
            document.gestor_unit ??
            document.owner,
          role: assignmentRoleLabel(reviewAssignment) ?? "Owner / gestor",
          document_id: document.document_id,
          document_title: document.title,
          document_version_id: null,
          audit_event_id: null,
          job_id: null,
          due_at: document.updated_at,
          resolved_at: null,
          metadata: {
            derived: true,
            ...assignmentTaskMetadata(reviewAssignment),
          },
          created_at: document.updated_at,
          updated_at: now,
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
          description:
            "Complete source file, validity metadata and ingestion preparation before review.",
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
          metadata: {
            derived: true,
            ...assignmentTaskMetadata(draftAssignment),
          },
          created_at: document.updated_at,
          updated_at: now,
        });
      }
      if (
        (document.classification === "restricted" ||
          document.classification === "confidential") &&
        document.status !== "valid"
      ) {
        generatedTasks.push({
          task_id: `task_governance_${document.document_id}`,
          source_key: `document-governance:${document.document_id}`,
          kind: "governance",
          priority:
            document.classification === "confidential" ? "critical" : "high",
          status: "open",
          title: "Governance check before publication",
          description:
            "Restricted sources require access, conflict and compliance checks before publication.",
          source: "Document classification policy",
          owner_id: governanceAssignment?.subject_id ?? document.owner_id,
          owner_label:
            assignmentLabel(governanceAssignment) ??
            document.gestor_unit ??
            document.owner,
          role:
            assignmentRoleLabel(governanceAssignment) ?? "Governance / auditor",
          document_id: document.document_id,
          document_title: document.title,
          document_version_id: null,
          audit_event_id: null,
          job_id: null,
          due_at: document.updated_at,
          resolved_at: null,
          metadata: {
            derived: true,
            ...assignmentTaskMetadata(governanceAssignment),
          },
          created_at: document.updated_at,
          updated_at: now,
        });
      }
    }
    const tasks = generatedTasks.map(
      (task) => this.workflowTaskOverrides.get(task.task_id) ?? task,
    );
    return cloneMock(
      tasks.filter((task) => workflowTaskMatchesOptions(task, options)),
    );
  }

  async applyWorkflowTaskAction(
    taskId: string,
    request: ApplyWorkflowTaskActionRequest,
    context: ApiRequestContext,
  ): Promise<RegistryWorkflowTask> {
    const task = (
      await this.listWorkflowTasks(context, { includeResolved: true })
    ).find((candidate) => candidate.task_id === taskId);
    if (!task) {
      throw new ApiClientError(
        "Workflow task not found",
        404,
        "WORKFLOW_TASK_NOT_FOUND",
        "mock-trace",
      );
    }

    const now = new Date().toISOString();
    const resolvesTask = ["approve", "publish", "archive", "resolve"].includes(
      request.action,
    );
    const document = task.document_id
      ? this.documents.find(
          (candidate) => candidate.document_id === task.document_id,
        )
      : undefined;
    const latestVersion = task.document_id
      ? this.versions
          .filter((candidate) => candidate.document_id === task.document_id)
          .sort((left, right) =>
            right.created_at.localeCompare(left.created_at),
          )[0]
      : undefined;

    if (request.action === "approve" && document && task.kind === "review") {
      document.status = "approved";
      if (latestVersion && ["draft", "review"].includes(latestVersion.status)) {
        latestVersion.status = "approved";
      }
    }
    if (
      request.action === "request_changes" &&
      document &&
      ["review", "approved"].includes(document.status)
    ) {
      document.status = "draft";
      if (latestVersion?.status === "approved") {
        latestVersion.status = "draft";
      }
    }
    if (request.action === "publish" && document && latestVersion) {
      if (document.status !== "approved") {
        throw new ApiClientError(
          "Document must be approved before publishing",
          409,
          "PUBLISH_REQUIRES_APPROVAL",
          "mock-trace",
        );
      }
      for (const activeVersion of this.versions) {
        if (
          activeVersion.document_id === document.document_id &&
          activeVersion.document_version_id !==
            latestVersion.document_version_id &&
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
        this.versions.find(
          (candidate) =>
            candidate.document_id === document.document_id &&
            candidate.status === "valid",
        ) ?? latestVersion;
      if (version) {
        version.status = "archived";
      }
      if (
        !this.versions.some(
          (candidate) =>
            candidate.document_id === document.document_id &&
            candidate.status === "valid",
        )
      ) {
        document.status = "archived";
      }
    }

    const nextTask: RegistryWorkflowTask = {
      ...task,
      status: resolvesTask ? "resolved" : "open",
      owner_id: request.assignee_id ?? task.owner_id,
      owner_label: request.assignee_id ?? task.owner_label,
      resolved_at: resolvesTask
        ? now
        : request.action === "request_changes"
          ? null
          : task.resolved_at,
      metadata: {
        ...task.metadata,
        last_action: request.action,
        last_actor_id: context.subjectId,
        last_comment: request.comment ?? null,
        last_action_at: now,
        decision_metadata: request.metadata ?? {},
      },
      updated_at: now,
    };
    this.workflowTaskOverrides.set(taskId, cloneMock(nextTask));
    return cloneMock(nextTask);
  }

  async listAnalystCases(
    context: ApiRequestContext,
    includeArchived = false,
  ): Promise<AnalystCase[]> {
    return cloneMock(
      [...this.analystCases.values()]
        .filter((candidate) => candidate.owner_id === context.subjectId || context.roles?.includes("admin"))
        .filter((candidate) => includeArchived || candidate.status !== "archived")
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at)),
    );
  }

  async createAnalystCase(
    request: CreateAnalystCaseRequest,
    context: ApiRequestContext,
  ): Promise<AnalystCase> {
    const now = new Date().toISOString();
    const analystCase: AnalystCase = {
      case_id: `case_mock_${this.analystCases.size + 1}`,
      title: request.title,
      description: request.description ?? null,
      status: "open",
      owner_id: context.subjectId,
      classification: request.classification ?? "internal",
      tags: [...new Set(request.tags ?? [])],
      metadata: request.metadata ?? {},
      saved_queries: [],
      evidence_items: [],
      created_at: now,
      updated_at: now,
    };
    this.analystCases.set(analystCase.case_id, analystCase);
    return cloneMock(analystCase);
  }

  async getAnalystCase(caseId: string, context: ApiRequestContext): Promise<AnalystCase> {
    return cloneMock(this.requireAnalystCase(caseId, context));
  }

  async updateAnalystCase(
    caseId: string,
    request: UpdateAnalystCaseRequest,
    context: ApiRequestContext,
  ): Promise<AnalystCase> {
    const analystCase = this.requireAnalystCase(caseId, context);
    analystCase.title = request.title ?? analystCase.title;
    if (request.description !== undefined) analystCase.description = request.description;
    analystCase.status = request.status ?? analystCase.status;
    analystCase.classification = request.classification ?? analystCase.classification;
    analystCase.tags = request.tags ? [...new Set(request.tags)] : analystCase.tags;
    analystCase.metadata = request.metadata ?? analystCase.metadata;
    analystCase.updated_at = new Date().toISOString();
    return cloneMock(analystCase);
  }

  async createAnalystSavedQuery(
    caseId: string,
    request: CreateAnalystSavedQueryRequest,
    context: ApiRequestContext,
  ): Promise<AnalystCase["saved_queries"][number]> {
    const analystCase = this.requireAnalystCase(caseId, context);
    const savedQuery: AnalystCase["saved_queries"][number] = {
      saved_query_id: `qry_mock_${analystCase.saved_queries.length + 1}`,
      case_id: caseId,
      title: request.title,
      query_text: request.query_text,
      query_mode: request.query_mode,
      search_fields: request.search_fields,
      filters: request.filters ?? {},
      created_by: context.subjectId,
      created_at: new Date().toISOString(),
    };
    analystCase.saved_queries.push(savedQuery);
    analystCase.updated_at = savedQuery.created_at;
    return cloneMock(savedQuery);
  }

  async createAnalystEvidence(
    caseId: string,
    request: CreateAnalystEvidenceRequest,
    context: ApiRequestContext,
  ): Promise<AnalystCase["evidence_items"][number]> {
    const analystCase = this.requireAnalystCase(caseId, context);
    const evidence: AnalystCase["evidence_items"][number] = {
      evidence_id: `evd_mock_${analystCase.evidence_items.length + 1}`,
      case_id: caseId,
      title: request.title,
      note: request.note ?? null,
      document_id: request.document_id ?? null,
      document_version_id: request.document_version_id ?? null,
      document_title: request.document_title ?? null,
      chunk_id: request.chunk_id ?? null,
      page_number: request.page_number ?? null,
      section_title: request.section_title ?? null,
      source_file_name: request.source_file_name ?? null,
      score: request.score ?? null,
      snippet: request.snippet ?? null,
      entity_types: request.entity_types ?? [],
      entity_values: request.entity_values ?? [],
      metadata: request.metadata ?? {},
      created_by: context.subjectId,
      created_at: new Date().toISOString(),
    };
    analystCase.evidence_items.push(evidence);
    analystCase.updated_at = evidence.created_at;
    return cloneMock(evidence);
  }

  async listAuditEvents(
    _context: ApiRequestContext,
    options: AuditEventListOptions = {},
  ): Promise<AuditEvent[]> {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    const events = this.auditEvents.filter((event) =>
      auditEventMatchesOptions(event, options),
    );
    return cloneMock(events.slice(offset, offset + limit));
  }

  async createAuditEvent(
    request: CreateAuditEventRequest,
    context: ApiRequestContext,
  ): Promise<AuditEvent> {
    const event: AuditEvent = {
      audit_event_id: `audit_${this.auditEvents.length + 600}`,
      correlation_id:
        context.correlationId ?? context.requestId ?? "mock-correlation",
      created_at: new Date().toISOString(),
      ...request,
    };
    this.auditEvents.unshift(event);
    return cloneMock(event);
  }

  async searchDirectoryUsers(
    _query: string,
    _context: ApiRequestContext,
    _limit = 20,
  ): Promise<DirectoryUser[]> {
    return [
      {
        subject_id: "mock-user-1",
        display_name: "Jan Novák",
        email: "jan.novak@example.cz",
        groups: ["staff"],
      },
      {
        subject_id: "mock-user-2",
        display_name: "Eva Horáková",
        email: "eva.horakova@example.cz",
        groups: ["staff", "admins"],
      },
    ];
  }

  async listRoleMappings(
    _context: ApiRequestContext,
    includeRemoved = false,
  ): Promise<RoleMapping[]> {
    return cloneMock(
      [...this.roleMappings.values()]
        .filter((member) => includeRemoved || member.status !== "removed")
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at)),
    );
  }

  async importDirectoryUser(
    subjectId: string,
    _context: ApiRequestContext,
  ): Promise<DirectoryUser> {
    return {
      subject_id: subjectId,
      display_name: null,
      email: null,
      groups: [],
    };
  }

  async upsertRoleMapping(
    request: UpsertRoleMappingRequest,
    _context: ApiRequestContext,
  ): Promise<RoleMapping> {
    const now = new Date().toISOString();
    const existing = [...this.roleMappings.values()].find((member) => (
      member.subject_type === request.subject_type &&
      member.subject_id === request.subject_id &&
      member.role === request.role
    ));
    const member: RoleMapping = {
      role_mapping_id: existing?.role_mapping_id ?? `rm_mock_${Date.now()}`,
      ...request,
      display_name: existing?.display_name ?? mockDirectoryDisplayName(request.subject_id),
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    this.roleMappings.set(member.role_mapping_id, member);
    return cloneMock(member);
  }

  async updateRoleMappingStatus(
    roleMappingId: string,
    status: string,
    _context: ApiRequestContext,
  ): Promise<RoleMapping> {
    const existing = this.roleMappings.get(roleMappingId);
    if (!existing) {
      throw new ApiClientError(
        "Role mapping not found",
        404,
        "ROLE_MAPPING_NOT_FOUND",
        "mock-trace",
      );
    }
    const now = new Date().toISOString();
    const member = {
      ...existing,
      status,
      updated_at: now,
    };
    this.roleMappings.set(roleMappingId, member);
    return cloneMock(member);
  }

  async getProfileSettings(
    context: ApiRequestContext,
  ): Promise<ProfileSettingsResponse> {
    return {
      subject_id: context.subjectId,
      settings: cloneMock(
        this.profileSettings.get(context.subjectId) ??
          defaultProfileSettings(context),
      ),
      roles: context.roles ?? [],
      groups: context.groups ?? [],
    };
  }

  async putProfileSettings(
    request: ProfileSettingsPutRequest,
    context: ApiRequestContext,
  ): Promise<ProfileSettingsResponse> {
    const settings: ProfileSettingsBundle = {
      core: { ...(request.settings.core ?? {}) },
      apps: cloneMock(request.settings.apps ?? {}),
    };
    this.profileSettings.set(context.subjectId, settings);
    return {
      subject_id: context.subjectId,
      settings: cloneMock(settings),
      roles: context.roles ?? [],
      groups: context.groups ?? [],
    };
  }

  async listAssistantConversations(
    context: ApiRequestContext,
    includeArchived = false,
  ): Promise<AssistantConversationListResponse> {
    const items = [...this.assistantConversations.values()]
      .filter((conversation) => conversation.user_id === context.subjectId)
      .filter(
        (conversation) => includeArchived || conversation.status !== "archived",
      )
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
        message_count: conversation.messages.length,
      }));
    return { items: cloneMock(items), limit: 50, offset: 0 };
  }

  async getAssistantConversation(
    conversationId: string,
    context: ApiRequestContext,
  ): Promise<AssistantConversationDetail> {
    return cloneMock(
      this.requireAssistantConversation(conversationId, context),
    );
  }

  async appendAssistantConversationMessages(
    conversationId: string,
    request: AssistantConversationMessageAppendRequest,
    context: ApiRequestContext,
  ): Promise<AssistantConversationDetail> {
    const now = new Date().toISOString();
    const existing = this.assistantConversations.get(conversationId);
    const conversation: AssistantConversationDetail = existing ?? {
      conversation_id: conversationId,
      user_id: context.subjectId,
      status: "active",
      title: request.title ?? null,
      visibility: request.visibility ?? "private",
      retention_until: request.retention_until ?? null,
      archived_at: null,
      created_at: now,
      updated_at: now,
      shared_with: [],
      messages: [],
    };
    conversation.messages.push(
      ...request.messages.map((message, index) => ({
        message_id: `mock_msg_${Date.now()}_${index}`,
        role: message.role,
        content: message.content,
        response_type: message.response_type ?? null,
        citations: message.citations ?? [],
        metadata: message.metadata ?? {},
        created_at: now,
      })),
    );
    conversation.title = request.title ?? conversation.title;
    conversation.visibility = request.visibility ?? conversation.visibility;
    conversation.retention_until =
      request.retention_until ?? conversation.retention_until;
    conversation.updated_at = now;
    this.assistantConversations.set(conversationId, cloneMock(conversation));
    return cloneMock(conversation);
  }

  async updateAssistantConversation(
    conversationId: string,
    request: AssistantConversationPatchRequest,
    context: ApiRequestContext,
  ): Promise<AssistantConversationDetail> {
    const conversation = this.requireAssistantConversation(
      conversationId,
      context,
    );
    const now = new Date().toISOString();
    conversation.title = request.title ?? conversation.title;
    conversation.status = request.status ?? conversation.status;
    conversation.visibility = request.visibility ?? conversation.visibility;
    conversation.retention_until =
      request.retention_until ?? conversation.retention_until;
    conversation.archived_at =
      request.status === "archived"
        ? now
        : request.status === "active"
          ? null
          : conversation.archived_at;
    conversation.updated_at = now;
    this.assistantConversations.set(conversationId, cloneMock(conversation));
    return cloneMock(conversation);
  }

  async replaceAssistantConversationShares(
    conversationId: string,
    request: AssistantConversationShareReplaceRequest,
    context: ApiRequestContext,
  ): Promise<AssistantConversationDetail> {
    const conversation = this.requireAssistantConversation(
      conversationId,
      context,
    );
    const now = new Date().toISOString();
    conversation.visibility =
      request.visibility ?? (request.shares.length > 0 ? "shared" : "private");
    conversation.shared_with = request.shares.map((share, index) => ({
      conversation_share_id: `mock_share_${conversationId}_${index + 1}`,
      subject_type: share.subject_type,
      subject_id: share.subject_id,
      permission: share.permission,
      status: "active",
      created_by: context.subjectId,
      created_at: now,
      updated_at: now,
    }));
    conversation.updated_at = now;
    this.assistantConversations.set(conversationId, cloneMock(conversation));
    return cloneMock(conversation);
  }

  private requireDocument(documentId: string): Document {
    const document = this.documents.find(
      (candidate) => candidate.document_id === documentId,
    );
    if (!document) {
      throw new ApiClientError(
        "Document not found",
        404,
        "DOCUMENT_NOT_FOUND",
        "mock-trace",
      );
    }
    return document;
  }

  private requireAnalystCase(caseId: string, context: ApiRequestContext): AnalystCase {
    const analystCase = this.analystCases.get(caseId);
    if (!analystCase || (analystCase.owner_id !== context.subjectId && !context.roles?.includes("admin"))) {
      throw new ApiClientError(
        "Analyst case not found",
        404,
        "ANALYST_CASE_NOT_FOUND",
        "mock-trace",
      );
    }
    return analystCase;
  }

  private requireAssistantConversation(
    conversationId: string,
    context: ApiRequestContext,
  ): AssistantConversationDetail {
    const conversation = this.assistantConversations.get(conversationId);
    if (!conversation || conversation.user_id !== context.subjectId) {
      throw new ApiClientError(
        "Assistant conversation not found",
        404,
        "CONVERSATION_NOT_FOUND",
        "mock-trace",
      );
    }
    return cloneMock(conversation);
  }
}

function defaultProfileSettings(
  _context: ApiRequestContext,
): ProfileSettingsBundle {
  return {
    core: {},
    apps: {
      akb: {},
    },
  };
}

function documentMatchesSummaryOptions(
  document: Document,
  options: DocumentMetadataSummaryOptions,
): boolean {
  const external = externalMetadata(document);
  if (options.status && document.status !== options.status) {
    return false;
  }
  if (
    options.classification &&
    document.classification !== options.classification
  ) {
    return false;
  }
  if (options.documentType && document.document_type !== options.documentType) {
    return false;
  }
  if (options.ownerId && document.owner_id !== options.ownerId) {
    return false;
  }
  if (options.tenantId && external.tenant_id !== options.tenantId) {
    return false;
  }
  if (
    options.externalSystem &&
    external.external_system !== options.externalSystem
  ) {
    return false;
  }
  if (options.entityType && external.entity_type !== options.entityType) {
    return false;
  }
  if (options.entityId && external.entity_id !== options.entityId) {
    return false;
  }
  if (options.externalRef && external.external_ref !== options.externalRef) {
    return false;
  }
  if (options.tag && !(document.tags ?? []).includes(options.tag)) {
    return false;
  }
  if (
    options.contextTags?.length &&
    !options.contextTags.every((tag) => (document.tags ?? []).includes(tag))
  ) {
    return false;
  }
  return true;
}

function externalMetadata(document: Document): Record<string, unknown> {
  const metadata = document.metadata ?? {};
  const stratos = metadata.stratos;
  if (stratos && typeof stratos === "object" && !Array.isArray(stratos)) {
    return stratos as Record<string, unknown>;
  }
  const external = metadata.external;
  if (external && typeof external === "object" && !Array.isArray(external)) {
    return external as Record<string, unknown>;
  }
  return {};
}

function summarizeDocuments(
  documents: Document[],
  keyForDocument: (document: Document) => string,
): DocumentMetadataSummaryBucket[] {
  return summarizeValues(documents.map(keyForDocument));
}

function summarizeValues(values: string[]): DocumentMetadataSummaryBucket[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: key, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.label.localeCompare(right.label, "cs"),
    );
}

function mockReadinessIssues(document: Document): DocumentReadinessIssue[] {
  const issues: DocumentReadinessIssue[] = [];
  const metadata = document.metadata ?? {};
  const hasDocumentNumber = [
    metadata.document_number,
    metadata.doc_number,
    metadata.number,
    metadata.contract_number,
  ].some((value) => typeof value === "string" && value.trim().length > 0);
  if (!hasDocumentNumber) {
    issues.push({
      code: "document_number_missing",
      severity: "warning",
      document_id: document.document_id,
      title: document.title,
      recommendation: "Doplnit evidencni cislo dokumentu pred analytickym pouzitim.",
      details: { field: "metadata.document_number" },
    });
  }
  if (document.status === "draft" || document.status === "review") {
    issues.push({
      code: "valid_version_missing",
      severity: "warning",
      document_id: document.document_id,
      title: document.title,
      recommendation: "Publikovat nebo potvrdit platnou verzi pred ostrym pouzitim.",
      details: { status: document.status },
    });
  }
  if (document.classification === "public") {
    issues.push({
      code: "classification_public_review",
      severity: "info",
      document_id: document.document_id,
      title: document.title,
      recommendation: "Overit, ze verejna klasifikace odpovida obsahu dokumentu.",
      details: { classification: document.classification },
    });
  }
  return issues;
}

function workflowTaskMatchesOptions(
  task: RegistryWorkflowTask,
  options: WorkflowTaskListOptions,
): boolean {
  if (
    !options.includeResolved &&
    !["open", "waiting", "blocked"].includes(task.status)
  ) {
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

function auditEventMatchesOptions(
  event: AuditEvent,
  options: AuditEventListOptions,
): boolean {
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

function mockDirectoryDisplayName(subjectId: string): string | null {
  if (subjectId === "mock-user-1") return "Jan Novák";
  if (subjectId === "mock-user-2") return "Eva Horáková";
  return null;
}

function assignmentFor(
  document: Document,
  roles: DocumentAssignment["role"][],
): DocumentAssignment | undefined {
  const assignments = document.assignments ?? [];
  return roles
    .flatMap((role) =>
      assignments
        .filter((assignment) => assignment.active && assignment.role === role)
        .sort(
          (left, right) => Number(right.is_primary) - Number(left.is_primary),
        ),
    )
    .at(0);
}

function assignmentLabel(
  assignment: DocumentAssignment | undefined,
): string | undefined {
  if (!assignment) {
    return undefined;
  }
  return assignment.display_label ?? assignment.subject_id;
}

function assignmentRoleLabel(
  assignment: DocumentAssignment | undefined,
): string | undefined {
  if (!assignment) {
    return undefined;
  }
  return assignment.role.replaceAll("_", " ");
}

function assignmentTaskMetadata(
  assignment: DocumentAssignment | undefined,
): Record<string, unknown> {
  if (!assignment) {
    return {};
  }
  return {
    assignment_id: assignment.assignment_id,
    assignment_role: assignment.role,
    sla_days: assignment.sla_days,
    escalation_subject_id: assignment.escalation_subject_id,
    escalated: false,
  };
}
