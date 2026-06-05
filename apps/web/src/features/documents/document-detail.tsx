import Link from "next/link";
import { ArrowLeft, CircleCheck, FileClock, UploadCloud } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import type { AuthorizationHint, Document, DocumentVersion, IngestionJob } from "@/lib/types";
import { documentTypeLabel, formatDate, formatDateTime } from "@/lib/format";

interface DocumentDetailProps {
  document: Document;
  versions: DocumentVersion[];
  jobs: IngestionJob[];
  authorization: AuthorizationHint;
}

export function DocumentDetail({ document, versions, jobs, authorization }: DocumentDetailProps) {
  const relatedJobs = jobs.filter((job) => job.document_id === document.document_id);
  const currentVersion = versions.find((version) => version.status === "valid") ?? versions[0];

  return (
    <div className="stack">
      <Link className="button" href="/documents">
        <ArrowLeft size={16} aria-hidden="true" />
        Back to registry
      </Link>

      <section className="panel">
        <div className="panel__body grid grid--two">
          <div className="stack">
            <div>
              <p className="eyebrow">{documentTypeLabel(document.document_type)}</p>
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
            <p className="notice">
              Frontend displays document validity and actions from Registry API only. It does not infer authoritative
              authorization locally.
            </p>
          </div>
          <div className="stack">
            <div className="timeline-item">
              <strong>Owner</strong>
              <span>{document.owner_id}</span>
            </div>
            <div className="timeline-item">
              <strong>Updated</strong>
              <span>{formatDateTime(document.updated_at)}</span>
            </div>
            <div className="timeline-item">
              <strong>Current version</strong>
              <span>{currentVersion ? `${currentVersion.version_label} valid from ${formatDate(currentVersion.valid_from)}` : "No version"}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid--two">
        <div className="panel" id="versions">
          <div className="panel__header">
            <h2>Version history</h2>
            {authorization.can_ingest ? (
              <Link className="button" href="/upload">
                <UploadCloud size={16} aria-hidden="true" />
                Upload
              </Link>
            ) : null}
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th>Validity</th>
                <th>Change summary</th>
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
                  <td>{formatDate(version.valid_from)} - {formatDate(version.valid_to)}</td>
                  <td>{version.change_summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel__header">
            <h2>Ingestion status</h2>
            <FileClock size={18} aria-hidden="true" />
          </div>
          <div className="panel__body timeline">
            {relatedJobs.length > 0 ? (
              relatedJobs.map((job) => (
                <div className="timeline-item" key={job.job_id}>
                  <strong>
                    {job.job_id} <StatusBadge value={job.status} />
                  </strong>
                  <span>{job.chunking_strategy} - created {formatDateTime(job.created_at)}</span>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <CircleCheck size={22} aria-hidden="true" />
                No ingestion job is currently linked to this document.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
