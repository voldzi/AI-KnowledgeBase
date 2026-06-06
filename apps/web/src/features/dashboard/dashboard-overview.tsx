"use client";

import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Bot, ClipboardList, FileText, UploadCloud } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import type { AuditEvent, AuthorizationHint, Document, IngestionJob, RegistryWorkflowTask } from "@/lib/types";
import { documentTypeLabel, formatDateTime } from "@/lib/format";
import { buildWorkflowTasks, isTaskOverdue } from "@/features/tasks/workflow-task-model";

interface DashboardOverviewProps {
  documents: Document[];
  jobs: IngestionJob[];
  auditEvents: AuditEvent[];
  registryTasks?: RegistryWorkflowTask[];
  authorization: AuthorizationHint;
  nowIso: string;
}

const dashboardCopy = {
  cs: {
    metricsLabel: "Metriky přehledu",
    validDocuments: "Platné dokumenty",
    totalControlledRecords: "celkem řízených záznamů",
    activeIngestion: "Aktivní zpracování",
    activeIngestionDetail: "Úlohy ve frontě nebo ve zpracování",
    failedJobs: "Selhané úlohy",
    failedJobsDetail: "Vyžaduje provozní kontrolu",
    workflowTasks: "Workflow úkoly",
    workflowTasksDetail: "Otevřené revize, varování a auditní signály",
    openTasks: "Otevřené úkoly",
    overdueTasks: "po termínu",
    openInbox: "Otevřít inbox",
    recentDocuments: "Nedávné řízené dokumenty",
    document: "Dokument",
    status: "Stav",
    classification: "Klasifikace",
    updated: "Aktualizováno",
    ingestionAndAudit: "Zpracování a audit",
    hiddenActions: "UI akce jsou skryté uživatelům bez oprávnění z Registry API.",
    publishingVisible: "Publikování je viditelné.",
    publishingHidden: "Publikování je v této relaci skryté.",
    readiness: "Připravenost znalostního workflow",
    registryApi: "Registry API",
    registryTitle: "Stav dokumentu je autoritativní",
    registryDetail: "Frontend čte metadata dokumentů, platnost verzí a authz hinty z Registry API.",
    ragRetrieval: "RAG Retrieval",
    ragTitle: "Odpovědi začínají citacemi",
    ragDetail: "Odpovědi musí ukazovat zdrojový dokument, verzi, cestu oddílu, stranu a chunk id.",
    ingestion: "Ingestion",
    ingestionTitle: "Stav pipeline je viditelný",
    ingestionDetail: "Stavy ve frontě, běhu, selhání a varování zůstávají viditelné pro správce dokumentů."
  },
  en: {
    metricsLabel: "Dashboard metrics",
    validDocuments: "Valid documents",
    totalControlledRecords: "total controlled records",
    activeIngestion: "Active ingestion",
    activeIngestionDetail: "Jobs queued or processing",
    failedJobs: "Failed jobs",
    failedJobsDetail: "Requires operations review",
    workflowTasks: "Workflow tasks",
    workflowTasksDetail: "Open reviews, warnings and audit signals",
    openTasks: "Open tasks",
    overdueTasks: "overdue",
    openInbox: "Open inbox",
    recentDocuments: "Recent controlled documents",
    document: "Document",
    status: "Status",
    classification: "Classification",
    updated: "Updated",
    ingestionAndAudit: "Ingestion and audit",
    hiddenActions: "UI actions are hidden from users without permission hints from Registry API.",
    publishingVisible: "Publishing is visible.",
    publishingHidden: "Publishing is hidden in this session.",
    readiness: "Knowledge workflow readiness",
    registryApi: "Registry API",
    registryTitle: "Document state is authoritative",
    registryDetail: "Frontend reads document metadata, version validity and authz hints from Registry API.",
    ragRetrieval: "RAG Retrieval",
    ragTitle: "Citation-first answers",
    ragDetail: "Answers must show source document, version, section path, page and chunk id.",
    ingestion: "Ingestion",
    ingestionTitle: "Pipeline status is visible",
    ingestionDetail: "Queued, running, failed and warning states stay visible to document managers."
  }
} satisfies Record<AklLanguage, Record<string, string>>;

