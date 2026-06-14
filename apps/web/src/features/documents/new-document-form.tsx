"use client";

import { useState } from "react";
import { Save } from "lucide-react";

import { StratosButton, StratosSelect } from "@/components/stratos";
import { withAppBasePath } from "@/lib/app-url";
import { documentTypeLabel } from "@/lib/format";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import type { AuthorizationHint, Document } from "@/lib/types";

interface NewDocumentFormProps {
  authorization: AuthorizationHint;
}

const newDocumentCopy = {
  cs: {
    title: "Založení dokumentu",
    titleLabel: "Název",
    titlePlaceholder: "Název dokumentu",
    type: "Typ dokumentu",
    classification: "Klasifikace",
    gestorUnit: "Gestorská jednotka",
    tags: "Štítky",
    saving: "Ukládám",
    save: "Založit dokument",
    registryError: "Založení dokumentu selhalo s HTTP",
    disabled: "Založení dokumentu není pro tuto relaci povolené.",
    created: "Vytvořeno",
    continue: "Pokračujte nahráním originálního souboru jako první verze.",
    public: "veřejné",
    internal: "interní",
    restricted: "omezené",
    confidential: "důvěrné"
  },
  en: {
    title: "Create document",
    titleLabel: "Title",
    titlePlaceholder: "Document title",
    type: "Document type",
    classification: "Classification",
    gestorUnit: "Gestor unit",
    tags: "Tags",
    saving: "Saving",
    save: "Create document",
    registryError: "Document creation failed with HTTP",
    disabled: "Document creation is not allowed for this session.",
    created: "Created",
    continue: "Continue by uploading the original file as the first version.",
    public: "public",
    internal: "internal",
    restricted: "restricted",
    confidential: "confidential"
  }
} satisfies Record<AklLanguage, Record<string, string>>;

export function NewDocumentForm({ authorization }: NewDocumentFormProps) {
  const { language } = useLanguage();
  const copy = newDocumentCopy[language];
  const [created, setCreated] = useState<Document | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>{copy.title}</h2>
      </div>
      <form
        className="panel__body form-grid"
        onSubmit={async (event) => {
          event.preventDefault();
          setSubmitting(true);
          setError(null);
          const form = new FormData(event.currentTarget);
          const response = await fetch(withAppBasePath("/api/controlled-document/documents"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(Object.fromEntries(form.entries()))
          });
          setSubmitting(false);
          if (!response.ok) {
            setError(`${copy.registryError} ${response.status}.`);
            return;
          }
          const payload = (await response.json()) as { document: Document };
          setCreated(payload.document);
        }}
      >
        <div className="form-grid form-grid--two">
          <div className="field">
            <label htmlFor="title">{copy.titleLabel}</label>
            <input id="title" name="title" placeholder={copy.titlePlaceholder} required />
          </div>
          <StratosSelect id="type" name="document_type" label={copy.type} defaultValue="directive">
              {["directive", "methodology", "policy", "manual", "project_documentation"].map((value) => (
                <option key={value} value={value}>{documentTypeLabel(value, language)}</option>
              ))}
          </StratosSelect>
        </div>
        <div className="form-grid form-grid--two">
          <StratosSelect id="classification" name="classification" label={copy.classification} defaultValue="internal">
              <option value="public">{copy.public}</option>
              <option value="internal">{copy.internal}</option>
              <option value="restricted">{copy.restricted}</option>
              <option value="confidential">{copy.confidential}</option>
          </StratosSelect>
          <div className="field">
            <label htmlFor="gestor">{copy.gestorUnit}</label>
            <input id="gestor" name="gestor_unit" placeholder="IT" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="tags">{copy.tags}</label>
          <input id="tags" name="tags" defaultValue="controlled-document,akb" />
        </div>
        <StratosButton tone="primary" type="submit" disabled={!authorization.can_update || submitting}>
          <Save size={16} aria-hidden="true" />
          {submitting ? copy.saving : copy.save}
        </StratosButton>
        {!authorization.can_update ? (
          <p className="notice">{copy.disabled}</p>
        ) : null}
        {created ? <p className="notice">{copy.created} {created.document_id}. {copy.continue}</p> : null}
        {error ? <p className="notice">{error}</p> : null}
      </form>
    </section>
  );
}
