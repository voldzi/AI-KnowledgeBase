"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Ban,
  CheckCircle2,
  ClipboardList,
  FileCheck2,
  FilterX,
  TimerOff,
  RotateCcw,
  UserPlus,
} from "lucide-react";
import {
  DirectoryPersonPicker as PersonPicker,
} from "@voldzi/stratos-ui";

import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import {
  StratosButton,
  StratosButtonLink,
  StratosSearchBox,
  StratosSelect,
} from "@/components/stratos";
import { withAppBasePath } from "@/lib/app-url";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import type {
  ApplyWorkflowTaskActionRequest,
  AuditEvent,
  AuthorizationHint,
  DirectoryUser,
  Document,
  IngestionJob,
  RegistryWorkflowTask,
  RegistryWorkflowTaskAction,
} from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { directoryUsersToPeople } from "@/lib/directory-people";
import { buildReturnTarget, withDocumentReturnContext } from "@/lib/navigation/document-navigation";
import {
  buildWorkflowTasks,
  isTaskOverdue,
  type WorkflowTask,
  type WorkflowTaskKind,
  type WorkflowTaskPriority,
  type WorkflowTaskStatus,
} from "./workflow-task-model";
import { workflowTaskPresentation } from "./workflow-task-presentation";
import { documentReviewError } from "@/lib/documents/review-errors";

interface WorkflowInboxProps {
  documents: Document[];
  jobs: IngestionJob[];
  auditEvents: AuditEvent[];
  registryTasks?: RegistryWorkflowTask[];
  authorization: AuthorizationHint;
  nowIso: string;
  compact?: boolean;
  title?: string;
  serverFiltered?: boolean;
}

type FilterValue<T extends string> = "all" | T;

