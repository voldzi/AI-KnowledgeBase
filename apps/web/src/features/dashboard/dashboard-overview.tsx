import { AlertTriangle, Bot, CheckCircle2, FileText, UploadCloud } from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import type { AuditEvent, AuthorizationHint, Document, IngestionJob } from "@/lib/types";
import { documentTypeLabel, formatDateTime } from "@/lib/format";

interface DashboardOverviewProps {
  documents: Document[];
  jobs: IngestionJob[];
  auditEvents: AuditEvent[];
  authorization: AuthorizationHint;
}

export function DashboardOverview({ documents, jobs, auditEvents, authorization }: DashboardOverviewProps) {
  const validDocuments = documents.filter((document) => document.status === "valid").length;
  const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "running").length;
  const failedJobs = jobs.filter((job) => job.status === "failed").length;
  const restrictedDocuments = documents.filter((document) => document.classification === "restricted").length;

  return (
    <div className="stack">
      <section className="grid grid--metrics" aria-label="Dashboard metrics">
        <MetricCard
          detail={`${documents.length} total controlled records`}
          icon={FileText}
          label="Valid documents"
          tone="success"
          value={String(validDocuments)}
        />
        <MetricCard
          detail="Jobs queued or processing"
          icon={UploadCloud}
          label="Active ingestion"
          tone="attention"
          value={String(activeJobs)}
        />
        <MetricCard
          detail="Requires operations review"
          icon={AlertTriangle}
          label="Failed jobs"
          tone={failedJobs > 0 ? "danger" : "default"}
          value={String(failedJobs)}
        />
        <MetricCard
          detail="Document-level access applies"
          icon={CheckCircle2}
          label="Restricted docs"
          value={String(restrictedDocuments)}
        />
      </section>

      <section className="grid grid--two">
        <div className="panel">
          <div className="panel__header">
            <h2>Recent controlled documents</h2>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Status</th>
                <th>Classification</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {documents.slice(0, 5).map((document) => (
                <tr key={document.document_id}>
                  <td>
                    <span className="cell-title">
                      <strong>{document.title}</strong>
                      <span>{documentTypeLabel(document.document_type)} - {document.gestor_unit}</span>
                    </span>
                  </td>
                  <td>
                    <StatusBadge value={document.status} />
                  </td>
                  <td>{document.classification}</td>
                  <td>{formatDateTime(document.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel__header">
            <h2>Ingestion and audit</h2>
          </div>
          <div className="panel__body stack">
            <div className="timeline">
              {jobs.slice(0, 3).map((job) => (
                <div className="timeline-item" key={job.job_id}>
                  <strong>
                    {job.job_id} <StatusBadge value={job.status} />
                  </strong>
                  <span>{job.document_id} - {job.chunking_strategy} - {formatDateTime(job.created_at)}</span>
                </div>
              ))}
            </div>
            <div className="notice">
              UI actions are hidden from users without permission hints from Registry API.
              {authorization.can_publish ? " Publishing is visible." : " Publishing is hidden in this session."}
            </div>
            <div className="timeline">
              {auditEvents.slice(0, 2).map((event) => (
                <div className="timeline-item" key={event.audit_event_id}>
                  <strong>{event.event_type}</strong>
                  <span>{event.actor_id} - {formatDateTime(event.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>Knowledge workflow readiness</h2>
          <Bot size={18} aria-hidden="true" />
        </div>
        <div className="panel__body grid grid--three">
          <div>
            <p className="eyebrow">Registry API</p>
            <h3>Document state is authoritative</h3>
            <p className="muted">Frontend reads document metadata, version validity and authz hints from Registry API.</p>
          </div>
          <div>
            <p className="eyebrow">RAG Retrieval</p>
            <h3>Citation-first answers</h3>
            <p className="muted">Answers must show source document, version, section path, page and chunk id.</p>
          </div>
          <div>
            <p className="eyebrow">Ingestion</p>
            <h3>Pipeline status is visible</h3>
            <p className="muted">Queued, running, failed and warning states stay visible to document managers.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
