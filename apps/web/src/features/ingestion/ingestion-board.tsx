"use client";

import { Ban, RefreshCw } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
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
    pages: "stran",
    chunks: "chunků",
    processing: "Zpracovává se",
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
    pages: "pages",
    chunks: "chunks",
    processing: "Processing",
    cancel: "Cancel"
  }
} satisfies Record<AklLanguage, Record<string, string>>;

export function IngestionBoard({ documents, jobs, reports }: IngestionBoardProps) {
  const { language } = useLanguage();
  const copy = ingestionCopy[language];
  const documentById = new Map(documents.map((document) => [document.document_id, document]));
  const reportByJobId = new Map(reports.map((report) => [report.job_id, report]));

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>{copy.title}</h2>
        <button className="button" type="button">
          <RefreshCw size={16} aria-hidden="true" />
          {copy.refresh}
        </button>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>{copy.job}</th>
            <th>{copy.document}</th>
            <th>{copy.status}</th>
            <th>{copy.profile}</th>
            <th>{copy.progress}</th>
            <th>{copy.started}</th>
            <th>{copy.action}</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const report = reportByJobId.get(job.job_id);
            const document = documentById.get(job.document_id);
            return (
              <tr key={job.job_id}>
                <td>
                  <span className="cell-title">
                    <strong>{job.job_id}</strong>
                    <span>{job.document_version_id}</span>
                  </span>
                </td>
                <td>{document?.title ?? job.document_id}</td>
                <td>
                  <StatusBadge value={job.status} />
                </td>
                <td>{job.parser_profile} / {job.chunking_strategy}</td>
                <td>
                  {report ? (
                    <span>
                      {formatNumber(report.pages_processed, language)} {copy.pages}, {formatNumber(report.chunks_created, language)} {copy.chunks}
                    </span>
                  ) : (
                    <span>{copy.processing}</span>
                  )}
                </td>
                <td>{formatDateTime(job.started_at ?? job.created_at, language)}</td>
                <td>
                  <button className="icon-button" type="button" aria-label={`${copy.cancel} ${job.job_id}`} disabled={job.status !== "running"}>
                    <Ban size={16} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
