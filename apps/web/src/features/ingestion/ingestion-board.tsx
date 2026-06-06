"use client";

import { useMemo, useState } from "react";
import { Ban, RefreshCw } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { StratosButton, StratosDataTable, StratosSearchBox, StratosSelect, type StratosDataTableColumn } from "@/components/stratos";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import type { Document, IngestionJob, IngestionReport } from "@/lib/types";
import { formatDateTime, formatNumber } from "@/lib/format";

interface IngestionBoardProps {
  documents: Document[];
  jobs: IngestionJob[];
  reports: IngestionReport[];
}

const ingestionCopy = {
  cs: {
    title: "Ingestion úlohy",
    refresh: "Obnovit",
    job: "Úloha",
    document: "Dokument",
    status: "Stav",
    profile: "Profil",
    progress: "Průběh",
    started: "Spuštěno",
    action: "Akce",
    searchLabel: "Hledat úlohy",
    searchPlaceholder: "Úloha, dokument, stav, profil nebo strategie",
    all: "Vše",
    clearFilter: "Zrušit filtr",
    closeFilter: "Zavřít filtr",
    filterTitlePrefix: "Filtr",
    noFilterResults: "Nenalezena žádná hodnota.",
    pages: "stran",
    chunks: "chunků",
    processing: "Zpracovává se",
    noJobs: "Nenalezena žádná ingestion úloha pro aktuální filtr.",
    cancel: "Zrušit"
  },
  en: {
    title: "Ingestion jobs",
    refresh: "Refresh",
    job: "Job",
    document: "Document",
    status: "Status",
    profile: "Profile",
    progress: "Progress report",
    started: "Started",
    action: "Action",
    searchLabel: "Search jobs",
    searchPlaceholder: "Job, document, status, profile, or strategy",
    all: "All",
    clearFilter: "Clear filter",
    closeFilter: "Close filter",
    filterTitlePrefix: "Filter",
    noFilterResults: "No value found.",
    pages: "pages",
    chunks: "chunks",
    processing: "Processing",
    noJobs: "No ingestion job matches the current filter.",
    cancel: "Cancel"
  }
} satisfies Record<AklLanguage, Record<string, string>>;

export function IngestionBoard({ documents, jobs, reports }: IngestionBoardProps) {
  const { language } = useLanguage();
  const copy = ingestionCopy[language];
  const [query, setQuery] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);
  const documentById = useMemo(() => new Map(documents.map((document) => [document.document_id, document])), [documents]);
  const reportByJobId = useMemo(() => new Map(reports.map((report) => [report.job_id, report])), [reports]);
  const statusOptions = useMemo(() => Array.from(new Set(jobs.map((job) => job.status))).sort(), [jobs]);
  const profileOptions = useMemo(() => Array.from(new Set(jobs.map((job) => job.parser_profile))).sort(), [jobs]);
  const filteredJobs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return jobs.filter((job) => {
      if (selectedStatuses.length > 0 && !selectedStatuses.includes(job.status)) {
        return false;
      }
      if (selectedProfiles.length > 0 && !selectedProfiles.includes(job.parser_profile)) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const documentTitle = documentById.get(job.document_id)?.title ?? "";
      const haystack = [
        job.job_id,
        job.document_id,
        job.document_version_id,
        job.status,
        job.parser_profile,
        job.chunking_strategy,
        documentTitle
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [documentById, jobs, query, selectedProfiles, selectedStatuses]);
  const columns: Array<StratosDataTableColumn<IngestionJob>> = [
    {
      id: "job",
      label: copy.job,
      width: "minmax(170px, 1fr)",
      render: (job) => (
        <span className="cell-title">
          <strong>{job.job_id}</strong>
          <span>{job.document_version_id}</span>
        </span>
      )
    },
    {
      id: "document",
      label: copy.document,
      width: "minmax(220px, 1.2fr)",
      render: (job) => documentById.get(job.document_id)?.title ?? job.document_id
    },
    {
      id: "status",
      label: copy.status,
      width: 132,
      render: (job) => <StatusBadge value={job.status} />
    },
    {
      id: "profile",
      label: copy.profile,
      width: "minmax(170px, 1fr)",
      render: (job) => `${job.parser_profile} / ${job.chunking_strategy}`
    },
    {
      id: "progress",
      label: copy.progress,
      width: "minmax(170px, 1fr)",
      render: (job) => {
        const report = reportByJobId.get(job.job_id);
        return report
          ? `${formatNumber(report.pages_processed, language)} ${copy.pages}, ${formatNumber(report.chunks_created, language)} ${copy.chunks}`
          : copy.processing;
      }
    },
    {
      id: "started",
      label: copy.started,
      width: 170,
      render: (job) => formatDateTime(job.started_at ?? job.created_at, language)
    },
    {
      id: "action",
      label: copy.action,
      width: 110,
      align: "center",
      render: (job) => (
        <button className="icon-button" type="button" aria-label={`${copy.cancel} ${job.job_id}`} disabled={job.status !== "running"}>
          <Ban size={16} aria-hidden="true" />
        </button>
      )
    }
  ];

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>{copy.title}</h2>
        <StratosButton type="button">
          <RefreshCw size={16} aria-hidden="true" />
          {copy.refresh}
        </StratosButton>
      </div>
      <div className="panel__body stack">
        <div className="table-toolbar">
          <StratosSearchBox
            id="ingestion-board-search"
            label={copy.searchLabel}
            value={query}
            placeholder={copy.searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
          />
          <StratosSelect
            id="ingestion-status-filter"
            label={copy.status}
            multiple
            placeholder={copy.all}
            clearDescription={copy.clearFilter}
            closeLabel={copy.closeFilter}
            filterTitlePrefix={copy.filterTitlePrefix}
            noResultsLabel={copy.noFilterResults}
            value={selectedStatuses}
            onValuesChange={setSelectedStatuses}
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </StratosSelect>
          <StratosSelect
            id="ingestion-profile-filter"
            label={copy.profile}
            multiple
            placeholder={copy.all}
            clearDescription={copy.clearFilter}
            closeLabel={copy.closeFilter}
            filterTitlePrefix={copy.filterTitlePrefix}
            noResultsLabel={copy.noFilterResults}
            value={selectedProfiles}
            onValuesChange={setSelectedProfiles}
          >
            {profileOptions.map((profile) => (
              <option key={profile} value={profile}>{profile}</option>
            ))}
          </StratosSelect>
        </div>
        <StratosDataTable
          rows={filteredJobs}
          columns={columns}
          getRowId={(job) => job.job_id}
          emptyLabel={copy.noJobs}
          aria-label={copy.title}
        />
      </div>
    </section>
  );
}
