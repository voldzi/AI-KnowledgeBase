"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  ClipboardList,
  FileCheck2,
  FilterX,
  Search,
  TimerOff
} from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import type {
  ApplyWorkflowTaskActionRequest,
  AuditEvent,
  AuthorizationHint,
  Document,
  IngestionJob,
  RegistryWorkflowTask,
  RegistryWorkflowTaskAction
} from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import {
  buildWorkflowTasks,
  isTaskOverdue,
  type WorkflowTask,
  type WorkflowTaskKind,
  type WorkflowTaskPriority,
  type WorkflowTaskStatus
} from "./workflow-task-model";

interface WorkflowInboxProps {
  documents: Document[];
  jobs: IngestionJob[];
  auditEvents: AuditEvent[];
  registryTasks?: RegistryWorkflowTask[];
  authorization: AuthorizationHint;
  nowIso: string;
}

type FilterValue<T extends string> = "all" | T;

const taskCopy = {
  cs: {
    metricsLabel: "Metriky pracovního inboxu",
    openTasks: "Úkoly celkem",
    openTasksDetail: "z Registry API a stavu zpracování",
    overdue: "Po termínu",
    overdueDetail: "vyžaduje prioritní řešení",
    blocked: "Blokující",
    blockedDetail: "znalost není připravená k použití",
    reviewQueue: "Ve schválení",
    reviewQueueDetail: "dokumenty čekající na vlastníka/gestora",
    inboxTitle: "Organizační workflow inbox",
    inboxDescription: "Fronta kombinuje autoritativní Registry API tasky s provozními ingestion signály. Registry tasky lze přiřadit, vrátit, schválit nebo uzavřít přímo z detailu.",
    searchPlaceholder: "Hledat úkol, dokument, vlastníka nebo zdrojový signál",
    priority: "Priorita",
    status: "Stav",
    kind: "Typ",
    all: "Vše",
    clear: "Vyčistit",
    resultCount: "zobrazených úkolů",
    task: "Úkol",
    owner: "Odpovědnost",
    due: "Termín",
    source: "Zdroj",
    action: "Akce",
    detailTitle: "Detail úkolu",
    detailEmpty: "Vyberte úkol ze seznamu.",
    document: "Dokument",
    version: "Verze",
    job: "Úloha",
    primaryAction: "Primární akce",
    secondaryAction: "Souvislost",
    implementationNote: "Rozhodnutí nad Registry taskem se zapisuje přes Registry API a audit log. Publikace dokumentové verze zůstává oddělený publish endpoint.",
    permissions: "Oprávnění",
    publishVisible: "Publikační akce jsou v této relaci povolené.",
    publishHidden: "Publikační akce zůstávají skryté, protože Registry API neudělilo document.version.publish.",
    noResults: "Žádné úkoly neodpovídají filtrům.",
    checklistTitle: "Kontrolní body",
    checklistSource: "Ověřit zdroj a metadata.",
    checklistOwner: "Potvrdit vlastníka a gestor unit.",
    checklistAudit: "Zapsat rozhodnutí přes akční panel nebo zdrojovou obrazovku.",
    actionPanelTitle: "Rozhodnutí k úkolu",
    actionPanelDetail: "Akce se zapisují do Registry API a audit logu.",
    decisionComment: "Komentář",
    commentPlaceholder: "Volitelný důvod nebo další instrukce",
    assignee: "Přiřadit komu",
    assigneePlaceholder: "user_id nebo tým",
    assign: "Přiřadit",
    requestChanges: "Vrátit k úpravě",
    approve: "Schválit",
    resolve: "Uzavřít",
    actionSaved: "Rozhodnutí bylo zapsané.",
    actionFailed: "Akci se nepodařilo zapsat.",
    noRegistryAction: "Tento signál je provozní stav ingestion pipeline; vyřešte ho na zdrojové obrazovce."
  },
  en: {
    metricsLabel: "Workflow inbox metrics",
    openTasks: "Total tasks",
    openTasksDetail: "from Registry API and processing state",
    overdue: "Overdue",
    overdueDetail: "requires priority handling",
    blocked: "Blocking",
    blockedDetail: "knowledge is not ready for use",
    reviewQueue: "In approval",
    reviewQueueDetail: "documents waiting for owner/gestor",
    inboxTitle: "Organizational workflow inbox",
    inboxDescription: "The queue combines authoritative Registry API tasks with operational ingestion signals. Registry tasks can be assigned, returned, approved or closed from the detail panel.",
    searchPlaceholder: "Search task, document, owner or source signal",
    priority: "Priority",
    status: "Status",
    kind: "Type",
    all: "All",
    clear: "Clear",
    resultCount: "visible tasks",
    task: "Task",
    owner: "Responsibility",
    due: "Due",
    source: "Source",
    action: "Action",
    detailTitle: "Task detail",
    detailEmpty: "Select a task from the list.",
    document: "Document",
    version: "Version",
    job: "Job",
    primaryAction: "Primary action",
    secondaryAction: "Related context",
    implementationNote: "Registry task decisions are written through Registry API and audit log. Publishing a document version remains a separate publish endpoint.",
    permissions: "Permissions",
    publishVisible: "Publication actions are allowed in this session.",
    publishHidden: "Publication actions remain hidden because Registry API did not grant document.version.publish.",
    noResults: "No tasks match the filters.",
    checklistTitle: "Checklist",
    checklistSource: "Verify source and metadata.",
    checklistOwner: "Confirm owner and gestor unit.",
    checklistAudit: "Write the decision through the action panel or the source screen.",
    actionPanelTitle: "Task decision",
    actionPanelDetail: "Actions are written to Registry API and audit log.",
    decisionComment: "Comment",
    commentPlaceholder: "Optional reason or next instruction",
    assignee: "Assign to",
    assigneePlaceholder: "user_id or team",
    assign: "Assign",
    requestChanges: "Request changes",
    approve: "Approve",
    resolve: "Resolve",
    actionSaved: "Decision was recorded.",
    actionFailed: "The action could not be recorded.",
    noRegistryAction: "This signal is an operational ingestion pipeline state; resolve it on the source screen."
  }
} satisfies Record<AklLanguage, Record<string, string>>;

