"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Archive,
  ArrowUpRight,
  CheckCircle2,
  FilePlus2,
  FileSearch,
  Filter,
  History,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  UploadCloud,
  X
} from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import type { AuthorizationHint, Classification, Document, DocumentStatus, DocumentType } from "@/lib/types";
import { documentTypeLabel, formatDateTime } from "@/lib/format";

interface DocumentRegistryProps {
  documents: Document[];
  authorization: AuthorizationHint;
}

const registryCopy = {
  cs: {
    title: "Registr dokumentů",
    summaryTitle: "Stav řízené dokumentace",
    newDraft: "Nový koncept",
    uploadVersion: "Nahrát verzi",
    searchLabel: "Hledat",
    searchPlaceholder: "Název, ID, gestor, vlastník nebo štítek",
    view: "Pohled",
    statusFilter: "Stav",
    typeFilter: "Typ",
    classificationFilter: "Klasifikace",
    clearFilters: "Vyčistit",
    all: "Vše",
    allViews: "Všechny dokumenty",
    reviewQueue: "Fronta revize",
    validKnowledge: "Platná znalost",
    restrictedView: "Omezené zdroje",
    archiveView: "Archiv",
    totalDocuments: "Dokumenty",
    totalDocumentsDetail: "v registru",
    validDocuments: "Platné",
    validDocumentsDetail: "publikované zdroje",
    reviewDocuments: "K revizi",
    reviewDocumentsDetail: "koncepty a revize",
    restrictedDocuments: "Citlivé",
    restrictedDocumentsDetail: "omezené nebo důvěrné",
    showing: "Zobrazeno",
    of: "z",
    noResults: "Nenalezen žádný dokument pro aktuální filtr.",
    titleColumn: "Název",
    type: "Typ",
    status: "Stav",
    classification: "Klasifikace",
    owner: "Vlastník",
    tags: "Štítky",
    updated: "Aktualizováno",
    open: "Otevřít",
    openDocument: "Otevřít dokument",
    viewVersions: "Zobrazit verze dokumentu"
  },
  en: {
    title: "Document registry",
    summaryTitle: "Controlled-document state",
    newDraft: "New draft",
    uploadVersion: "Upload version",
    searchLabel: "Search",
    searchPlaceholder: "Title, ID, owner unit, owner or tag",
    view: "View",
    statusFilter: "Status",
    typeFilter: "Type",
    classificationFilter: "Classification",
    clearFilters: "Clear",
    all: "All",
    allViews: "All documents",
    reviewQueue: "Review queue",
    validKnowledge: "Valid knowledge",
    restrictedView: "Restricted sources",
    archiveView: "Archive",
    totalDocuments: "Documents",
    totalDocumentsDetail: "in registry",
    validDocuments: "Valid",
    validDocumentsDetail: "published sources",
    reviewDocuments: "Review",
    reviewDocumentsDetail: "drafts and reviews",
    restrictedDocuments: "Sensitive",
    restrictedDocumentsDetail: "restricted or confidential",
    showing: "Showing",
    of: "of",
    noResults: "No document matches the current filter.",
    titleColumn: "Title",
    type: "Type",
    status: "Status",
    classification: "Classification",
    owner: "Owner",
    tags: "Tags",
    updated: "Updated",
    open: "Open",
    openDocument: "Open document",
    viewVersions: "View versions for"
  }
} satisfies Record<AklLanguage, Record<string, string>>;

type RegistryView = "all" | "review" | "valid" | "restricted" | "archive";

const documentStatuses: DocumentStatus[] = ["draft", "review", "approved", "valid", "superseded", "archived", "cancelled"];
const classifications: Classification[] = ["public", "internal", "restricted", "confidential"];
const documentTypes: DocumentType[] = [
  "directive",
  "regulation",
  "methodology",
  "policy",
  "procedure",
  "manual",
  "knowledge_base_article",
  "project_documentation",
  "meeting_record",
  "contract",
  "attachment",
  "other"
];