const taskCopy = {
  cs: {
    metricsLabel: "Metriky pracovního inboxu",
    openTasks: "Úkoly celkem",
    openTasksDetail: "k revizi, schválení nebo opravě",
    overdue: "Po termínu",
    overdueDetail: "vyžaduje prioritní řešení",
    blocked: "Blokující",
    blockedDetail: "dokument zatím není připravený k použití",
    reviewQueue: "Ve schválení",
    reviewQueueDetail: "dokumenty čekající na vlastníka/gestora",
    inboxTitle: "Organizační workflow inbox",
    inboxDescription:
      "Fronta ukazuje, co má tým udělat s dokumenty: přiřadit odpovědnost, vrátit k úpravě, schválit, uzavřít nebo vyřešit problém zpracování.",
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
    notSpecified: "Neuvedeno",
    technicalDetails: "Technické podrobnosti",
    technicalOwner: "Interní identifikátor odpovědnosti",
    technicalVersion: "Identifikátor verze",
    technicalJob: "Identifikátor zpracování",
    primaryAction: "Primární akce",
    secondaryAction: "Souvislost",
    implementationNote:
      "Rozhodnutí se zapíše do auditní stopy. Publikace verze zůstává samostatný krok v detailu dokumentu.",
    permissions: "Oprávnění",
    publishVisible: "Publikační akce jsou v této relaci povolené.",
    publishHidden: "Publikační akce nejsou pro tuto relaci dostupné.",
    noResults: "Žádné úkoly neodpovídají filtrům.",
    readOnly: "K tomuto úkolu nyní nemáte oprávnění rozhodnout.",
    submittedComment: "Poznámka při předání",
    returnedComment: "Připomínka schvalovatele",
    checklistTitle: "Kontrolní body",
    checklistSource: "Ověřit zdroj a metadata.",
    checklistOwner: "Potvrdit vlastníka a gestor unit.",
    checklistAudit:
      "Zapsat rozhodnutí přes akční panel nebo zdrojovou obrazovku.",
    actionPanelTitle: "Rozhodnutí k úkolu",
    actionPanelDetail: "Akce se zapíše do auditní stopy dokumentu.",
    decisionComment: "Komentář",
    commentPlaceholder: "Volitelný důvod nebo další instrukce",
    assignee: "Přiřadit komu",
    assigneePlaceholder: "Jméno, e-mail nebo uživatelské jméno",
    assigneeHelp:
      "Vyberte osobu z adresáře. AKB zapíše přiřazení do workflow a auditní stopy.",
    assigneeSearchMin: "Začněte psát alespoň 2 znaky.",
    assigneeSearching: "Hledám v adresáři...",
    assigneeNoResults: "Adresář nenašel odpovídající osobu.",
    assigneeSearchFailed: "Adresář osob se nepodařilo načíst.",
    assigneeSelected: "Vybraná osoba",
    assigneeClear: "Zrušit výběr osoby",
    assigneeDirectory: "Adresář osob",
    assign: "Přiřadit",
    requestChanges: "Vrátit k úpravě",
    approve: "Schválit",
    resolve: "Uzavřít",
    actionSaved: "Rozhodnutí bylo zapsané.",
    actionFailed: "Akci se nepodařilo zapsat.",
    noRegistryAction:
      "Tento signál pochází ze zpracování dokumentu; otevřete zdrojovou obrazovku a vyřešte chybu nebo varování.",
  },
  en: {
    metricsLabel: "Workflow inbox metrics",
    openTasks: "Total tasks",
    openTasksDetail: "for review, approval or repair",
    overdue: "Overdue",
    overdueDetail: "requires priority handling",
    blocked: "Blocking",
    blockedDetail: "document is not ready for use",
    reviewQueue: "In approval",
    reviewQueueDetail: "documents waiting for owner/gestor",
    inboxTitle: "Organizational workflow inbox",
    inboxDescription:
      "The queue shows what the team should do with documents: assign responsibility, request changes, approve, close or resolve processing issues.",
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
    notSpecified: "Not specified",
    technicalDetails: "Technical details",
    technicalOwner: "Internal responsibility identifier",
    technicalVersion: "Version identifier",
    technicalJob: "Processing identifier",
    primaryAction: "Primary action",
    secondaryAction: "Related context",
    implementationNote:
      "The decision is written to the audit trail. Publishing a version remains a separate step in document detail.",
    permissions: "Permissions",
    publishVisible: "Publication actions are allowed in this session.",
    publishHidden: "Publication actions are not available for this session.",
    noResults: "No tasks match the filters.",
    readOnly: "You are not currently authorized to decide this task.",
    submittedComment: "Submission note",
    returnedComment: "Reviewer comment",
    checklistTitle: "Checklist",
    checklistSource: "Verify source and metadata.",
    checklistOwner: "Confirm owner and gestor unit.",
    checklistAudit:
      "Write the decision through the action panel or the source screen.",
    actionPanelTitle: "Task decision",
    actionPanelDetail: "The action is written to the document audit trail.",
    decisionComment: "Comment",
    commentPlaceholder: "Optional reason or next instruction",
    assignee: "Assign to",
    assigneePlaceholder: "Name, email or username",
    assigneeHelp:
      "Select a person from the directory. AKB records the assignment in workflow and audit.",
    assigneeSearchMin: "Type at least 2 characters.",
    assigneeSearching: "Searching directory...",
    assigneeNoResults: "No matching person was found.",
    assigneeSearchFailed: "Person directory could not be loaded.",
    assigneeSelected: "Selected person",
    assigneeClear: "Clear selected person",
    assigneeDirectory: "Person directory",
    assign: "Assign",
    requestChanges: "Request changes",
    approve: "Approve",
    resolve: "Resolve",
    actionSaved: "Decision was recorded.",
    actionFailed: "The action could not be recorded.",
    noRegistryAction:
      "This signal comes from document processing; open the source screen and resolve the error or warning.",
  },
} satisfies Record<AklLanguage, Record<string, string>>;

const priorityLabels = {
  cs: {
    critical: "kritická",
    high: "vysoká",
    medium: "střední",
    low: "nízká",
  },
  en: {
    critical: "critical",
    high: "high",
    medium: "medium",
    low: "low",
  },
} satisfies Record<AklLanguage, Record<WorkflowTaskPriority, string>>;

const statusLabels = {
  cs: {
    open: "otevřeno",
    waiting: "čeká",
    blocked: "blokuje",
  },
  en: {
    open: "open",
    waiting: "waiting",
    blocked: "blocked",
  },
} satisfies Record<AklLanguage, Record<WorkflowTaskStatus, string>>;

