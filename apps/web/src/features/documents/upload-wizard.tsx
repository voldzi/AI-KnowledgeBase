"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, FileUp, Play, ShieldCheck } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import type { AuthorizationHint, Document, DocumentVersion, IngestionJob } from "@/lib/types";

interface UploadWizardProps {
  documents: Document[];
  authorization: AuthorizationHint;
}

export function UploadWizard({ documents, authorization }: UploadWizardProps) {
  const [selectedDocumentId, setSelectedDocumentId] = useState(documents[0]?.document_id ?? "");
  const [submitted, setSubmitted] = useState<{ version: DocumentVersion; job: IngestionJob } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const selectedDocument = useMemo(
    () => documents.find((document) => document.document_id === selectedDocumentId),
    [documents, selectedDocumentId]
  );

  if (!authorization.can_ingest) {
    return (
      <section className="panel">
        <div className="empty-state">
          <ShieldCheck size={24} aria-hidden="true" />
          Upload actions are hidden because Registry API did not grant document.ingest.
        </div>
      </section>
    );
  }

  return (
    <section className="grid grid--two">
      <form
        className="panel"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitting(true);
          setError(null);
          const form = new FormData(event.currentTarget);
          const payload = {
            ...Object.fromEntries(form.entries()),
            document_id: selectedDocumentId
          };
          fetch("/api/controlled-document/ingestion", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          })
            .then(async (response) => {
              setSubmitting(false);
              if (!response.ok) {
                setError(`Workflow API returned HTTP ${response.status}.`);
                return;
              }
              setSubmitted((await response.json()) as { version: DocumentVersion; job: IngestionJob });
            })
            .catch((reason: unknown) => {
              setSubmitting(false);
              setError(reason instanceof Error ? reason.message : "Workflow request failed.");
            });
        }}
      >
        <div className="panel__header">
          <h2>Upload wizard</h2>
          <FileUp size={18} aria-hidden="true" />
        </div>
        <div className="panel__body form-grid">
          <div className="field">
            <label htmlFor="document">Document</label>
            <select id="document" value={selectedDocumentId} onChange={(event) => setSelectedDocumentId(event.target.value)}>
              {documents.map((document) => (
                <option key={document.document_id} value={document.document_id}>{document.title}</option>
              ))}
            </select>
          </div>
          <div className="form-grid form-grid--two">
            <div className="field">
            <label htmlFor="version">Version label</label>
              <input id="version" name="version_label" placeholder="1.1" defaultValue="0.1" />
            </div>
            <div className="field">
              <label htmlFor="valid-from">Valid from</label>
              <input id="valid-from" name="valid_from" type="date" defaultValue="2026-06-05" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="source-uri">Source file URI</label>
            <input id="source-uri" name="source_file_uri" defaultValue={`s3://akl-documents/${selectedDocumentId}/draft/file.md`} />
          </div>
          <div className="form-grid form-grid--two">
            <div className="field">
              <label htmlFor="parser">Parser profile</label>
              <select id="parser" name="parser_profile" defaultValue="controlled_document">
                <option value="controlled_document">controlled_document</option>
                <option value="plain_text">plain_text</option>
                <option value="ocr_heavy">ocr_heavy</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="chunking">Chunking strategy</label>
              <select id="chunking" name="chunking_strategy" defaultValue="legal_structured">
                <option value="legal_structured">legal_structured</option>
                <option value="semantic">semantic</option>
                <option value="fixed_window">fixed_window</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="summary">Change summary</label>
            <textarea id="summary" name="change_summary" defaultValue="Nova verze pripravena k ingestion pipeline." />
          </div>
          <input type="hidden" name="embedding_profile" value="default" />
          <button className="button button--primary" type="submit" disabled={!selectedDocumentId || submitting}>
            <Play size={16} aria-hidden="true" />
            {submitting ? "Queueing" : "Create version and queue ingestion"}
          </button>
          {error ? <p className="notice">{error}</p> : null}
        </div>
      </form>

      <aside className="panel">
        <div className="panel__header">
          <h2>Validation preview</h2>
          {submitted ? <StatusBadge value={submitted.job.status} /> : <StatusBadge value="draft" />}
        </div>
        <div className="panel__body stack">
          <div className="timeline-item">
            <strong>Selected document</strong>
            <span>{selectedDocument?.title ?? "No document selected"}</span>
          </div>
          <div className="timeline-item">
            <strong>Boundary check</strong>
            <span>Upload uses signed object storage URI only. Frontend does not call MinIO internals.</span>
          </div>
          <div className="timeline-item">
            <strong>Authorization</strong>
            <span>Visible because Registry API authorization grants document.ingest.</span>
          </div>
          {submitted ? (
            <div className="notice">
              <CheckCircle2 size={16} aria-hidden="true" /> Created version {submitted.version.document_version_id} and
              queued ingestion job {submitted.job.job_id}.
            </div>
          ) : null}
        </div>
      </aside>
    </section>
  );
}