export function DashboardOverview({
  documents,
  jobs,
  auditEvents,
  registryTasks,
  authorization,
  nowIso
}: DashboardOverviewProps) {
  const { language } = useLanguage();
  const copy = dashboardCopy[language];
  const validDocuments = documents.filter((document) => document.status === "valid").length;
  const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "running").length;
  const failedJobs = jobs.filter((job) => job.status === "failed").length;
  const workflowTasks = buildWorkflowTasks({ documents, jobs, auditEvents, registryTasks, nowIso });
  const overdueTasks = workflowTasks.filter((task) => isTaskOverdue(task, nowIso));

  return (
    <div className="stack">
      <section className="grid grid--metrics" aria-label={copy.metricsLabel}>
        <MetricCard
          detail={`${documents.length} ${copy.totalControlledRecords}`}
          icon={FileText}
          label={copy.validDocuments}
          tone="success"
          value={String(validDocuments)}
        />
        <MetricCard
          detail={copy.activeIngestionDetail}
          icon={UploadCloud}
          label={copy.activeIngestion}
          tone="attention"
          value={String(activeJobs)}
        />
        <MetricCard
          detail={copy.failedJobsDetail}
          icon={AlertTriangle}
          label={copy.failedJobs}
          tone={failedJobs > 0 ? "danger" : "default"}
          value={String(failedJobs)}
        />
        <MetricCard
          detail={copy.workflowTasksDetail}
          icon={ClipboardList}
          label={copy.workflowTasks}
          tone={workflowTasks.length > 0 ? "attention" : "success"}
          value={String(workflowTasks.length)}
        />
      </section>

      <section className="grid grid--two">
        <div className="panel">
          <div className="panel__header">
            <h2>{copy.recentDocuments}</h2>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{copy.document}</th>
                <th>{copy.status}</th>
                <th>{copy.classification}</th>
                <th>{copy.updated}</th>
              </tr>
            </thead>
            <tbody>
              {documents.slice(0, 5).map((document) => (
                <tr key={document.document_id}>
                  <td>
                    <span className="cell-title">
                      <strong>{document.title}</strong>
                      <span>{documentTypeLabel(document.document_type, language)} - {document.gestor_unit}</span>
                    </span>
                  </td>
                  <td>
                    <StatusBadge value={document.status} />
                  </td>
                  <td>{document.classification}</td>
                  <td>{formatDateTime(document.updated_at, language)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel__header">
            <h2>{copy.ingestionAndAudit}</h2>
            <Link className="button" href="/tasks">
              {copy.openInbox}
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </div>
          <div className="panel__body stack">
            <div className="notice">
              <strong>{copy.openTasks}: </strong>
              {workflowTasks.length} · {overdueTasks.length} {copy.overdueTasks}
            </div>
            <div className="timeline">
              {jobs.slice(0, 3).map((job) => (
                <div className="timeline-item" key={job.job_id}>
                  <strong>
                    {job.job_id} <StatusBadge value={job.status} />
                  </strong>
                  <span>{job.document_id} - {job.chunking_strategy} - {formatDateTime(job.created_at, language)}</span>
                </div>
              ))}
            </div>
            <div className="notice">
              {copy.hiddenActions} {authorization.can_publish ? copy.publishingVisible : copy.publishingHidden}
            </div>
            <div className="timeline">
              {auditEvents.slice(0, 2).map((event) => (
                <div className="timeline-item" key={event.audit_event_id}>
                  <strong>{event.event_type}</strong>
                  <span>{event.actor_id} - {formatDateTime(event.created_at, language)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>{copy.readiness}</h2>
          <Bot size={18} aria-hidden="true" />
        </div>
        <div className="panel__body grid grid--three">
          <div>
            <p className="eyebrow">{copy.registryApi}</p>
            <h3>{copy.registryTitle}</h3>
            <p className="muted">{copy.registryDetail}</p>
          </div>
          <div>
            <p className="eyebrow">{copy.ragRetrieval}</p>
            <h3>{copy.ragTitle}</h3>
            <p className="muted">{copy.ragDetail}</p>
          </div>
          <div>
            <p className="eyebrow">{copy.ingestion}</p>
            <h3>{copy.ingestionTitle}</h3>
            <p className="muted">{copy.ingestionDetail}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
