"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, Bot, ClipboardList, FileText, UploadCloud } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { StratosButtonLink, StratosDataTable, StratosSearchBox, StratosSelect, type StratosDataTableColumn } from "@/components/stratos";
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
    activeIngestion: "Probíhá zpracování",
    activeIngestionDetail: "Úlohy ve frontě nebo ve zpracování",
    failedJobs: "Selhané úlohy",
    failedJobsDetail: "Vyžaduje provozní kontrolu",
    workflowTasks: "Workflow úkoly",
    workflowTasksDetail: "Otevřené revize, varování a auditní signály",
    openTasks: "Otevřené úkoly",
    overdueTasks: "po termínu",
    openInbox: "Otevřít inbox",
    recentDocuments: "Nedávné řízené dokumenty",
    recentSearchLabel: "Hledat dokumenty",
    recentSearchPlaceholder: "Dokument, typ, gestor, stav nebo klasifikace",
    noRecentDocuments: "Nenalezen žádný nedávný dokument pro aktuální filtr.",
    all: "Vše",
    clearFilter: "Zrušit filtr",
    closeFilter: "Zavřít filtr",
    filterTitlePrefix: "Filtr",
    noFilterResults: "Nenalezena žádná hodnota.",
    document: "Dokument",
    status: "Stav",
    classification: "Klasifikace",
    updated: "Aktualizováno",
    ingestionAndAudit: "Zpracování a audit",
    hiddenActions: "Akce se zobrazují jen uživatelům, kteří k nim mají oprávnění.",
    publishingVisible: "Publikování je viditelné.",
    publishingHidden: "Publikování je v této relaci skryté.",
    readiness: "Připravenost znalostního workflow",
    registryApi: "Dokumenty",
    registryTitle: "Stav dokumentu je řízený",
    registryDetail: "AKB zobrazuje metadata dokumentů, platnost verzí a dostupné akce podle oprávnění uživatele.",
    ragRetrieval: "Citace",
    ragTitle: "Odpovědi začínají citacemi",
    ragDetail: "Odpovědi musí ukazovat zdrojový dokument, verzi, oddíl, stranu a citovaný úsek.",
    ingestion: "Zpracování",
    ingestionTitle: "Stav zpracování je viditelný",
    ingestionDetail: "Fronta, běžící úlohy, chyby a varování zůstávají viditelné pro správce dokumentů."
  },
  en: {
    metricsLabel: "Dashboard metrics",
    validDocuments: "Valid documents",
    totalControlledRecords: "total controlled records",
    activeIngestion: "Active processing",
    activeIngestionDetail: "Jobs queued or processing",
    failedJobs: "Failed jobs",
    failedJobsDetail: "Requires operations review",
    workflowTasks: "Workflow tasks",
    workflowTasksDetail: "Open reviews, warnings and audit signals",
    openTasks: "Open tasks",
    overdueTasks: "overdue",
    openInbox: "Open inbox",
    recentDocuments: "Recent controlled documents",
    recentSearchLabel: "Search documents",
    recentSearchPlaceholder: "Document, type, owner unit, status, or classification",
    noRecentDocuments: "No recent document matches the current filter.",
    all: "All",
    clearFilter: "Clear filter",
    closeFilter: "Close filter",
    filterTitlePrefix: "Filter",
    noFilterResults: "No value found.",
    document: "Document",
    status: "Status",
    classification: "Classification",
    updated: "Updated",
    ingestionAndAudit: "Processing and audit",
    hiddenActions: "Actions are shown only to users who are allowed to use them.",
    publishingVisible: "Publishing is visible.",
    publishingHidden: "Publishing is hidden in this session.",
    readiness: "Knowledge workflow readiness",
    registryApi: "Documents",
    registryTitle: "Document state is governed",
    registryDetail: "AKB shows document metadata, version validity and available actions according to user permissions.",
    ragRetrieval: "Citations",
    ragTitle: "Citation-first answers",
    ragDetail: "Answers must show source document, version, section, page and cited segment.",
    ingestion: "Processing",
    ingestionTitle: "Processing status is visible",
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
  const [recentQuery, setRecentQuery] = useState("");
  const [recentStatuses, setRecentStatuses] = useState<string[]>([]);
  const [recentClassifications, setRecentClassifications] = useState<string[]>([]);
  const validDocuments = documents.filter((document) => document.status === "valid").length;
  const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "running").length;
  const failedJobs = jobs.filter((job) => job.status === "failed").length;
  const workflowTasks = buildWorkflowTasks({ documents, jobs, auditEvents, registryTasks, nowIso });
  const overdueTasks = workflowTasks.filter((task) => isTaskOverdue(task, nowIso));
  const recentStatusOptions = useMemo(() => Array.from(new Set(documents.slice(0, 12).map((document) => document.status))).sort(), [documents]);
  const recentClassificationOptions = useMemo(
    () => Array.from(new Set(documents.slice(0, 12).map((document) => document.classification))).sort(),
    [documents]
  );
  const recentDocuments = useMemo(() => {
    const normalizedQuery = recentQuery.trim().toLowerCase();
    const rows = documents.slice(0, 12);
    return rows
      .filter((document) => {
        if (recentStatuses.length > 0 && !recentStatuses.includes(document.status)) {
          return false;
        }
        if (recentClassifications.length > 0 && !recentClassifications.includes(document.classification)) {
          return false;
        }
        if (!normalizedQuery) {
          return true;
        }
        const haystack = [
          document.title,
          document.document_id,
          documentTypeLabel(document.document_type, language),
          document.document_type,
          document.gestor_unit ?? "",
          document.owner_id,
          document.status,
          document.classification,
          ...document.tags
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .slice(0, 5);
  }, [documents, language, recentClassifications, recentQuery, recentStatuses]);
  const recentDocumentColumns: Array<StratosDataTableColumn<Document>> = [
    {
      id: "document",
      label: copy.document,
      width: "minmax(260px, 1.4fr)",
      render: (document) => (
        <span className="cell-title">
          <strong>{document.title}</strong>
          <span>{documentTypeLabel(document.document_type, language)} - {document.gestor_unit}</span>
        </span>
      )
    },
    {
      id: "status",
      label: copy.status,
      width: 130,
      render: (document) => <StatusBadge value={document.status} />
    },
    {
      id: "classification",
      label: copy.classification,
      width: 140,
      render: (document) => document.classification
    },
    {
      id: "updated",
      label: copy.updated,
      width: 170,
      render: (document) => formatDateTime(document.updated_at, language)
    }
  ];

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
          <div className="panel__body panel__body--toolbar">
            <div className="table-toolbar">
              <StratosSearchBox
                id="dashboard-recent-documents-search"
                label={copy.recentSearchLabel}
                value={recentQuery}
                placeholder={copy.recentSearchPlaceholder}
                onChange={(event) => setRecentQuery(event.target.value)}
              />
              <StratosSelect
                id="dashboard-recent-status-filter"
                label={copy.status}
                multiple
                placeholder={copy.all}
                clearDescription={copy.clearFilter}
                closeLabel={copy.closeFilter}
                filterTitlePrefix={copy.filterTitlePrefix}
                noResultsLabel={copy.noFilterResults}
                value={recentStatuses}
                onValuesChange={setRecentStatuses}
              >
                {recentStatusOptions.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </StratosSelect>
              <StratosSelect
                id="dashboard-recent-classification-filter"
                label={copy.classification}
                multiple
                placeholder={copy.all}
                clearDescription={copy.clearFilter}
                closeLabel={copy.closeFilter}
                filterTitlePrefix={copy.filterTitlePrefix}
                noResultsLabel={copy.noFilterResults}
                value={recentClassifications}
                onValuesChange={setRecentClassifications}
              >
                {recentClassificationOptions.map((classification) => (
                  <option key={classification} value={classification}>{classification}</option>
                ))}
              </StratosSelect>
            </div>
          </div>
          <StratosDataTable
            rows={recentDocuments}
            columns={recentDocumentColumns}
            getRowId={(document) => document.document_id}
            emptyLabel={copy.noRecentDocuments}
            aria-label={copy.recentDocuments}
          />
        </div>

        <div className="panel">
          <div className="panel__header">
            <h2>{copy.ingestionAndAudit}</h2>
            <StratosButtonLink href="/tasks">
              {copy.openInbox}
              <ArrowUpRight size={15} aria-hidden="true" />
            </StratosButtonLink>
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