export function DocumentRegistry({ documents, authorization }: DocumentRegistryProps) {
  const { language } = useLanguage();
  const copy = registryCopy[language];
  const [query, setQuery] = useState("");
  const [view, setView] = useState<RegistryView>("all");
  const [status, setStatus] = useState<DocumentStatus | "all">("all");
  const [type, setType] = useState<DocumentType | "all">("all");
  const [classification, setClassification] = useState<Classification | "all">("all");

  const metrics = useMemo(() => {
    const reviewCount = documents.filter((document) => ["draft", "review", "approved"].includes(document.status)).length;
    const restrictedCount = documents.filter(
      (document) => document.classification === "restricted" || document.classification === "confidential"
    ).length;

    return {
      valid: documents.filter((document) => document.status === "valid").length,
      review: reviewCount,
      restricted: restrictedCount
    };
  }, [documents]);

  const filteredDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return documents.filter((document) => {
      if (view === "review" && !["draft", "review"].includes(document.status)) {
        return false;
      }
      if (view === "valid" && document.status !== "valid") {
        return false;
      }
      if (view === "restricted" && !["restricted", "confidential"].includes(document.classification)) {
        return false;
      }
      if (view === "archive" && !["archived", "superseded", "cancelled"].includes(document.status)) {
        return false;
      }
      if (status !== "all" && document.status !== status) {
        return false;
      }
      if (type !== "all" && document.document_type !== type) {
        return false;
      }
      if (classification !== "all" && document.classification !== classification) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        document.title,
        document.document_id,
        document.owner_id,
        document.gestor_unit ?? "",
        document.classification,
        document.document_type,
        ...document.tags
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [classification, documents, query, status, type, view]);

  function clearFilters() {
    setQuery("");
    setView("all");
    setStatus("all");
    setType("all");
    setClassification("all");
  }

  return (
    <div className="stack">
      <section className="grid grid--metrics" aria-label={copy.summaryTitle}>
        <MetricCard
          label={copy.totalDocuments}
          value={String(documents.length)}
          detail={copy.totalDocumentsDetail}
          icon={FileSearch}
        />
        <MetricCard
          label={copy.validDocuments}
          value={String(metrics.valid)}
          detail={copy.validDocumentsDetail}
          icon={CheckCircle2}
          tone="success"
        />
        <MetricCard
          label={copy.reviewDocuments}
          value={String(metrics.review)}
          detail={copy.reviewDocumentsDetail}
          icon={SlidersHorizontal}
          tone="attention"
        />
        <MetricCard
          label={copy.restrictedDocuments}
          value={String(metrics.restricted)}
          detail={copy.restrictedDocumentsDetail}
          icon={ShieldAlert}
          tone={metrics.restricted > 0 ? "danger" : "default"}
        />
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2>{copy.title}</h2>
          <div className="inline-actions">
            {authorization.can_update ? (
              <Link className="button" href="/documents/new">
                <FilePlus2 size={16} aria-hidden="true" />
                {copy.newDraft}
              </Link>
            ) : null}
            {authorization.can_ingest ? (
              <Link className="button button--primary" href="/upload">
                <UploadCloud size={16} aria-hidden="true" />
                {copy.uploadVersion}
              </Link>
            ) : null}
          </div>
        </div>
        <div className="panel__body stack">
          <div className="registry-toolbar">
            <label className="registry-search" htmlFor="document-registry-search">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">{copy.searchLabel}</span>
              <input
                id="document-registry-search"
                value={query}
                placeholder={copy.searchPlaceholder}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="registry-filter-grid">
              <FieldSelect label={copy.view} value={view} onChange={(value) => setView(value as RegistryView)}>
                <option value="all">{copy.allViews}</option>
                <option value="review">{copy.reviewQueue}</option>
                <option value="valid">{copy.validKnowledge}</option>
                <option value="restricted">{copy.restrictedView}</option>
                <option value="archive">{copy.archiveView}</option>
              </FieldSelect>
              <FieldSelect label={copy.statusFilter} value={status} onChange={(value) => setStatus(value as DocumentStatus | "all")}>
                <option value="all">{copy.all}</option>
                {documentStatuses.map((item) => (
                  <option key={item} value={item}>{item.replaceAll("_", " ")}</option>
                ))}
              </FieldSelect>
              <FieldSelect label={copy.typeFilter} value={type} onChange={(value) => setType(value as DocumentType | "all")}>
                <option value="all">{copy.all}</option>
                {documentTypes.map((item) => (
                  <option key={item} value={item}>{documentTypeLabel(item, language)}</option>
                ))}
              </FieldSelect>
              <FieldSelect
                label={copy.classificationFilter}
                value={classification}
                onChange={(value) => setClassification(value as Classification | "all")}
              >
                <option value="all">{copy.all}</option>
                {classifications.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </FieldSelect>
            </div>
            <button className="button" type="button" onClick={clearFilters}>
              <X size={15} aria-hidden="true" />
              {copy.clearFilters}
            </button>
          </div>

          <div className="registry-result-bar">
            <span>
              <Filter size={15} aria-hidden="true" />
              {copy.showing} {filteredDocuments.length} {copy.of} {documents.length}
            </span>
          </div>

          {filteredDocuments.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{copy.titleColumn}</th>
                  <th>{copy.type}</th>
                  <th>{copy.status}</th>
                  <th>{copy.classification}</th>
                  <th>{copy.owner}</th>
                  <th>{copy.tags}</th>
                  <th>{copy.updated}</th>
                  <th>{copy.open}</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocuments.map((document) => (
                  <tr key={document.document_id}>
                    <td>
                      <span className="cell-title">
                        <strong>{document.title}</strong>
                        <span>{document.document_id} - {document.gestor_unit}</span>
                      </span>
                    </td>
                    <td>{documentTypeLabel(document.document_type, language)}</td>
                    <td>
                      <StatusBadge value={document.status} />
                    </td>
                    <td>{document.classification}</td>
                    <td>{document.owner_id}</td>
                    <td>
                      <span className="tag-list">
                        {document.tags.slice(0, 3).map((tag) => (
                          <span className="tag" key={tag}>{tag}</span>
                        ))}
                      </span>
                    </td>
                    <td>{formatDateTime(document.updated_at, language)}</td>
                    <td>
                      <span className="inline-actions">
                        <Link className="icon-button" href={`/documents/${document.document_id}`} aria-label={`${copy.openDocument} ${document.title}`}>
                          <ArrowUpRight size={16} aria-hidden="true" />
                        </Link>
                        <Link
                          className="icon-button"
                          href={`/documents/${document.document_id}#versions`}
                          aria-label={`${copy.viewVersions} ${document.title}`}
                        >
                          <History size={16} aria-hidden="true" />
                        </Link>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-state">
              <Archive size={22} aria-hidden="true" />
              {copy.noResults}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function FieldSelect({
  children,
  label,
  value,
  onChange
}: {
  children: React.ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field registry-filter">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}
