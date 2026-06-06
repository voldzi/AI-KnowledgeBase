"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpenCheck,
  Brain,
  CircleCheck,
  ClipboardCheck,
  FileClock,
  FileSearch,
  GitCompareArrows,
  Layers3,
  LockKeyhole,
  Network,
  ShieldCheck,
  UploadCloud
} from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import type { AuthorizationHint, Document, DocumentVersion, IngestionJob, RegistryWorkflowTask } from "@/lib/types";
import { documentTypeLabel, formatDate, formatDateTime } from "@/lib/format";

interface DocumentDetailProps {
  document: Document;
  versions: DocumentVersion[];
  jobs: IngestionJob[];
  authorization: AuthorizationHint;
  workflowTasks?: RegistryWorkflowTask[];
}

const detailCopy = {
  cs: {
    back: "Zpět do registru",
    registryNotice: "Frontend zobrazuje platnost dokumentu a akce pouze z Registry API. Autoritativní oprávnění neodvozuje lokálně.",
    overview: "Přehled",
    viewer: "Viewer",
    workflow: "Workflow",
    insights: "Insighty",
    versionsTab: "Verze",
    ingestionTab: "Ingestion",
    owner: "Vlastník",
    type: "Typ",
    classification: "Klasifikace",
    gestor: "Gestor",
    updated: "Aktualizováno",
    currentVersion: "Aktuální verze",
    validFrom: "platná od",
    noVersion: "Žádná verze",
    source: "Zdroj",
    sourceUri: "URI zdrojového souboru",
    sourceHash: "Hash souboru",
    viewerMode: "Režim vieweru",
    viewerNotice: "Nativní preview dokumentu bude navázané na source-context a podepsané download URL. Aktuálně je dostupný citovatelný zdrojový kontext z RAG služby.",
    workflowTitle: "Publikační workflow",
    workflowDraft: "Koncept",
    workflowDraftDetail: "Metadata a verze jsou založené v Registry API.",
    workflowIngestion: "Zpracování",
    workflowIngestionDetail: "Parser, chunker a indexace připraví citovatelný zdroj.",
    workflowReview: "Revize",
    workflowReviewDetail: "Vlastník nebo gestor kontroluje metadata, zdroje a governance zjištění.",
    workflowApproved: "Schválení",
    workflowApprovedDetail: "Schválený dokument je připravený na publikaci platné verze.",
    workflowPublish: "Publikace",
    workflowPublishDetail: "Platná verze nahrazuje předchozí publikovanou verzi.",
    workflowArchive: "Archivace",
    workflowArchiveDetail: "Nahrazené verze zůstávají dohledatelné pro audit.",
    workflowTasksTitle: "Workflow tasky",
    workflowTasksDetail: "Autoritativní stav, vlastník a poslední rozhodnutí z Registry API.",
    workflowTasksEmpty: "K dokumentu nejsou evidované workflow tasky.",
    publishGateTitle: "Publish gate",
    publishGateReady: "Dokument je schválený. Aktuální verzi lze publikovat.",
    publishGatePublished: "Aktuální verze je publikovaná. Archivace je dostupná podle oprávnění.",
    publishGateArchived: "Aktuální verze je archivovaná. Publikace ani archivace nejsou pro tuto verzi dostupné.",
    publishGateLocked: "Publikace je zamčená, dokud review workflow nepřejde do stavu approved.",
    publishGateNoPermission: "Publikační akce nejsou pro tuto relaci povolené.",
    publishApproved: "Publikovat schválenou verzi",
    archiveCurrent: "Archivovat aktuální verzi",
    publishing: "Publikuji",
    archiving: "Archivuji",
    workflowActionSaved: "Akce byla provedena.",
    workflowActionFailed: "Akci se nepodařilo provést.",
    taskDue: "termín",
    resolved: "vyřešeno",
    lastAction: "poslední akce",
    currentSignal: "aktuální signál",
    requiredActions: "Prioritní kroky",
    actionIngestion: "Dokončit ingestion a zkontrolovat varování.",
    actionReview: "Spustit kontrolu compliance před publikací.",
    actionViewer: "Doplnit přesnou viewer lokaci pro PDF/DOCX zdroje.",
    actionAccess: "Ověřit přístupové politiky pro citlivou klasifikaci.",
    noActions: "Nejsou detekované prioritní kroky.",
    insightsTitle: "Navržené znalostní výstupy",
    insightObligation: "Povinnosti",
    insightObligationDetail: "Extrahovat normativní požadavky s citací na oddíl dokumentu.",
    insightRoles: "Role a odpovědnosti",
    insightRolesDetail: "Zachytit vlastníka, gestora, schvalovatele a provozní role.",
    insightDeadlines: "Lhůty",
    insightDeadlinesDetail: "Najít účinnost, platnost, revizní termíny a SLA.",
    insightRisk: "Rizika",
    insightRiskDetail: "Označit konflikty, neúplná metadata a citlivé části.",
    proposed: "návrh",
    governanceTitle: "Governance kontroly",
    compareVersions: "Porovnat verze",
    complianceCheck: "Kontrola compliance",
    conflictDetection: "Detekce konfliktů",
    versionHistory: "Historie verzí",
    upload: "Nahrát",
    version: "Verze",
    status: "Stav",
    validity: "Platnost",
    changeSummary: "Souhrn změny",
    ingestionStatus: "Stav zpracování",
    created: "vytvořeno",
    noJob: "K tomuto dokumentu není aktuálně připojena žádná ingestion úloha."
  },
  en: {
    back: "Back to registry",
    registryNotice: "Frontend displays document validity and actions from Registry API only. It does not infer authoritative authorization locally.",
    overview: "Overview",
    viewer: "Viewer",
    workflow: "Workflow",
    insights: "Insights",
    versionsTab: "Versions",
    ingestionTab: "Ingestion",
    owner: "Owner",
    type: "Type",
    classification: "Classification",
    gestor: "Gestor",
    updated: "Updated",
    currentVersion: "Current version",
    validFrom: "valid from",
    noVersion: "No version",
    source: "Source",
    sourceUri: "Source file URI",
    sourceHash: "File hash",
    viewerMode: "Viewer mode",
    viewerNotice: "Native document preview will be connected to source-context and signed download URLs. The citable source context from RAG is available now.",
    workflowTitle: "Publication workflow",
    workflowDraft: "Draft",
    workflowDraftDetail: "Metadata and version are registered in Registry API.",
    workflowIngestion: "Ingestion",
    workflowIngestionDetail: "Parser, chunker and indexing prepare citable source context.",
    workflowReview: "Review",
    workflowReviewDetail: "Owner or gestor checks metadata, sources and governance findings.",
    workflowApproved: "Approval",
    workflowApprovedDetail: "An approved document is ready for valid-version publication.",
    workflowPublish: "Publication",
    workflowPublishDetail: "The valid version supersedes the previous published version.",
    workflowArchive: "Archive",
    workflowArchiveDetail: "Superseded versions remain discoverable for audit.",
    workflowTasksTitle: "Workflow tasks",
    workflowTasksDetail: "Authoritative status, owner and last decision from Registry API.",
    workflowTasksEmpty: "No workflow tasks are recorded for this document.",
    publishGateTitle: "Publish gate",
    publishGateReady: "The document is approved. The current version can be published.",
    publishGatePublished: "The current version is published. Archive is available according to permissions.",
    publishGateArchived: "The current version is archived. Publication and archive actions are not available for this version.",
    publishGateLocked: "Publication is locked until the review workflow reaches approved state.",
    publishGateNoPermission: "Publication actions are not allowed in this session.",
    publishApproved: "Publish approved version",
    archiveCurrent: "Archive current version",
    publishing: "Publishing",
    archiving: "Archiving",
    workflowActionSaved: "Action completed.",
    workflowActionFailed: "The action could not be completed.",
    taskDue: "due",
    resolved: "resolved",
    lastAction: "last action",
    currentSignal: "current signal",
    requiredActions: "Priority actions",
    actionIngestion: "Finish ingestion and review warnings.",
    actionReview: "Run compliance check before publication.",
    actionViewer: "Add exact viewer location for PDF/DOCX sources.",
    actionAccess: "Review access policies for sensitive classification.",
    noActions: "No priority actions detected.",
    insightsTitle: "Proposed knowledge outputs",
    insightObligation: "Obligations",
    insightObligationDetail: "Extract normative requirements with source-section citations.",
    insightRoles: "Roles and responsibilities",
    insightRolesDetail: "Capture owner, gestor, approver and operating roles.",
    insightDeadlines: "Deadlines",
    insightDeadlinesDetail: "Find effective dates, validity, review dates and SLA.",
    insightRisk: "Risks",
    insightRiskDetail: "Flag conflicts, incomplete metadata and sensitive sections.",
    proposed: "proposed",
    governanceTitle: "Governance checks",
    compareVersions: "Compare versions",
    complianceCheck: "Compliance check",
    conflictDetection: "Conflict detection",
    versionHistory: "Version history",
    upload: "Upload",
    version: "Version",
    status: "Status",
    validity: "Validity",
    changeSummary: "Change summary",
    ingestionStatus: "Ingestion status",
    created: "created",
    noJob: "No ingestion job is currently linked to this document."
  }
} satisfies Record<AklLanguage, Record<string, string>>;