const kindLabels = {
  cs: {
    review: "revize",
    draft: "koncept",
    ingestion: "zpracování",
    governance: "governance",
    audit: "audit",
  },
  en: {
    review: "review",
    draft: "draft",
    ingestion: "ingestion",
    governance: "governance",
    audit: "audit",
  },
} satisfies Record<AklLanguage, Record<WorkflowTaskKind, string>>;

export function WorkflowInbox({
  documents,
  jobs,
  auditEvents,
  registryTasks,
  authorization,
  nowIso,
  compact = false,
  title,
  serverFiltered = false,
}: WorkflowInboxProps) {
  const { language } = useLanguage();
  const searchParams = useSearchParams();
  const copy = taskCopy[language];
  const tasks = useMemo(
    () =>
      buildWorkflowTasks({
        documents,
        jobs,
        auditEvents,
        registryTasks,
        nowIso,
        preserveRegistryOrder: serverFiltered,
      }),
    [documents, jobs, auditEvents, registryTasks, nowIso, serverFiltered],
  );
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [priority, setPriority] =
    useState<FilterValue<WorkflowTaskPriority>>(() => taskPriority(searchParams.get("priority")));
  const [status, setStatus] = useState<FilterValue<WorkflowTaskStatus>>(() =>
    taskStatus(searchParams.get("status")),
  );
  const [kind, setKind] = useState<FilterValue<WorkflowTaskKind>>(() =>
    taskKind(searchParams.get("kind")),
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    searchParams.get("task") ?? tasks[0]?.id ?? null,
  );

  const filteredTasks = serverFiltered ? tasks : tasks.filter((task) => {
    const normalizedQuery = query.trim().toLowerCase();
    const presentation = workflowTaskPresentation(task, language);
    const matchesQuery =
      normalizedQuery.length === 0 ||
      [
        presentation.title,
        presentation.description,
        task.document_title,
        presentation.owner,
        presentation.role,
        presentation.source,
        task.job_id,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
    return (
      matchesQuery &&
      (priority === "all" || task.priority === priority) &&
      (status === "all" || task.status === status) &&
      (kind === "all" || task.kind === kind)
    );
  });
  const selectedTask =
    filteredTasks.find((task) => task.id === selectedTaskId) ??
    filteredTasks[0] ??
    null;
  const overdueTasks = tasks.filter((task) => isTaskOverdue(task, nowIso));
  const blockedTasks = tasks.filter((task) => task.status === "blocked");
  const reviewTasks = tasks.filter(
    (task) => task.kind === "review" || task.kind === "governance",
  );
  const tasksReturnTo = useMemo(() => {
    const params = new URLSearchParams();
    if (searchParams.get("view")) params.set("view", searchParams.get("view")!);
    if (searchParams.get("page")) params.set("page", searchParams.get("page")!);
    if (query.trim()) params.set("q", query.trim());
    if (priority !== "all") params.set("priority", priority);
    if (status !== "all") params.set("status", status);
    if (kind !== "all") params.set("kind", kind);
    if (selectedTask) params.set("task", selectedTask.id);
    return buildReturnTarget("/tasks", params);
  }, [kind, priority, query, searchParams, selectedTask, status]);

  function clearFilters() {
    setQuery("");
    setPriority("all");
    setStatus("all");
    setKind("all");
  }

  return (
    <div className="stack">
      {!compact ? <section className="grid grid--metrics" aria-label={copy.metricsLabel}>
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
      </section> : null}

      <section className="panel">
        <div className="panel__header">
          <h2>{title ?? copy.inboxTitle}</h2>
          <StatusBadge
            value="info"
            label={`${filteredTasks.length} ${copy.resultCount}`}
          />
        </div>
        <div className="panel__body stack">
          {!serverFiltered ? <div className="task-toolbar">
            <StratosSearchBox
              id="workflow-inbox-search"
              label={copy.searchPlaceholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.searchPlaceholder}
            />
            <TaskSelect
              label={copy.priority}
              value={priority}
              onChange={(value) =>
                setPriority(value as FilterValue<WorkflowTaskPriority>)
              }
              options={(["critical", "high", "medium", "low"] as const).map(
                (value) => ({
                  value,
                  label: priorityLabels[language][value],
                }),
              )}
              allLabel={copy.all}
            />
            <TaskSelect
              label={copy.status}
              value={status}
              onChange={(value) =>
                setStatus(value as FilterValue<WorkflowTaskStatus>)
              }
              options={(["open", "waiting", "blocked"] as const).map(
                (value) => ({
                  value,
                  label: statusLabels[language][value],
                }),
              )}
              allLabel={copy.all}
            />
            <TaskSelect
              label={copy.kind}
              value={kind}
              onChange={(value) =>
                setKind(value as FilterValue<WorkflowTaskKind>)
              }
              options={(
                ["review", "draft", "ingestion", "governance", "audit"] as const
              ).map((value) => ({
                value,
                label: kindLabels[language][value],
              }))}
              allLabel={copy.all}
            />
            <StratosButton type="button" onClick={clearFilters}>
              <FilterX size={16} aria-hidden="true" />
              {copy.clear}
            </StratosButton>
          </div> : null}
        </div>
      </section>

      <section className="task-inbox-layout">
        <div className="panel">
          <div className="panel__header">
            <h2>{copy.task}</h2>
          </div>
          <div className="task-list">
            {filteredTasks.map((task) => {
              const presentation = workflowTaskPresentation(task, language);
              return (
                <button
                  className={`task-row ${selectedTask?.id === task.id ? "task-row--active" : ""}`}
                  key={task.id}
                  type="button"
                  onClick={() => setSelectedTaskId(task.id)}
                >
                  <span className="task-row__main">
                    <strong>{presentation.title}</strong>
                    <span>{task.document_title ?? presentation.source}</span>
                  </span>
                  <span className="task-row__badges">
                    <StatusBadge
                      value={priorityTone(task.priority)}
                      label={priorityLabels[language][task.priority]}
                    />
                    <StatusBadge
                      value={statusTone(task.status)}
                      label={statusLabels[language][task.status]}
                    />
                  </span>
                  <span className="task-row__meta">
                    {presentation.owner} · {formatDateTime(task.due_at, language)}
                  </span>
                </button>
              );
            })}
            {filteredTasks.length === 0 ? (
              <div className="empty-state">{copy.noResults}</div>
            ) : null}
          </div>
        </div>

        <TaskDetail
          task={selectedTask}
          copy={copy}
          language={language}
          authorization={authorization}
          nowIso={nowIso}
          returnTo={tasksReturnTo}
        />
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

function TaskSelect({
  label,
  value,
  options,
  allLabel,
  onChange,
}: TaskSelectProps) {
  return (
    <StratosSelect
      id={`workflow-filter-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="all">{allLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </StratosSelect>
  );
}

function TaskDetail({
  task,
  copy,
  language,
  authorization,
  nowIso,
  returnTo,
}: {
  task: WorkflowTask | null;
  copy: Record<string, string>;
  language: AklLanguage;
  authorization: AuthorizationHint;
  nowIso: string;
  returnTo: string;
}) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [selectedAssignee, setSelectedAssignee] =
    useState<DirectoryUser | null>(null);
  const [submittingAction, setSubmittingAction] =
    useState<RegistryWorkflowTaskAction | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    setComment("");
    setAssigneeId("");
    setSelectedAssignee(null);
    setFeedback(null);
  }, [task?.id]);

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

  const actions = actionsForTask(task).filter((action) =>
    action === "approve" || action === "publish"
      ? authorization.can_publish
      : authorization.can_update || (task.kind === "review" && authorization.can_publish),
  );
  const presentation = workflowTaskPresentation(task, language);

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
        task_kind: task.kind,
      },
    };
    if (action === "assign" && assigneeId.trim()) {
      payload.assignee_id = assigneeId.trim();
    }

    try {
      const response = await fetch(
        withAppBasePath(
          `/api/workflow/tasks/${encodeURIComponent(task.registry_task_id)}/actions`,
        ),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        throw new Error(await readWorkflowActionError(response, language));
      }
      setFeedback({ tone: "success", message: copy.actionSaved });
      setComment("");
      if (action === "assign") {
        setAssigneeId("");
        setSelectedAssignee(null);
      }
      router.refresh();
    } catch (error) {
      const suffix =
        error instanceof Error && error.message ? ` ${error.message}` : "";
      setFeedback({ tone: "error", message: `${copy.actionFailed}${suffix}` });
    } finally {
      setSubmittingAction(null);
    }
  }

  return (
    <aside className="panel task-detail">
      <div className="panel__header">
        <h2>{copy.detailTitle}</h2>
        {isTaskOverdue(task, nowIso) ? (
          <StatusBadge value="critical" label={copy.overdue} />
        ) : null}
      </div>
      <div className="panel__body stack">
        <div className="task-detail__title">
          <span className="task-kind">{kindLabels[language][task.kind]}</span>
          <h3>{presentation.title}</h3>
          <p>{presentation.description}</p>
        </div>
        <div className="detail-kv-grid">
          <TaskField
            label={copy.owner}
            value={presentation.owner === presentation.role
              ? presentation.owner
              : `${presentation.owner} · ${presentation.role}`}
          />
          <TaskField
            label={copy.due}
            value={formatDateTime(task.due_at, language)}
          />
          <TaskField label={copy.source} value={presentation.source} />
          <TaskField
            label={copy.document}
            value={task.document_title ?? copy.notSpecified}
          />
          {task.version_label ? <TaskField label={copy.version} value={task.version_label} /> : null}
        </div>
        {task.submission_comment ? <TaskField label={copy.submittedComment} value={task.submission_comment} /> : null}
        {task.decision_comment ? <TaskField label={copy.returnedComment} value={task.decision_comment} /> : null}
        {presentation.technicalOwner || task.document_version_id || task.job_id ? (
          <details className="technical-details technical-details--compact">
            <summary>{copy.technicalDetails}</summary>
            <div className="technical-details__body">
              {presentation.technicalOwner ? (
                <p className="technical-details__line">
                  <strong>{copy.technicalOwner}</strong>
                  <span>{presentation.technicalOwner}</span>
                </p>
              ) : null}
              {task.document_version_id ? (
                <p className="technical-details__line">
                  <strong>{copy.technicalVersion}</strong>
                  <span>{task.document_version_id}</span>
                </p>
              ) : null}
              {task.job_id ? (
                <p className="technical-details__line">
                  <strong>{copy.technicalJob}</strong>
                  <span>{task.job_id}</span>
                </p>
              ) : null}
            </div>
          </details>
        ) : null}
        <div className="task-actions">
          <StratosButtonLink
            tone="primary"
            href={withDocumentReturnContext(task.href, returnTo, "tasks")}
          >
            {presentation.actionLabel}
            <ArrowUpRight size={15} aria-hidden="true" />
          </StratosButtonLink>
          {task.secondary_href ? (
            <StratosButtonLink
              href={withDocumentReturnContext(task.secondary_href, returnTo, "tasks")}
            >
              {copy.secondaryAction}
              <ArrowUpRight size={15} aria-hidden="true" />
            </StratosButtonLink>
          ) : null}
        </div>
        {task.registry_task_id && actions.length > 0 ? (
          <div className="task-action-panel">
            <div className="task-action-panel__header">
              <div>
                <strong>{copy.actionPanelTitle}</strong>
              </div>
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor={`workflow-comment-${task.id}`}>
                  {copy.decisionComment}
                </label>
                <textarea
                  id={`workflow-comment-${task.id}`}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder={copy.commentPlaceholder}
                  maxLength={1000}
                />
              </div>
              {actions.includes("assign") ? <div className="field">
                <label>{copy.assignee}</label>
                <WorkflowAssigneePicker
                  key={task.id}
                  copy={copy}
                  disabled={Boolean(submittingAction)}
                  placeholder={copy.assigneePlaceholder}
                  selectedUser={selectedAssignee}
                  value={assigneeId}
                  onSelect={(user) => {
                    setSelectedAssignee(user);
                    setAssigneeId(user.subject_id);
                  }}
                  onClear={() => {
                    setSelectedAssignee(null);
                    setAssigneeId("");
                  }}
                />
              </div> : null}
            </div>
            <div className="task-action-buttons">
              {actions.map((action) => (
                <StratosButton
                  tone={
                    action === "approve" || action === "resolve"
                      ? "primary"
                      : "default"
                  }
                  disabled={
                    Boolean(submittingAction) ||
                    (action === "assign" && assigneeId.trim().length === 0)
                  }
                  key={action}
                  type="button"
                  onClick={() => {
                    void submitAction(action);
                  }}
                >
                  {action === "request_changes" ? <RotateCcw size={16} aria-hidden="true" /> : action === "assign" ? <UserPlus size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
                  {workflowActionLabel(action, copy)}
                </StratosButton>
              ))}
            </div>
            {feedback ? (
              <div
                className={`notice ${feedback.tone === "error" ? "notice--danger" : ""}`}
                role={feedback.tone === "error" ? "alert" : "status"}
              >
                {feedback.message}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="muted">{task.registry_task_id ? copy.readOnly : copy.noRegistryAction}</p>
        )}
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

function WorkflowAssigneePicker({
  copy,
  disabled,
  placeholder,
  selectedUser,
  value,
  onSelect,
  onClear,
}: {
  copy: Record<string, string>;
  disabled: boolean;
  placeholder: string;
  selectedUser: DirectoryUser | null;
  value: string;
  onSelect: (user: DirectoryUser) => void;
  onClear: () => void;
}) {
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    fetch(withAppBasePath("/api/workflow/assignees?limit=50"), {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await readWorkflowActionError(response));
        }
        return response.json() as Promise<{ users?: DirectoryUser[] }>;
      })
      .then((payload) => {
        setUsers(Array.isArray(payload.users) ? payload.users : []);
      })
      .catch((fetchError) => {
        if (
          fetchError instanceof DOMException &&
          fetchError.name === "AbortError"
        ) {
          return;
        }
        setUsers([]);
        setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, []);

  const people = useMemo(
    () =>
      directoryUsersToPeople(selectedUser ? [selectedUser, ...users] : users),
    [selectedUser, users],
  );

  const emptyLabel = error
    ? copy.assigneeSearchFailed
    : loading
      ? copy.assigneeSearching
      : copy.assigneeNoResults;

  return (
    <div className="stack">
      <PersonPicker
        disabled={disabled || loading || error || people.length === 0}
        people={people}
        selectedPersonId={value || null}
        labels={{
          title: copy.assigneeDirectory,
          search: placeholder,
          placeholder,
          empty: emptyLabel,
          close: copy.assigneeClear,
        }}
        popoverMinWidth={360}
        popoverPlacement="bottom-start"
        onPersonSelect={(personId) => {
          const selected =
            users.find((user) => user.subject_id === personId) ?? selectedUser;
          if (selected) {
            onSelect(selected);
          }
        }}
      />
      <p className="muted">{copy.assigneeHelp}</p>
      {value ? (
        <StratosButton type="button" disabled={disabled} onClick={onClear}>
          {copy.assigneeClear}
        </StratosButton>
      ) : null}
      {error ? <p className="muted">{copy.assigneeSearchFailed}</p> : null}
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
  return task.allowed_actions ?? [];
}

function taskPriority(value: string | null): FilterValue<WorkflowTaskPriority> {
  return (["critical", "high", "medium", "low"] as const).includes(
    value as WorkflowTaskPriority,
  )
    ? (value as WorkflowTaskPriority)
    : "all";
}

function taskStatus(value: string | null): FilterValue<WorkflowTaskStatus> {
  return (["open", "waiting", "blocked"] as const).includes(value as WorkflowTaskStatus)
    ? (value as WorkflowTaskStatus)
    : "all";
}

function taskKind(value: string | null): FilterValue<WorkflowTaskKind> {
  return (["review", "draft", "ingestion", "governance", "audit"] as const).includes(
    value as WorkflowTaskKind,
  )
    ? (value as WorkflowTaskKind)
    : "all";
}

function workflowActionLabel(
  action: RegistryWorkflowTaskAction,
  copy: Record<string, string>,
): string {
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

async function readWorkflowActionError(response: Response, language: AklLanguage = "cs"): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    error?: { code?: string };
  } | null;
  return documentReviewError(payload?.error?.code, response.status, language);
}
