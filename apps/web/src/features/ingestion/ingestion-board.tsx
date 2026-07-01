"use client";

import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

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
    title: "Zpracování dokumentů",
    refresh: "Obnovit",
    document: "Dokument",
    status: "Stav",
    readingMethod: "Způsob čtení",
    result: "Výsledek",
    started: "Zahájeno",
    searchLabel: "Hledat zpracování",
    searchPlaceholder: "Dokument, stav nebo způsob čtení",
    all: "Vše",
    clearFilter: "Zrušit filtr",
    closeFilter: "Zavřít filtr",
    filterTitlePrefix: "Filtr",
    noFilterResults: "Nenalezena žádná hodnota.",
    processing: "AKB dokument zpracovává.",
    noJobs: "Pro aktuální filtr není vidět žádné zpracování dokumentu.",
    queued: "Čeká ve frontě na zpracování.",
    running: "AKB dokument právě čte a připravuje citace.",
    completed: "Dokument je připravený pro vyhledávání, chat a citace.",
    completedWithWarnings: "Dokument je použitelný, ale obsahuje varování pro správce.",
    failed: "Zpracování selhalo. Dokument zatím nemusí být použitelný pro odpovědi a citace.",
    cancelled: "Zpracování bylo zrušeno.",
    noReport: "Průběžné údaje zatím nejsou dostupné.",
    readSummaryPrefix: "Přečteno",
    citationsSummaryPrefix: "Citace",
    pageSingular: "strana",
    pageFew: "strany",
    pagePlural: "stran",
    segmentSingular: "citovatelný úsek",
    segmentFew: "citovatelné úseky",
    segmentPlural: "citovatelných úseků",
    technicalDetails: "Technické údaje pro dohled",
    jobId: "ID zpracování",
    versionId: "ID verze",
    documentId: "ID dokumentu",
    parserProfile: "Profil čtení",
    chunkingStrategy: "Dělení pro citace",
    embeddingProfile: "Embedding profil",
    controlledDocument: "Řízený dokument",
    plainText: "Jednoduchý text",
    ocrHeavy: "Sken nebo OCR dokument",
    legalStructured: "Podle kapitol a odstavců",
    semantic: "Podle významových částí",
    fixedWindow: "Po stejně dlouhých blocích"
  },
  en: {
    title: "Document processing",
    refresh: "Refresh",
    document: "Document",
    status: "Status",
    readingMethod: "Reading method",
    result: "Result",
    started: "Started",
    searchLabel: "Search processing",
    searchPlaceholder: "Document, status, or reading method",
    all: "All",
    clearFilter: "Clear filter",
    closeFilter: "Close filter",
    filterTitlePrefix: "Filter",
    noFilterResults: "No value found.",
    processing: "AKB is processing the document.",
    noJobs: "No document processing matches the current filter.",
    queued: "Waiting in the processing queue.",
    running: "AKB is reading the document and preparing citations.",
    completed: "The document is ready for search, chat, and citations.",
    completedWithWarnings: "The document is usable, but includes warnings for an administrator.",
    failed: "Processing failed. The document may not yet be usable for answers and citations.",
    cancelled: "Processing was cancelled.",
    noReport: "Progress details are not available yet.",
    readSummaryPrefix: "Read",
    citationsSummaryPrefix: "Citations",
    pageSingular: "page",
    pageFew: "pages",
    pagePlural: "pages",
    segmentSingular: "citation segment",
    segmentFew: "citation segments",
    segmentPlural: "citation segments",
    technicalDetails: "Technical details for operations",
    jobId: "Processing ID",
    versionId: "Version ID",
    documentId: "Document ID",
    parserProfile: "Reading profile",
    chunkingStrategy: "Citation splitting",
    embeddingProfile: "Embedding profile",
    controlledDocument: "Controlled document",
    plainText: "Plain text",
    ocrHeavy: "Scanned or OCR document",
    legalStructured: "By chapters and paragraphs",
    semantic: "By semantic sections",
    fixedWindow: "By fixed-size blocks"
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
        job.status,
        processingStatusText(job, copy),
        statusSelectLabel(job.status, copy),
        parserProfileLabel(job.parser_profile, copy),
        chunkingStrategyLabel(job.chunking_strategy, copy),
        documentTitle
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [documentById, jobs, query, selectedProfiles, selectedStatuses]);
  const columns: Array<StratosDataTableColumn<IngestionJob>> = [
    {
      id: "document",
      label: copy.document,
      width: "minmax(260px, 1.3fr)",
      render: (job) => (
        <span className="cell-title">
          <strong>{documentById.get(job.document_id)?.title ?? copy.document}</strong>
          <span>{processingStatusText(job, copy)}</span>
        </span>
      )
    },
    {
      id: "status",
      label: copy.status,
      width: 150,
      render: (job) => <StatusBadge value={job.status} />
    },
    {
      id: "profile",
      label: copy.readingMethod,
      width: "minmax(190px, 0.9fr)",
      render: (job) => (
        <span className="cell-title">
          <strong>{parserProfileLabel(job.parser_profile, copy)}</strong>
          <span>{chunkingStrategyLabel(job.chunking_strategy, copy)}</span>
        </span>
      )
    },
    {
      id: "result",
      label: copy.result,
      width: "minmax(260px, 1.4fr)",
      render: (job) => {
        const report = reportByJobId.get(job.job_id);
        return (
          <span className="cell-title">
            <strong>{processingResultText(job, report, copy, language)}</strong>
            <TechnicalDetails copy={copy} job={job} />
          </span>
        );
      }
    },
    {
      id: "started",
      label: copy.started,
      width: 170,
      render: (job) => formatDateTime(job.started_at ?? job.created_at, language)
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
              <option key={status} value={status}>{statusSelectLabel(status, copy)}</option>
            ))}
          </StratosSelect>
          <StratosSelect
            id="ingestion-profile-filter"
            label={copy.readingMethod}
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
              <option key={profile} value={profile}>{parserProfileLabel(profile as IngestionJob["parser_profile"], copy)}</option>
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

