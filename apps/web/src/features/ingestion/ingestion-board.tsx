import { Ban, RefreshCw } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import type { Document, IngestionJob, IngestionReport } from "@/lib/types";
import { formatDateTime, formatNumber } from "@/lib/format";

interface IngestionBoardProps {
  documents: Document[];
  jobs: IngestionJob[];
  reports: IngestionReport[];
}

export function IngestionBoard({ documents, jobs, reports }: IngestionBoardProps) {
  const documentById = new Map(documents.map((document) => [document.document_id, document]));
  const reportByJobId = new Map(reports.map((report) => [report.job_id, report]));

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Ingestion jobs</h2>
        <button className="button" type="button">
          <RefreshCw size={16} aria-hidden="true" />
          Refresh
        </button>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Job</th>
            <th>Document</th>
            <th>Status</th>
            <th>Profile</th>
            <th>Progress report</th>
            <th>Started</th>
            <th>Action</th>
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
                      {formatNumber(report.pages_processed)} pages, {formatNumber(report.chunks_created)} chunks
                    </span>
                  ) : (
                    <span>Processing</span>
                  )}
                </td>
                <td>{formatDateTime(job.started_at ?? job.created_at)}</td>
                <td>
                  <button className="icon-button" type="button" aria-label={`Cancel ${job.job_id}`} disabled={job.status !== "running"}>
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
