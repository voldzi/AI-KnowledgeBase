"use client";

import { useMemo, useState } from "react";
import {
  Archive,
  ArrowUpRight,
  CheckCircle2,
  FilePlus2,
  FileSearch,
  Filter,
  History,
  ShieldAlert,
  SlidersHorizontal,
  UploadCloud,
  X
} from "lucide-react";

import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import {
  StratosButton,
  StratosButtonLink,
  StratosDataTable,
  StratosIconButtonLink,
  StratosSearchBox,
  StratosSelect,
  type StratosDataTableColumn
} from "@/components/stratos";
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
    clearFilter: "Zrušit filtr",
    closeFilter: "Zavřít filtr",
    filterTitlePrefix: "Filtr",
    noFilterResults: "Nenalezena žádná hodnota.",
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
    selected: "vybráno",
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
    clearFilter: "Clear filter",
    closeFilter: "Close filter",
    filterTitlePrefix: "Filter",
    noFilterResults: "No value found.",
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
    selected: "selected",
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
const classificationOptions: Classification[] = ["public", "internal", "restricted", "confidential"];
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
  "ai_intake",
  "ai_requirement_card",
  "ai_security_appendix",
  "ai_governance_evidence",
  "other"
];

export function DocumentRegistry({ documents, authorization }: DocumentRegistryProps) {
  const { language } = useLanguage();
  const copy = registryCopy[language];
  const [query, setQuery] = useState("");
  const [view, setView] = useState<RegistryView>("all");
  const [statuses, setStatuses] = useState<DocumentStatus[]>([]);
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [classifications, setClassifications] = useState<Classification[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);

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
      if (statuses.length > 0 && !statuses.includes(document.status)) {
        return false;
      }
      if (types.length > 0 && !types.includes(document.document_type)) {
        return false;
      }
      if (classifications.length > 0 && !classifications.includes(document.classification)) {
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
  }, [classifications, documents, query, statuses, types, view]);

  function clearFilters() {
    setQuery("");
    setView("all");
    setStatuses([]);
    setTypes([]);
    setClassifications([]);
  }

  const columns: Array<StratosDataTableColumn<Document>> = [
    {
      id: "title",
      label: copy.titleColumn,
      width: "minmax(260px, 1.5fr)",
      sortable: true,
      sortAccessor: (document) => document.title,
      render: (document) => (
        <span className="cell-title">
          <strong>{document.title}</strong>
          <span>{document.document_id} - {document.gestor_unit}</span>
        </span>
      )
    },
    {
      id: "type",
      label: copy.type,
      width: "minmax(150px, 0.8fr)",
      sortable: true,
      sortAccessor: (document) => documentTypeLabel(document.document_type, language),
      render: (document) => documentTypeLabel(document.document_type, language)
    },
    {
      id: "status",
      label: copy.status,
      width: 132,
      sortable: true,
      sortAccessor: (document) => document.status,
      render: (document) => <StatusBadge value={document.status} />
    },
    {
      id: "classification",
      label: copy.classification,
      width: 132,
      sortable: true,
      sortAccessor: (document) => document.classification,
      render: (document) => document.classification
    },
    {
      id: "owner",
      label: copy.owner,
      width: "minmax(140px, 0.8fr)",
      sortable: true,
      sortAccessor: (document) => document.owner_id,
      render: (document) => document.owner_id
    },
    {
      id: "tags",
      label: copy.tags,
      width: "minmax(180px, 1fr)",
      render: (document) => (
        <span className="tag-list">
          {document.tags.slice(0, 3).map((tag) => (
            <span className="tag" key={tag}>{tag}</span>
          ))}
        </span>
      )
    },
    {
      id: "updated",
      label: copy.updated,
      width: 170,
      sortable: true,
      sortAccessor: (document) => new Date(document.updated_at),
      render: (document) => formatDateTime(document.updated_at, language)
    },
    {
      id: "open",
      label: copy.open,
      width: 100,
      align: "center",
      render: (document) => (
        <span className="inline-actions">
          <StratosIconButtonLink href={`/documents/${document.document_id}`} aria-label={`${copy.openDocument} ${document.title}`}>
            <ArrowUpRight size={16} aria-hidden="true" />
          </StratosIconButtonLink>
          <StratosIconButtonLink
            href={`/documents/${document.document_id}#versions`}
            aria-label={`${copy.viewVersions} ${document.title}`}
          >
            <History size={16} aria-hidden="true" />
          </StratosIconButtonLink>
        </span>
      )
    }
  ];

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
              <StratosButtonLink href="/documents/new">
                <FilePlus2 size={16} aria-hidden="true" />
                {copy.newDraft}
              </StratosButtonLink>
            ) : null}
            {authorization.can_ingest ? (
              <StratosButtonLink tone="primary" href="/upload">
                <UploadCloud size={16} aria-hidden="true" />
                {copy.uploadVersion}
              </StratosButtonLink>
            ) : null}
          </div>
        </div>
        <div className="panel__body stack">
          <div className="registry-toolbar">
            <StratosSearchBox
              id="document-registry-search"
              label={copy.searchLabel}
              value={query}
              placeholder={copy.searchPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="registry-filter-grid">
              <FieldSelect
                id="document-registry-view"
                label={copy.view}
                closeLabel={copy.closeFilter}
                filterTitlePrefix={copy.filterTitlePrefix}
                noResultsLabel={copy.noFilterResults}
                value={view}
                onChange={(value) => setView(value as RegistryView)}
              >
                <option value="all">{copy.allViews}</option>
                <option value="review">{copy.reviewQueue}</option>
                <option value="valid">{copy.validKnowledge}</option>
                <option value="restricted">{copy.restrictedView}</option>
                <option value="archive">{copy.archiveView}</option>
              </FieldSelect>
              <FieldSelect
                id="document-registry-status"
                label={copy.statusFilter}
                multiple
                placeholder={copy.all}
                clearDescription={copy.clearFilter}
                closeLabel={copy.closeFilter}
                filterTitlePrefix={copy.filterTitlePrefix}
                noResultsLabel={copy.noFilterResults}
                value={statuses}
                onValuesChange={(values) => setStatuses(values as DocumentStatus[])}
              >
                {documentStatuses.map((item) => (
                  <option key={item} value={item}>{item.replaceAll("_", " ")}</option>
                ))}
              </FieldSelect>
              <FieldSelect
                id="document-registry-type"
                label={copy.typeFilter}
                multiple
                placeholder={copy.all}
                clearDescription={copy.clearFilter}
                closeLabel={copy.closeFilter}
                filterTitlePrefix={copy.filterTitlePrefix}
                noResultsLabel={copy.noFilterResults}
                value={types}
                onValuesChange={(values) => setTypes(values as DocumentType[])}
              >
                {documentTypes.map((item) => (
                  <option key={item} value={item}>{documentTypeLabel(item, language)}</option>
                ))}
              </FieldSelect>
              <FieldSelect
                id="document-registry-classification"
                label={copy.classificationFilter}
                multiple
                placeholder={copy.all}
                clearDescription={copy.clearFilter}
                closeLabel={copy.closeFilter}
                filterTitlePrefix={copy.filterTitlePrefix}
                noResultsLabel={copy.noFilterResults}
                value={classifications}
                onValuesChange={(values) => setClassifications(values as Classification[])}
              >
                {classificationOptions.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </FieldSelect>
            </div>
            <StratosButton type="button" onClick={clearFilters}>
              <X size={15} aria-hidden="true" />
              {copy.clearFilters}
            </StratosButton>
          </div>

          <div className="registry-result-bar">
            <span>
              <Filter size={15} aria-hidden="true" />
              {copy.showing} {filteredDocuments.length} {copy.of} {documents.length}
              {selectedDocumentIds.length > 0 ? ` · ${selectedDocumentIds.length} ${copy.selected}` : ""}
            </span>
          </div>

          <StratosDataTable
            rows={filteredDocuments}
            columns={columns}
            getRowId={(document) => document.document_id}
            selectableRows
            selectedRowIds={selectedDocumentIds}
            onSelectedRowIdsChange={setSelectedDocumentIds}
            emptyLabel={
              <span className="empty-state empty-state--inline">
                <Archive size={22} aria-hidden="true" />
                {copy.noResults}
              </span>
            }
            aria-label={copy.title}
          />
        </div>
      </section>
    </div>
  );
}

function FieldSelect({
  children,
  clearDescription,
  closeLabel,
  filterTitlePrefix,
  id,
  label,
  multiple,
  noResultsLabel,
  onValuesChange,
  placeholder,
  value,
  onChange
}: {
  children: React.ReactNode;
  clearDescription?: string;
  closeLabel?: string;
  filterTitlePrefix?: string;
  id: string;
  label: string;
  multiple?: boolean;
  noResultsLabel?: string;
  onValuesChange?: (values: string[]) => void;
  placeholder?: string;
  value: string | string[];
  onChange?: (value: string) => void;
}) {
  return (
    <StratosSelect
      id={id}
      label={label}
      multiple={multiple}
      placeholder={placeholder}
      clearDescription={clearDescription}
      closeLabel={closeLabel}
      filterTitlePrefix={filterTitlePrefix}
      noResultsLabel={noResultsLabel}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      onValuesChange={onValuesChange}
    >
      {children}
    </StratosSelect>
  );
}
