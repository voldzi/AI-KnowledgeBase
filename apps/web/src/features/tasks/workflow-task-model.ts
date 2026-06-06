import type { AuditEvent, Document, IngestionJob, RegistryWorkflowTask } from "@/lib/types";

export type WorkflowTaskKind = "review" | "draft" | "ingestion" | "governance" | "audit";
export type WorkflowTaskPriority = "critical" | "high" | "medium" | "low";
export type WorkflowTaskStatus = "open" | "waiting" | "blocked";

export interface WorkflowTask {
  id: string;
  registry_task_id: string | null;
  kind: WorkflowTaskKind;
  priority: WorkflowTaskPriority;
  status: WorkflowTaskStatus;
  title: string;
  description: string;
  source: string;
  owner: string;
  role: string;
  document_id: string | null;
  document_title: string | null;
  document_version_id: string | null;
  job_id: string | null;
  due_at: string;
  created_at: string;
  href: string;
  secondary_href: string | null;
  action_label: string;
}

const priorityRank: Record<WorkflowTaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
};

export function buildWorkflowTasks(params: {
  documents: Document[];
  jobs: IngestionJob[];
  auditEvents: AuditEvent[];
  registryTasks?: RegistryWorkflowTask[];
  nowIso?: string;
}): WorkflowTask[] {
  const { documents, jobs, auditEvents, registryTasks } = params;
  const nowIso = params.nowIso ?? new Date().toISOString();
  const documentById = new Map(documents.map((document) => [document.document_id, document]));
  const tasks: WorkflowTask[] = [];

  if (registryTasks) {
    tasks.push(...registryTasks.filter(isActiveRegistryTask).map(taskFromRegistry));
    tasks.push(...buildIngestionTasks(jobs, documentById));
    return tasks.sort((left, right) => compareTasks(left, right, nowIso));
  }

  for (const document of documents) {
    if (document.status === "review") {
      tasks.push({
        id: `review:${document.document_id}`,
        registry_task_id: null,
        kind: "review",
        priority: document.classification === "restricted" || document.classification === "confidential" ? "high" : "medium",
        status: "open",
        title: "Document review required",
        description: "Review metadata, source context, access classification and publication readiness.",
        source: "Registry document status",
        owner: document.gestor_unit ?? document.owner,
        role: "Owner / gestor",
        document_id: document.document_id,
        document_title: document.title,
        document_version_id: null,
        job_id: null,
        due_at: addDays(document.updated_at, 3),
        created_at: document.updated_at,
        href: `/documents/${document.document_id}`,
        secondary_href: "/documents",
        action_label: "Open document workbench"
      });
    }

    if (document.status === "draft") {
      tasks.push({
        id: `draft:${document.document_id}`,
        registry_task_id: null,
        kind: "draft",
        priority: "medium",
        status: "waiting",
        title: "Draft needs completion",
        description: "Complete source file, validity metadata and ingestion preparation before review.",
        source: "Registry draft state",
        owner: document.owner,
        role: "Document manager",
        document_id: document.document_id,
        document_title: document.title,
        document_version_id: null,
        job_id: null,
        due_at: addDays(document.updated_at, 5),
        created_at: document.updated_at,
        href: `/documents/${document.document_id}`,
        secondary_href: "/upload",
        action_label: "Continue draft"
      });
    }

    if ((document.classification === "restricted" || document.classification === "confidential") && document.status !== "valid") {
      tasks.push({
        id: `governance:${document.document_id}`,
        registry_task_id: null,
        kind: "governance",
        priority: document.classification === "confidential" ? "critical" : "high",
        status: "open",
        title: "Governance check before publication",
        description: "Restricted sources require access, conflict and compliance checks before publication.",
        source: "Document classification policy",
        owner: document.gestor_unit ?? document.owner,
        role: "Governance / auditor",
        document_id: document.document_id,
        document_title: document.title,
        document_version_id: null,
        job_id: null,
        due_at: addDays(document.updated_at, 2),
        created_at: document.updated_at,
        href: `/documents/${document.document_id}`,
        secondary_href: "/audit",
        action_label: "Review governance signals"
      });
    }
  }

  tasks.push(...buildIngestionTasks(jobs, documentById));

  for (const event of auditEvents) {
    if (!["warning", "error", "critical"].includes(event.severity)) {
      continue;
    }
    const documentId = typeof event.metadata.document_id === "string" ? event.metadata.document_id : null;
    const document = documentId ? documentById.get(documentId) : undefined;
    tasks.push({
      id: `audit:${event.audit_event_id}`,
      registry_task_id: null,
      kind: "audit",
      priority: event.severity === "critical" || event.severity === "error" ? "critical" : "high",
      status: event.severity === "critical" || event.severity === "error" ? "blocked" : "open",
      title: "Audit event needs review",
      description: "Review the audit signal and confirm whether a document, ingestion or access policy action is needed.",
      source: event.event_type,
      owner: document?.gestor_unit ?? document?.owner ?? "Auditor",
      role: "Auditor",
      document_id: documentId,
      document_title: document?.title ?? documentId,
      document_version_id: null,
      job_id: event.resource_type === "ingestion_job" ? event.resource_id : null,
      due_at: addDays(event.created_at, 1),
      created_at: event.created_at,
      href: "/audit",
      secondary_href: document ? `/documents/${document.document_id}` : null,
      action_label: "Open audit event"
    });
  }

  return tasks.sort((left, right) => compareTasks(left, right, nowIso));
}