function parserProfileLabel(profile: IngestionJob["parser_profile"], copy: Record<string, string>): string {
  if (profile === "controlled_document") return copy.controlledDocument;
  if (profile === "plain_text") return copy.plainText;
  if (profile === "ocr_heavy") return copy.ocrHeavy;
  return profile;
}

function chunkingStrategyLabel(strategy: IngestionJob["chunking_strategy"], copy: Record<string, string>): string {
  if (strategy === "legal_structured") return copy.legalStructured;
  if (strategy === "semantic") return copy.semantic;
  if (strategy === "fixed_window") return copy.fixedWindow;
  return strategy;
}

function processingStatusText(job: IngestionJob, copy: Record<string, string>): string {
  if (job.status === "queued") return copy.queued;
  if (job.status === "running") return copy.running;
  if (job.status === "completed") return copy.completed;
  if (job.status === "completed_with_warnings") return copy.completedWithWarnings;
  if (job.status === "failed") return copy.failed;
  if (job.status === "cancelled") return copy.cancelled;
  return copy.processing;
}

function processingResultText(
  job: IngestionJob,
  report: IngestionReport | undefined,
  copy: Record<string, string>,
  language: AklLanguage
): string {
  if (!report) {
    return processingStatusText(job, copy);
  }
  const pages = formatNumber(report.pages_processed, language);
  const chunks = formatNumber(report.chunks_created, language);
  const pageLabel = localizedCountLabel(report.pages_processed, copy.pageSingular, copy.pageFew, copy.pagePlural);
  const chunkLabel = localizedCountLabel(report.chunks_created, copy.segmentSingular, copy.segmentFew, copy.segmentPlural);
  return `${copy.readSummaryPrefix}: ${pages} ${pageLabel}. ${copy.citationsSummaryPrefix}: ${chunks} ${chunkLabel}.`;
}

function localizedCountLabel(count: number, singular: string, few: string, plural: string): string {
  if (count === 1) return singular;
  if (count >= 2 && count <= 4) return few;
  return plural;
}

function statusSelectLabel(status: IngestionJob["status"], copy: Record<string, string>): string {
  if (status === "queued") return copy.queued;
  if (status === "running") return copy.running;
  if (status === "completed") return copy.completed;
  if (status === "completed_with_warnings") return copy.completedWithWarnings;
  if (status === "failed") return copy.failed;
  if (status === "cancelled") return copy.cancelled;
  return status;
}

function TechnicalDetails({ copy, job }: { copy: Record<string, string>; job: IngestionJob }) {
  return (
    <details className="technical-details technical-details--compact">
      <summary>{copy.technicalDetails}</summary>
      <div className="technical-details__body">
        <div className="technical-details__line">
          <strong>{copy.jobId}</strong>
          <span>{job.job_id}</span>
        </div>
        <div className="technical-details__line">
          <strong>{copy.versionId}</strong>
          <span>{job.document_version_id}</span>
        </div>
        <div className="technical-details__line">
          <strong>{copy.documentId}</strong>
          <span>{job.document_id}</span>
        </div>
        <div className="technical-details__line">
          <strong>{copy.parserProfile}</strong>
          <span>{job.parser_profile}</span>
        </div>
        <div className="technical-details__line">
          <strong>{copy.chunkingStrategy}</strong>
          <span>{job.chunking_strategy}</span>
        </div>
        <div className="technical-details__line">
          <strong>{copy.embeddingProfile}</strong>
          <span>{job.embedding_profile}</span>
        </div>
      </div>
    </details>
  );
}
