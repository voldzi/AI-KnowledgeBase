"use client";

import { useState } from "react";
import { Save } from "lucide-react";

import type { AuthorizationHint, Document } from "@/lib/types";

interface NewDocumentFormProps {
  authorization: AuthorizationHint;
}

export function NewDocumentForm({ authorization }: NewDocumentFormProps) {
  const [created, setCreated] = useState<Document | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Draft metadata</h2>
      </div>
      <form
        className="panel__body form-grid"
        onSubmit={async (event) => {
          event.preventDefault();
          setSubmitting(true);
          setError(null);
          const form = new FormData(event.currentTarget);
          const response = await fetch("/api/controlled-document/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(Object.fromEntries(form.entries()))
          });
          setSubmitting(false);
          if (!response.ok) {
            setError(`Registry API returned HTTP ${response.status}.`);
            return;
          }
          const payload = (await response.json()) as { document: Document };
          setCreated(payload.document);
        }}
      >
        <div className="form-grid form-grid--two">
          <div className="field">
            <label htmlFor="title">Title</label>
            <input id="title" name="title" placeholder="Document title" required />
          </div>
          <div className="field">
            <label htmlFor="type">Document type</label>
            <select id="type" name="document_type" defaultValue="directive">
              <option value="directive">directive</option>
              <option value="methodology">methodology</option>
              <option value="policy">policy</option>
              <option value="manual">manual</option>
            </select>
          </div>
        </div>
        <div className="form-grid form-grid--two">
          <div className="field">
            <label htmlFor="classification">Classification</label>
            <select id="classification" name="classification" defaultValue="internal">
              <option value="public">public</option>
              <option value="internal">internal</option>
              <option value="restricted">restricted</option>
              <option value="confidential">confidential</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="gestor">Gestor unit</label>
            <input id="gestor" name="gestor_unit" placeholder="IT" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="tags">Tags</label>
          <input id="tags" name="tags" defaultValue="controlled-document,phase02" />
        </div>
        <button className="button button--primary" type="submit" disabled={!authorization.can_update || submitting}>
          <Save size={16} aria-hidden="true" />
          {submitting ? "Saving" : "Save draft metadata"}
        </button>
        {!authorization.can_update ? (
          <p className="notice">Action disabled because Registry API did not grant document.update.</p>
        ) : null}
        {created ? <p className="notice">Created {created.document_id}. Continue with upload/version ingestion.</p> : null}
        {error ? <p className="notice">{error}</p> : null}
      </form>
    </section>
  );
}