type DetailTab = "overview" | "viewer" | "workflow" | "insights" | "versions" | "ingestion";

export function DocumentDetail({ document, versions, jobs, authorization, workflowTasks = [] }: DocumentDetailProps) {
  const { language } = useLanguage();
  const router = useRouter();
  const copy = detailCopy[language];
  const relatedJobs = jobs.filter((job) => job.document_id === document.document_id);
  const sortedWorkflowTasks = useMemo(
    () => [...workflowTasks].sort((left, right) => right.updated_at.localeCompare(left.updated_at)),
    [workflowTasks]
  );
  const currentVersion = versions.find((version) => version.status === "valid") ?? versions[0];
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [workflowAction, setWorkflowAction] = useState<"publish" | "archive" | null>(null);
  const [workflowFeedback, setWorkflowFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const priorityActions = useMemo(
    () => priorityActionsFor(document, currentVersion, relatedJobs, copy),
    [copy, currentVersion, document, relatedJobs]
  );
  const viewerMode = currentVersion ? viewerModeFor(currentVersion.source_file_uri) : "binary";
  const canPublishCurrentVersion = Boolean(
    authorization.can_publish &&
      currentVersion &&
      document.status === "approved" &&
      !["valid", "superseded", "archived", "cancelled"].includes(currentVersion.status)
  );
  const canArchiveCurrentVersion = Boolean(authorization.can_publish && currentVersion?.status === "valid");

  async function submitVersionAction(action: "publish" | "archive") {
    if (!currentVersion || workflowAction) {
      return;
    }
    setWorkflowAction(action);
    setWorkflowFeedback(null);
    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(document.document_id)}/versions/${encodeURIComponent(currentVersion.document_version_id)}/${action}`,
        { method: "POST" }
      );
      if (!response.ok) {
        throw new Error(await readDocumentWorkflowError(response));
      }
      setWorkflowFeedback({ tone: "success", message: copy.workflowActionSaved });
      router.refresh();
    } catch (error) {
      const suffix = error instanceof Error && error.message ? ` ${error.message}` : "";
      setWorkflowFeedback({ tone: "error", message: `${copy.workflowActionFailed}${suffix}` });
    } finally {
      setWorkflowAction(null);
    }
  }

  return (
    <div className="stack">
      <Link className="button" href="/documents">
        <ArrowLeft size={16} aria-hidden="true" />
        {copy.back}
      </Link>

      <section className="panel">
        <div className="panel__body grid grid--two">
          <div className="stack">
            <div>
              <p className="eyebrow">{documentTypeLabel(document.document_type, language)}</p>
              <h2>{document.title}</h2>
              <p className="muted">{document.document_id} - {document.gestor_unit}</p>
            </div>
            <div className="tag-list">
              <StatusBadge value={document.status} />
              <span className="tag">{document.classification}</span>
              {document.tags.map((tag) => (
                <span className="tag" key={tag}>{tag}</span>
              ))}
            </div>
            <p className="notice">{copy.registryNotice}</p>
          </div>
          <div className="stack">
            <div className="timeline-item">
              <strong>{copy.owner}</strong>
              <span>{document.owner_id}</span>
            </div>
            <div className="timeline-item">
              <strong>{copy.updated}</strong>
              <span>{formatDateTime(document.updated_at, language)}</span>
            </div>
            <div className="timeline-item">
              <strong>{copy.currentVersion}</strong>
              <span>
                {currentVersion
                  ? `${currentVersion.version_label} ${copy.validFrom} ${formatDate(currentVersion.valid_from, language)}`
                  : copy.noVersion}
              </span>
            </div>
          </div>
        </div>
      </section>

      <nav className="tab-list" aria-label={language === "cs" ? "Sekce dokumentu" : "Document sections"}>
        {[
          ["overview", copy.overview, FileSearch],
          ["viewer", copy.viewer, BookOpenCheck],
          ["workflow", copy.workflow, ClipboardCheck],
          ["insights", copy.insights, Brain],
          ["versions", copy.versionsTab, Layers3],
          ["ingestion", copy.ingestionTab, FileClock]
        ].map(([tab, label, Icon]) => {
          const TypedIcon = Icon as typeof FileSearch;
          return (
            <button
              className={`tab-button ${activeTab === tab ? "tab-button--active" : ""}`}
              key={String(tab)}
              type="button"
              onClick={() => setActiveTab(tab as DetailTab)}
            >
              <TypedIcon size={16} aria-hidden="true" />
              {String(label)}
            </button>
          );
        })}
      </nav>

      {activeTab === "overview" ? (
        <section className="grid grid--two">
          <div className="panel">
            <div className="panel__header">
              <h2>{copy.overview}</h2>
              <StatusBadge value={document.status} />
            </div>
            <div className="panel__body detail-kv-grid">
              <KeyValue label={copy.type} value={documentTypeLabel(document.document_type, language)} />
              <KeyValue label={copy.classification} value={document.classification} />
              <KeyValue label={copy.owner} value={document.owner_id} />
              <KeyValue label={copy.gestor} value={document.gestor_unit ?? "n/a"} />
              <KeyValue label={copy.updated} value={formatDateTime(document.updated_at, language)} />
              <KeyValue
                label={copy.currentVersion}
                value={
                  currentVersion
                    ? `${currentVersion.version_label} - ${formatDate(currentVersion.valid_from, language)}`
                    : copy.noVersion
                }
              />
            </div>
          </div>
          <div className="panel">
            <div className="panel__header">
              <h2>{copy.requiredActions}</h2>
              <AlertTriangle size={18} aria-hidden="true" />
            </div>
            <div className="panel__body timeline">
              {priorityActions.length > 0 ? (
                priorityActions.map((action) => (
                  <div className="timeline-item" key={action}>
                    <strong>{action}</strong>
                    <span>{copy.currentSignal}</span>
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <CircleCheck size={22} aria-hidden="true" />
                  {copy.noActions}
                </div>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === "viewer" ? (
        <section className="grid grid--two">
          <div className="panel">
            <div className="panel__header">
              <h2>{copy.viewer}</h2>
              <StatusBadge value="online" label={viewerMode} />
            </div>
            <div className="panel__body source-viewer document-preview">
              <div className="document-preview__page">
                <div className="document-preview__ruler" />
                <h3>{document.title}</h3>
                <p>{currentVersion?.change_summary ?? copy.noVersion}</p>
                <div className="document-preview__highlight" />
                <div className="document-preview__line" />
                <div className="document-preview__line document-preview__line--short" />
              </div>
            </div>
          </div>
          <aside className="panel">
            <div className="panel__header">
              <h2>{copy.source}</h2>
              <LockKeyhole size={18} aria-hidden="true" />
            </div>
            <div className="panel__body stack">
              <KeyValue label={copy.sourceUri} value={currentVersion?.source_file_uri ?? "n/a"} />
              <KeyValue label={copy.sourceHash} value={currentVersion?.file_hash ?? "n/a"} />
              <KeyValue label={copy.viewerMode} value={viewerMode} />
              <p className="notice">{copy.viewerNotice}</p>
            </div>
          </aside>
        </section>
      ) : null}

      {activeTab === "workflow" ? (
        <div className="stack">
          <section className="grid grid--two">
            <div className="panel">
              <div className="panel__header">
                <h2>{copy.workflowTitle}</h2>
                <ShieldCheck size={18} aria-hidden="true" />
              </div>
              <div className="panel__body workflow-rail">
                {[
                  { label: copy.workflowDraft, detail: copy.workflowDraftDetail, done: document.status !== "cancelled" },
                  { label: copy.workflowIngestion, detail: copy.workflowIngestionDetail, done: relatedJobs.length > 0 },
                  {
                    label: copy.workflowReview,
                    detail: copy.workflowReviewDetail,
                    done: ["review", "approved", "valid"].includes(document.status)
                  },
                  {
                    label: copy.workflowApproved,
                    detail: copy.workflowApprovedDetail,
                    done: ["approved", "valid"].includes(document.status)
                  },
                  { label: copy.workflowPublish, detail: copy.workflowPublishDetail, done: document.status === "valid" },
                  {
                    label: copy.workflowArchive,
                    detail: copy.workflowArchiveDetail,
                    done: versions.some((version) => ["superseded", "archived"].includes(version.status))
                  }
                ].map((step) => (
                  <div className={`workflow-step ${step.done ? "workflow-step--done" : ""}`} key={step.label}>
                    <span aria-hidden="true">{step.done ? <CircleCheck size={16} /> : <FileClock size={16} />}</span>
                    <div>
                      <strong>{step.label}</strong>
                      <p>{step.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="panel">
              <div className="panel__header">
                <h2>{copy.governanceTitle}</h2>
                <Network size={18} aria-hidden="true" />
              </div>
              <div className="panel__body governance-action-grid">
                <GovernanceAction icon={GitCompareArrows} label={copy.compareVersions} enabled={versions.length > 1} />
                <GovernanceAction icon={ClipboardCheck} label={copy.complianceCheck} enabled={document.status !== "archived"} />
                <GovernanceAction icon={ShieldCheck} label={copy.conflictDetection} enabled={document.status === "review"} />
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>{copy.publishGateTitle}</h2>
                <p>
                  {authorization.can_publish
                    ? document.status === "valid"
                      ? copy.publishGatePublished
                      : document.status === "archived"
                      ? copy.publishGateArchived
                      : document.status === "approved"
                      ? copy.publishGateReady
                      : copy.publishGateLocked
                    : copy.publishGateNoPermission}
                </p>
              </div>
              <StatusBadge value={document.status} />
            </div>
            <div className="panel__body task-actions">
              {currentVersion ? (
                <>
                  <button
                    className="button button--primary"
                    disabled={!canPublishCurrentVersion || Boolean(workflowAction)}
                    type="button"
                    onClick={() => {
                      void submitVersionAction("publish");
                    }}
                  >
                    {workflowAction === "publish" ? copy.publishing : copy.publishApproved}
                  </button>
                  <button
                    className="button"
                    disabled={!canArchiveCurrentVersion || Boolean(workflowAction)}
                    type="button"
                    onClick={() => {
                      void submitVersionAction("archive");
                    }}
                  >
                    {workflowAction === "archive" ? copy.archiving : copy.archiveCurrent}
                  </button>
                </>
              ) : null}
              {workflowFeedback ? (
                <div className={`notice ${workflowFeedback.tone === "error" ? "notice--danger" : ""}`}>
                  {workflowFeedback.message}
                </div>
              ) : null}
            </div>
          </section>
          <section className="panel">
            <div className="panel__header">
              <div>
                <h2>{copy.workflowTasksTitle}</h2>
                <p>{copy.workflowTasksDetail}</p>
              </div>
              <StatusBadge value="info" label={String(sortedWorkflowTasks.length)} />
            </div>
            <div className="panel__body timeline workflow-task-history">
              {sortedWorkflowTasks.length > 0 ? (
                sortedWorkflowTasks.map((task) => (
                  <div className="timeline-item workflow-task-history__item" key={task.task_id}>
                    <div className="workflow-task-history__title">
                      <strong>{task.title}</strong>
                      <StatusBadge value={workflowTaskStatusTone(task.status)} label={workflowTaskStatusLabel(task.status, language)} />
                    </div>
                    <span>{task.owner_label} - {task.role}</span>
                    <span>{copy.source}: {task.source}</span>
                    <span>{copy.taskDue}: {formatDateTime(task.due_at, language)}</span>
                    {task.resolved_at ? <span>{copy.resolved}: {formatDateTime(task.resolved_at, language)}</span> : null}
                    {workflowLastAction(task.metadata.last_action) ? (
                      <span>{copy.lastAction}: {workflowLastAction(task.metadata.last_action)}</span>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <CircleCheck size={22} aria-hidden="true" />
                  {copy.workflowTasksEmpty}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === "insights" ? (
        <section className="panel">
          <div className="panel__header">
            <h2>{copy.insightsTitle}</h2>
            <Brain size={18} aria-hidden="true" />
          </div>
          <div className="panel__body insight-grid">
            {[
              [copy.insightObligation, copy.insightObligationDetail],
              [copy.insightRoles, copy.insightRolesDetail],
              [copy.insightDeadlines, copy.insightDeadlinesDetail],
              [copy.insightRisk, copy.insightRiskDetail]
            ].map(([title, detail]) => (
              <article className="insight-item" key={title}>
                <StatusBadge value="draft" label={copy.proposed} />
                <strong>{title}</strong>
                <p>{detail}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "versions" ? (
        <section className="panel" id="versions">
          <div className="panel__header">
            <h2>{copy.versionHistory}</h2>
            {authorization.can_ingest ? (
              <Link className="button" href="/upload">
                <UploadCloud size={16} aria-hidden="true" />
                {copy.upload}
              </Link>
            ) : null}
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{copy.version}</th>
                <th>{copy.status}</th>
                <th>{copy.validity}</th>
                <th>{copy.changeSummary}</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <tr key={version.document_version_id}>
                  <td>
                    <span className="cell-title">
                      <strong>{version.version_label}</strong>
                      <span>{version.document_version_id}</span>
                    </span>
                  </td>
                  <td>
                    <StatusBadge value={version.status} />
                  </td>
                  <td>{formatDate(version.valid_from, language)} - {formatDate(version.valid_to, language)}</td>
                  <td>{version.change_summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {activeTab === "ingestion" ? (
        <section className="panel">
          <div className="panel__header">
            <h2>{copy.ingestionStatus}</h2>
            <FileClock size={18} aria-hidden="true" />
          </div>
          <div className="panel__body timeline">
            {relatedJobs.length > 0 ? (
              relatedJobs.map((job) => (
                <div className="timeline-item" key={job.job_id}>
                  <strong>
                    {job.job_id} <StatusBadge value={job.status} />
                  </strong>
                  <span>{job.chunking_strategy} - {copy.created} {formatDateTime(job.created_at, language)}</span>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <CircleCheck size={22} aria-hidden="true" />
                {copy.noJob}
              </div>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-kv">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function GovernanceAction({
  enabled,
  icon: Icon,
  label
}: {
  enabled: boolean;
  icon: typeof GitCompareArrows;
  label: string;
}) {
  return (
    <div className={`governance-action ${enabled ? "governance-action--enabled" : ""}`}>
      <Icon size={18} aria-hidden="true" />
      <strong>{label}</strong>
      <StatusBadge value={enabled ? "queued" : "draft"} />
    </div>
  );
}

function workflowTaskStatusTone(status: RegistryWorkflowTask["status"]) {
  if (status === "resolved") {
    return "completed";
  }
  if (status === "blocked") {
    return "error";
  }
  if (status === "waiting") {
    return "queued";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return "info";
}

function workflowTaskStatusLabel(status: RegistryWorkflowTask["status"], language: AklLanguage): string {
  const labels = {
    cs: {
      open: "otevřeno",
      waiting: "čeká",
      blocked: "blokuje",
      resolved: "vyřešeno",
      cancelled: "zrušeno"
    },
    en: {
      open: "open",
      waiting: "waiting",
      blocked: "blocked",
      resolved: "resolved",
      cancelled: "cancelled"
    }
  } satisfies Record<AklLanguage, Record<RegistryWorkflowTask["status"], string>>;
  return labels[language][status];
}

function workflowLastAction(value: unknown): string | null {
  return typeof value === "string" ? value.replaceAll("_", " ") : null;
}

async function readDocumentWorkflowError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return payload?.error?.message ?? `HTTP ${response.status}`;
}

function viewerModeFor(uri: string): string {
  const value = uri.toLowerCase();
  if (value.endsWith(".pdf")) {
    return "pdf";
  }
  if (value.endsWith(".md") || value.endsWith(".markdown")) {
    return "markdown";
  }
  if (value.endsWith(".docx") || value.endsWith(".doc") || value.endsWith(".odt")) {
    return "text";
  }
  if (value.endsWith(".xlsx") || value.endsWith(".csv")) {
    return "table";
  }
  return "binary";
}

function priorityActionsFor(
  document: Document,
  currentVersion: DocumentVersion | undefined,
  relatedJobs: IngestionJob[],
  copy: Record<string, string>
): string[] {
  const actions: string[] = [];
  const currentJob = currentVersion
    ? relatedJobs.find((job) => job.document_version_id === currentVersion.document_version_id)
    : relatedJobs[0];
  if (!currentJob || ["queued", "running", "failed", "completed_with_warnings"].includes(currentJob.status)) {
    actions.push(copy.actionIngestion);
  }
  if (document.status === "review" || document.status === "draft") {
    actions.push(copy.actionReview);
  }
  if (currentVersion?.source_file_uri.toLowerCase().match(/\.(pdf|docx|doc|odt)$/)) {
    actions.push(copy.actionViewer);
  }
  if (document.classification === "restricted" || document.classification === "confidential") {
    actions.push(copy.actionAccess);
  }
  return actions;
}