const priorityLabels = {
  cs: {
    critical: "kritická",
    high: "vysoká",
    medium: "střední",
    low: "nízká"
  },
  en: {
    critical: "critical",
    high: "high",
    medium: "medium",
    low: "low"
  }
} satisfies Record<AklLanguage, Record<WorkflowTaskPriority, string>>;

const statusLabels = {
  cs: {
    open: "otevřeno",
    waiting: "čeká",
    blocked: "blokuje"
  },
  en: {
    open: "open",
    waiting: "waiting",
    blocked: "blocked"
  }
} satisfies Record<AklLanguage, Record<WorkflowTaskStatus, string>>;

const kindLabels = {
  cs: {
    review: "revize",
    draft: "koncept",
    ingestion: "zpracování",
    governance: "governance",
    audit: "audit"
  },
  en: {
    review: "review",
    draft: "draft",
    ingestion: "ingestion",
    governance: "governance",
    audit: "audit"
  }
} satisfies Record<AklLanguage, Record<WorkflowTaskKind, string>>;

export function WorkflowInbox({ documents, jobs, auditEvents, registryTasks, authorization, nowIso }: WorkflowInboxProps) {
  const { language } = useLanguage();
  const copy = taskCopy[language];
  const tasks = useMemo(
    () => buildWorkflowTasks({ documents, jobs, auditEvents, registryTasks, nowIso }),
    [documents, jobs, auditEvents, registryTasks, nowIso]
  );
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<FilterValue<WorkflowTaskPriority>>("all");
  const [status, setStatus] = useState<FilterValue<WorkflowTaskStatus>>("all");
  const [kind, setKind] = useState<FilterValue<WorkflowTaskKind>>("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(tasks[0]?.id ?? null);

  const filteredTasks = tasks.filter((task) => {
    const normalizedQuery = query.trim().toLowerCase();
    const matchesQuery =
      normalizedQuery.length === 0 ||
      [task.title, task.description, task.document_title, task.owner, task.role, task.source, task.job_id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
    return (
      matchesQuery &&
      (priority === "all" || task.priority === priority) &&
      (status === "all" || task.status === status) &&
      (kind === "all" || task.kind === kind)
    );
  });
  const selectedTask = filteredTasks.find((task) => task.id === selectedTaskId) ?? filteredTasks[0] ?? null;
  const overdueTasks = tasks.filter((task) => isTaskOverdue(task, nowIso));
  const blockedTasks = tasks.filter((task) => task.status === "blocked");
  const reviewTasks = tasks.filter((task) => task.kind === "review" || task.kind === "governance");

  function clearFilters() {
    setQuery("");
    setPriority("all");
    setStatus("all");
    setKind("all");
  }

  return (
    <div className="stack">
      <section className="grid grid--metrics" aria-label={copy.metricsLabel}>
        <MetricCard
          detail={copy.openTasksDetail}
          icon={ClipboardList}
          label={copy.openTasks}
          tone="attention"
          value={String(tasks.length)}
        />
        <MetricCard
          detail={copy.overdueDetail}
          icon={TimerOff}
          label={copy.overdue}
          tone={overdueTasks.length > 0 ? "danger" : "success"}
          value={String(overdueTasks.length)}
        />
        <MetricCard
          detail={copy.blockedDetail}
          icon={Ban}
          label={copy.blocked}
          tone={blockedTasks.length > 0 ? "danger" : "success"}
          value={String(blockedTasks.length)}
        />
        <MetricCard
          detail={copy.reviewQueueDetail}
          icon={FileCheck2}
          label={copy.reviewQueue}
          value={String(reviewTasks.length)}
        />
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>{copy.inboxTitle}</h2>
          <StatusBadge value="info" label={`${filteredTasks.length} ${copy.resultCount}`} />
        </div>
        <div className="panel__body stack">
          <p className="muted task-inbox-lead">{copy.inboxDescription}</p>
          <div className="task-toolbar">
            <label className="registry-search">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">{copy.searchPlaceholder}</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.searchPlaceholder}
                type="search"
              />
            </label>
            <TaskSelect
              label={copy.priority}
              value={priority}
              onChange={(value) => setPriority(value as FilterValue<WorkflowTaskPriority>)}
              options={(["critical", "high", "medium", "low"] as const).map((value) => ({
                value,
                label: priorityLabels[language][value]
              }))}
              allLabel={copy.all}
            />
            <TaskSelect
              label={copy.status}
              value={status}
              onChange={(value) => setStatus(value as FilterValue<WorkflowTaskStatus>)}
              options={(["open", "waiting", "blocked"] as const).map((value) => ({
                value,
                label: statusLabels[language][value]
              }))}
              allLabel={copy.all}
            />
            <TaskSelect
              label={copy.kind}
              value={kind}
              onChange={(value) => setKind(value as FilterValue<WorkflowTaskKind>)}
              options={(["review", "draft", "ingestion", "governance", "audit"] as const).map((value) => ({
                value,
                label: kindLabels[language][value]
              }))}
              allLabel={copy.all}
            />
            <button className="button" type="button" onClick={clearFilters}>
              <FilterX size={16} aria-hidden="true" />
              {copy.clear}
            </button>
          </div>
        </div>
      </section>

      <section className="task-inbox-layout">
        <div className="panel">
          <div className="panel__header">
            <h2>{copy.task}</h2>
          </div>
          <div className="task-list">
            {filteredTasks.map((task) => (
              <button
                className={`task-row ${selectedTask?.id === task.id ? "task-row--active" : ""}`}
                key={task.id}
                type="button"
                onClick={() => setSelectedTaskId(task.id)}
              >
                <span className="task-row__main">
                  <strong>{task.title}</strong>
                  <span>{task.document_title ?? task.source}</span>
                </span>
                <span className="task-row__badges">
                  <StatusBadge value={priorityTone(task.priority)} label={priorityLabels[language][task.priority]} />
                  <StatusBadge value={statusTone(task.status)} label={statusLabels[language][task.status]} />
                </span>
                <span className="task-row__meta">
                  {task.owner} · {formatDateTime(task.due_at, language)}
                </span>
              </button>
            ))}
            {filteredTasks.length === 0 ? <div className="empty-state">{copy.noResults}</div> : null}
          </div>
        </div>

        <TaskDetail task={selectedTask} copy={copy} language={language} authorization={authorization} nowIso={nowIso} />
      </section>
    </div>
  );
}

interface TaskSelectProps {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  allLabel: string;
  onChange: (value: string) => void;
}

function TaskSelect({ label, value, options, allLabel, onChange }: TaskSelectProps) {
  return (
    <label className="registry-filter">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TaskDetail({
  task,
  copy,
  language,
  authorization,
  nowIso
}: {
  task: WorkflowTask | null;
  copy: Record<string, string>;
  language: AklLanguage;
  authorization: AuthorizationHint;
  nowIso: string;
}) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [submittingAction, setSubmittingAction] = useState<RegistryWorkflowTaskAction | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  if (!task) {
    return (
      <aside className="panel task-detail">
        <div className="panel__header">
          <h2>{copy.detailTitle}</h2>
        </div>
        <div className="panel__body empty-state">{copy.detailEmpty}</div>
      </aside>
    );
  }

  const actions = actionsForTask(task);

  async function submitAction(action: RegistryWorkflowTaskAction) {
    if (!task?.registry_task_id || submittingAction) {
      return;
    }
    setSubmittingAction(action);
    setFeedback(null);
    const payload: ApplyWorkflowTaskActionRequest = {
      action,
      comment: comment.trim() || null,
      metadata: {
        source: "web.workflow_inbox",
        document_id: task.document_id,
        task_kind: task.kind
      }
    };
    if (assigneeId.trim()) {
      payload.assignee_id = assigneeId.trim();
    }

    try {
      const response = await fetch(`/api/workflow/tasks/${encodeURIComponent(task.registry_task_id)}/actions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(await readWorkflowActionError(response));
      }
      setFeedback({ tone: "success", message: copy.actionSaved });
      setComment("");
      if (action === "assign") {
        setAssigneeId("");
      }
      router.refresh();
    } catch (error) {
      const suffix = error instanceof Error && error.message ? ` ${error.message}` : "";
      setFeedback({ tone: "error", message: `${copy.actionFailed}${suffix}` });
    } finally {
      setSubmittingAction(null);
    }
  }

  return (
    <aside className="panel task-detail">
      <div className="panel__header">
        <h2>{copy.detailTitle}</h2>
        {isTaskOverdue(task, nowIso) ? <StatusBadge value="critical" label={copy.overdue} /> : null}
      </div>
      <div className="panel__body stack">
        <div className="task-detail__title">
          <span className="task-kind">{kindLabels[language][task.kind]}</span>
          <h3>{task.title}</h3>
          <p>{task.description}</p>
        </div>
        <div className="detail-kv-grid">
          <TaskField label={copy.owner} value={`${task.owner} · ${task.role}`} />
          <TaskField label={copy.due} value={formatDateTime(task.due_at, language)} />
          <TaskField label={copy.source} value={task.source} />
          <TaskField label={copy.document} value={task.document_title ?? "n/a"} />
          <TaskField label={copy.version} value={task.document_version_id ?? "n/a"} />
          <TaskField label={copy.job} value={task.job_id ?? "n/a"} />
        </div>
        <div className="task-actions">
          <Link className="button button--primary" href={task.href}>
            {task.action_label}
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
          {task.secondary_href ? (
            <Link className="button" href={task.secondary_href}>
              {copy.secondaryAction}
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          ) : null}
        </div>
        {task.registry_task_id ? (
          <div className="task-action-panel">
            <div className="task-action-panel__header">
              <div>
                <strong>{copy.actionPanelTitle}</strong>
                <span>{copy.actionPanelDetail}</span>
              </div>
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor={`workflow-comment-${task.id}`}>{copy.decisionComment}</label>
                <textarea
                  id={`workflow-comment-${task.id}`}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder={copy.commentPlaceholder}
                />
              </div>
              <div className="field">
                <label htmlFor={`workflow-assignee-${task.id}`}>{copy.assignee}</label>
                <input
                  id={`workflow-assignee-${task.id}`}
                  value={assigneeId}
                  onChange={(event) => setAssigneeId(event.target.value)}
                  placeholder={copy.assigneePlaceholder}
                  type="text"
                />
              </div>
            </div>
            <div className="task-action-buttons">
              {actions.map((action) => (
                <button
                  className={`button ${action === "approve" || action === "resolve" ? "button--primary" : ""}`}
                  disabled={Boolean(submittingAction) || (action === "assign" && assigneeId.trim().length === 0)}
                  key={action}
                  type="button"
                  onClick={() => {
                    void submitAction(action);
                  }}
                >
                  {workflowActionLabel(action, copy)}
                </button>
              ))}
            </div>
            {feedback ? (
              <div className={`notice ${feedback.tone === "error" ? "notice--danger" : ""}`} role={feedback.tone === "error" ? "alert" : "status"}>
                {feedback.message}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="muted">{copy.noRegistryAction}</p>
        )}
        <div className="notice">
          <strong>{copy.permissions}: </strong>
          {authorization.can_publish ? copy.publishVisible : copy.publishHidden}
        </div>
        <div className="task-checklist">
          <strong>{copy.checklistTitle}</strong>
          <span><CheckCircle2 size={15} aria-hidden="true" />{copy.checklistSource}</span>
          <span><CheckCircle2 size={15} aria-hidden="true" />{copy.checklistOwner}</span>
          <span><AlertTriangle size={15} aria-hidden="true" />{copy.checklistAudit}</span>
        </div>
        <p className="muted">{copy.implementationNote}</p>
      </div>
    </aside>
  );
}

function TaskField({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-kv">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function priorityTone(priority: WorkflowTaskPriority) {
  if (priority === "critical") {
    return "critical";
  }
  if (priority === "high") {
    return "warning";
  }
  if (priority === "medium") {
    return "info";
  }
  return "debug";
}

function statusTone(status: WorkflowTaskStatus) {
  if (status === "blocked") {
    return "error";
  }
  if (status === "waiting") {
    return "warning";
  }
  return "info";
}

function actionsForTask(task: WorkflowTask): RegistryWorkflowTaskAction[] {
  if (task.kind === "review" || task.kind === "governance") {
    return ["assign", "request_changes", "approve", "resolve"];
  }
  if (task.kind === "draft") {
    return ["assign", "request_changes", "resolve"];
  }
  return ["assign", "resolve"];
}

function workflowActionLabel(action: RegistryWorkflowTaskAction, copy: Record<string, string>): string {
  if (action === "assign") {
    return copy.assign;
  }
  if (action === "request_changes") {
    return copy.requestChanges;
  }
  if (action === "approve") {
    return copy.approve;
  }
  return copy.resolve;
}

async function readWorkflowActionError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return payload?.error?.message ?? `HTTP ${response.status}`;
}