export function isTaskOverdue(task: WorkflowTask, nowIso: string): boolean {
  return task.due_at < nowIso && task.status !== "waiting";
}

function compareTasks(left: WorkflowTask, right: WorkflowTask, nowIso: string): number {
  const leftOverdue = isTaskOverdue(left, nowIso);
  const rightOverdue = isTaskOverdue(right, nowIso);
  if (leftOverdue !== rightOverdue) {
    return leftOverdue ? -1 : 1;
  }
  const priorityDelta = priorityRank[left.priority] - priorityRank[right.priority];
  if (priorityDelta !== 0) {
    return priorityDelta;
  }
  return left.due_at.localeCompare(right.due_at);
}

function isActiveRegistryTask(task: RegistryWorkflowTask): boolean {
  return task.status === "open" || task.status === "waiting" || task.status === "blocked";
}

function taskFromRegistry(task: RegistryWorkflowTask): WorkflowTask {
  return {
    id: task.task_id,
    registry_task_id: task.task_id,
    kind: task.kind,
    priority: task.priority,
    status: task.status as WorkflowTaskStatus,
    title: task.title,
    description: task.description,
    source: task.source,
    owner: task.owner_label,
    role: task.role,
    document_id: task.document_id,
    document_title: task.document_title,
    document_version_id: task.document_version_id,
    job_id: task.job_id,
    due_at: task.due_at,
    created_at: task.created_at,
    href: hrefForRegistryTask(task),
    secondary_href: secondaryHrefForRegistryTask(task),
    action_label: actionLabelForKind(task.kind)
  };
}

function buildIngestionTasks(jobs: IngestionJob[], documentById: Map<string, Document>): WorkflowTask[] {
  const tasks: WorkflowTask[] = [];
  for (const job of jobs) {
    const document = documentById.get(job.document_id);
    if (job.status === "failed") {
      tasks.push({
        id: `ingestion-failed:${job.job_id}`,
        registry_task_id: null,
        kind: "ingestion",
        priority: "critical",
        status: "blocked",
        title: "Ingestion failure blocks knowledge use",
        description: "The source is not indexed and should not be treated as citation-ready knowledge.",
        source: "Ingestion Service",
        owner: document?.gestor_unit ?? document?.owner ?? "Operations",
        role: "Knowledge operations",
        document_id: job.document_id,
        document_title: document?.title ?? job.document_id,
        document_version_id: job.document_version_id,
        job_id: job.job_id,
        due_at: job.finished_at ?? job.started_at ?? job.created_at,
        created_at: job.created_at,
        href: "/ingestion",
        secondary_href: document ? `/documents/${document.document_id}` : null,
        action_label: "Inspect ingestion failure"
      });
    }

    if (job.status === "completed_with_warnings") {
      tasks.push({
        id: `ingestion-warning:${job.job_id}`,
        registry_task_id: null,
        kind: "ingestion",
        priority: "high",
        status: "open",
        title: "Ingestion completed with warnings",
        description: "Review extraction warnings before relying on generated citations and insights.",
        source: "Ingestion report",
        owner: document?.gestor_unit ?? document?.owner ?? "Operations",
        role: "Document manager",
        document_id: job.document_id,
        document_title: document?.title ?? job.document_id,
        document_version_id: job.document_version_id,
        job_id: job.job_id,
        due_at: addDays(job.finished_at ?? job.created_at, 1),
        created_at: job.created_at,
        href: "/ingestion",
        secondary_href: document ? `/documents/${document.document_id}` : null,
        action_label: "Review extraction warning"
      });
    }

    if (job.status === "queued" || job.status === "running") {
      tasks.push({
        id: `ingestion-active:${job.job_id}`,
        registry_task_id: null,
        kind: "ingestion",
        priority: "low",
        status: "waiting",
        title: "Ingestion in progress",
        description: "Monitor the pipeline until parser, chunking and indexing finish.",
        source: "Ingestion Service",
        owner: document?.gestor_unit ?? document?.owner ?? "Operations",
        role: "Knowledge operations",
        document_id: job.document_id,
        document_title: document?.title ?? job.document_id,
        document_version_id: job.document_version_id,
        job_id: job.job_id,
        due_at: addDays(job.created_at, 1),
        created_at: job.created_at,
        href: "/ingestion",
        secondary_href: document ? `/documents/${document.document_id}` : null,
        action_label: "Monitor ingestion"
      });
    }
  }
  return tasks;
}

function hrefForRegistryTask(task: RegistryWorkflowTask): string {
  if (task.kind === "audit") {
    return "/audit";
  }
  if (task.document_id) {
    return `/documents/${task.document_id}`;
  }
  return "/tasks";
}

function secondaryHrefForRegistryTask(task: RegistryWorkflowTask): string | null {
  if (task.kind === "audit" && task.document_id) {
    return `/documents/${task.document_id}`;
  }
  if (task.kind === "draft") {
    return "/upload";
  }
  if (task.kind === "governance") {
    return "/audit";
  }
  return task.document_id ? "/documents" : null;
}

function actionLabelForKind(kind: WorkflowTaskKind): string {
  if (kind === "audit") {
    return "Open audit event";
  }
  if (kind === "draft") {
    return "Continue draft";
  }
  if (kind === "governance") {
    return "Review governance signals";
  }
  if (kind === "ingestion") {
    return "Inspect ingestion";
  }
  return "Open document workbench";
}

function addDays(value: string, days: number): string {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}
