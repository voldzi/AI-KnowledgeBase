"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { withAppBasePath } from "@/lib/app-url";
import type { AuthorizationHint, Classification, Document, DocumentListPage, DocumentStatus, DocumentType } from "@/lib/types";
import { classificationLabel, documentStatusLabel, documentTypeLabel, formatDateTime } from "@/lib/format";
import { DOCUMENT_TYPE_CATALOG } from "@/lib/documents/document-workflow";
import { buildReturnTarget, documentDetailHref } from "@/lib/navigation/document-navigation";

interface DocumentRegistryProps {
  initialPage: DocumentListPage;
  authorization: AuthorizationHint;
}

const REGISTRY_PAGE_SIZE = 50;

const registryCopy = {
  cs: {
    title: "Registr dokumentů",
    summaryTitle: "Stav řízené dokumentace",
    newDraft: "Nový koncept",
    uploadVersion: "Nahrát verzi",
    newDraftDisabled: "Pro založení nového dokumentu nejprve zrušte výběr.",
    uploadVersionDisabled: "Pro nahrání verze vyberte právě jeden dokument.",
    selectedDocument: "Vybraný dokument",
    selectedDocuments: "Vybrané dokumenty",
    clearSelection: "Zrušit výběr",
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
    totalDocumentsDetail: "podle vašich oprávnění",
    validDocuments: "Platné",
    validDocumentsDetail: "publikované zdroje",
    reviewDocuments: "K revizi",
    reviewDocumentsDetail: "koncepty a revize",
    restrictedDocuments: "Citlivé",
    restrictedDocumentsDetail: "omezené nebo důvěrné",
    showing: "Zobrazeno",
    page: "Strana",
    previousPage: "Předchozí",
    nextPage: "Další",
    loading: "Načítám dokumenty…",
    loadFailed: "Dokumenty se nepodařilo načíst. Zkuste to znovu.",
    retry: "Načíst znovu",
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
    newDraftDisabled: "Clear the selection before creating a new document.",
    uploadVersionDisabled: "Select exactly one document to upload a version.",
    selectedDocument: "Selected document",
    selectedDocuments: "Selected documents",
    clearSelection: "Clear selection",
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
    totalDocumentsDetail: "within your access",
    validDocuments: "Valid",
    validDocumentsDetail: "published sources",
    reviewDocuments: "Review",
    reviewDocumentsDetail: "drafts and reviews",
    restrictedDocuments: "Sensitive",
    restrictedDocumentsDetail: "restricted or confidential",
    showing: "Showing",
    page: "Page",
    previousPage: "Previous",
    nextPage: "Next",
    loading: "Loading documents…",
    loadFailed: "Documents could not be loaded. Please try again.",
    retry: "Try again",
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
const documentTypes: DocumentType[] = DOCUMENT_TYPE_CATALOG.filter((item) => item.active).map((item) => item.code);

export function DocumentRegistry({ initialPage, authorization }: DocumentRegistryProps) {
  const { language } = useLanguage();
  const searchParams = useSearchParams();
  const copy = registryCopy[language];
  const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
  const [view, setView] = useState<RegistryView>(() => registryView(searchParams.get("view")));
  const [statuses, setStatuses] = useState<DocumentStatus[]>(() =>
    selectedValues(searchParams.getAll("status"), documentStatuses),
  );
  const [types, setTypes] = useState<DocumentType[]>(() =>
    selectedValues(searchParams.getAll("type"), documentTypes),
  );
  const [classifications, setClassifications] = useState<Classification[]>(() =>
    selectedValues(searchParams.getAll("classification"), classificationOptions),
  );
  const [page, setPage] = useState(initialPage);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const initialRequestSkipped = useRef(false);
  const documents = loading || loadFailed ? [] : page.items;
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const selectedDocument = selectedDocumentIds.length === 1
    ? documents.find((document) => document.document_id === selectedDocumentIds[0]) ?? null
    : null;
  const metrics = {
    valid: page.summary.valid_documents,
    review: page.summary.review_documents,
    restricted: page.summary.restricted_documents,
  };
  const registryReturnTo = useMemo(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (view !== "all") params.set("view", view);
    statuses.forEach((value) => params.append("status", value));
    types.forEach((value) => params.append("type", value));
    classifications.forEach((value) => params.append("classification", value));
    return buildReturnTarget("/documents", params);
  }, [classifications, query, statuses, types, view]);

  const effectiveStatuses = useMemo(
    () => registryViewStatuses(view, statuses),
    [statuses, view],
  );
  const effectiveClassifications = useMemo(
    () => registryViewClassifications(view, classifications),
    [classifications, view],
  );

  useEffect(() => {
    if (!initialRequestSkipped.current) {
      initialRequestSkipped.current = true;
      if (
        !query.trim()
        && view === "all"
        && statuses.length === 0
        && types.length === 0
        && classifications.length === 0
        && pageIndex === 0
        && reloadNonce === 0
      ) return;
    }
    const controller = new AbortController();
    let active = true;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    setLoadFailed(false);
    setSelectedDocumentIds([]);
    const timer = window.setTimeout(() => {
      deadline = setTimeout(() => controller.abort(), 20_000);
      const params = new URLSearchParams({
        limit: String(REGISTRY_PAGE_SIZE),
        offset: String(pageIndex * REGISTRY_PAGE_SIZE),
      });
      if (query.trim()) params.set("q", query.trim());
      effectiveStatuses.forEach((value) => params.append("status", value));
      effectiveClassifications.forEach((value) => params.append("classification", value));
      types.forEach((value) => params.append("type", value));
      fetch(withAppBasePath(`/api/documents?${params.toString()}`), {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Document page request failed");
          return response.json() as Promise<DocumentListPage>;
        })
        .then((nextPage) => {
          if (!active) return;
          if (!Array.isArray(nextPage?.items) || !Number.isSafeInteger(nextPage.total) || nextPage.total < 0 || !nextPage.summary) {
            throw new Error("Invalid document page");
          }
          if (nextPage.total > 0 && pageIndex * REGISTRY_PAGE_SIZE >= nextPage.total) {
            setPageIndex(Math.max(0, Math.ceil(nextPage.total / REGISTRY_PAGE_SIZE) - 1));
            return;
          }
          setPage(nextPage);
          setSelectedDocumentIds([]);
        })
        .catch(() => {
          if (active) setLoadFailed(true);
        })
        .finally(() => {
          clearTimeout(deadline);
          if (active) setLoading(false);
        });
    }, query.trim() ? 250 : 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
      clearTimeout(deadline);
      controller.abort();
    };
  }, [effectiveClassifications, effectiveStatuses, pageIndex, query, reloadNonce, types]);

  function clearFilters() {
    setQuery("");
    setView("all");
    setStatuses([]);
    setTypes([]);
    setClassifications([]);
    setPageIndex(0);
  }

  function changeView(nextView: RegistryView) {
    setView(nextView);
    setPageIndex(0);
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
          <span>{document.gestor_unit ?? documentTypeLabel(document.document_type, language)}</span>
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
      render: (document) => classificationLabel(document.classification, language)
    },
    {
      id: "owner",
      label: copy.owner,
      width: "minmax(140px, 0.8fr)",
      sortable: true,
      sortAccessor: (document) => documentOwnerLabel(document, language),
      render: (document) => documentOwnerLabel(document, language)
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
      resizable: false,
      align: "center",
      render: (document) => (
        <span className="inline-actions">
          <StratosIconButtonLink
            href={documentDetailHref({
              documentId: document.document_id,
              returnTo: registryReturnTo,
              origin: "registry",
            })}
            aria-label={`${copy.openDocument} ${document.title}`}
          >
            <ArrowUpRight size={16} aria-hidden="true" />
          </StratosIconButtonLink>
          <StratosIconButtonLink
            href={documentDetailHref({
              documentId: document.document_id,
              returnTo: registryReturnTo,
              origin: "registry",
              hash: "versions",
            })}
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
          value={loading || loadFailed ? "..." : String(page.summary.total_documents)}
          detail={copy.totalDocumentsDetail}
          icon={FileSearch}
        />
        <MetricCard
          label={copy.validDocuments}
          value={loading || loadFailed ? "..." : String(metrics.valid)}
          detail={copy.validDocumentsDetail}
          icon={CheckCircle2}
          tone="success"
        />
        <MetricCard
          label={copy.reviewDocuments}
          value={loading || loadFailed ? "..." : String(metrics.review)}
          detail={copy.reviewDocumentsDetail}
          icon={SlidersHorizontal}
          tone="attention"
        />
        <MetricCard
          label={copy.restrictedDocuments}
          value={loading || loadFailed ? "..." : String(metrics.restricted)}
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
              selectedDocumentIds.length === 0 ? (
                <StratosButtonLink href="/documents/new">
                  <FilePlus2 size={16} aria-hidden="true" />
                  {copy.newDraft}
                </StratosButtonLink>
              ) : (
                <StratosButton type="button" disabled title={copy.newDraftDisabled}>
                  <FilePlus2 size={16} aria-hidden="true" />
                  {copy.newDraft}
                </StratosButton>
              )
            ) : null}
            {authorization.can_ingest ? (
              selectedDocument ? (
                <StratosButtonLink tone="primary" href={`/upload?document_id=${encodeURIComponent(selectedDocument.document_id)}`}>
                  <UploadCloud size={16} aria-hidden="true" />
                  {copy.uploadVersion}
                </StratosButtonLink>
              ) : (
                <StratosButton type="button" disabled title={copy.uploadVersionDisabled}>
                  <UploadCloud size={16} aria-hidden="true" />
                  {copy.uploadVersion}
                </StratosButton>
              )
            ) : null}
          </div>
        </div>
        <div className="panel__body stack">
          {selectedDocumentIds.length > 0 ? (
            <div className="selected-document-context" aria-live="polite">
              <FileSearch size={18} aria-hidden="true" />
              <div>
                <span>{selectedDocument ? copy.selectedDocument : copy.selectedDocuments}</span>
                <strong>{selectedDocument?.title ?? `${selectedDocumentIds.length} ${copy.selected}`}</strong>
                {selectedDocument ? (
                  <small>{documentTypeLabel(selectedDocument.document_type, language)} · {classificationLabel(selectedDocument.classification, language)}</small>
                ) : null}
              </div>
              <StratosButton type="button" onClick={() => setSelectedDocumentIds([])}>
                <X size={15} aria-hidden="true" />
                {copy.clearSelection}
              </StratosButton>
            </div>
          ) : null}
          <div className="registry-toolbar">
            <StratosSearchBox
              id="document-registry-search"
              label={copy.searchLabel}
              value={query}
              placeholder={copy.searchPlaceholder}
              onChange={(event) => {
                setQuery(event.target.value);
                setPageIndex(0);
              }}
            />
            <div className="registry-filter-grid">
              <FieldSelect
                id="document-registry-view"
                label={copy.view}
                closeLabel={copy.closeFilter}
                filterTitlePrefix={copy.filterTitlePrefix}
                noResultsLabel={copy.noFilterResults}
                value={view}
                onChange={(value) => changeView(value as RegistryView)}
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
                onValuesChange={(values) => {
                  setStatuses(values as DocumentStatus[]);
                  setPageIndex(0);
                }}
              >
                {documentStatuses.map((item) => (
                  <option key={item} value={item}>{documentStatusLabel(item, language)}</option>
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
                onValuesChange={(values) => {
                  setTypes(values as DocumentType[]);
                  setPageIndex(0);
                }}
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
                onValuesChange={(values) => {
                  setClassifications(values as Classification[]);
                  setPageIndex(0);
                }}
              >
                {classificationOptions.map((item) => (
                  <option key={item} value={item}>{classificationLabel(item, language)}</option>
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
              {loading ? copy.loading : loadFailed ? "" : `${copy.showing} ${page.items.length} ${copy.of} ${page.total}`}
              {selectedDocumentIds.length > 0 ? ` · ${selectedDocumentIds.length} ${copy.selected}` : ""}
            </span>
          </div>

          {loadFailed ? (
            <div className="notice notice--danger" role="alert">
              <span>{copy.loadFailed}</span>
              <StratosButton type="button" onClick={() => setReloadNonce((value) => value + 1)}>
                {copy.retry}
              </StratosButton>
            </div>
          ) : null}

          <div aria-busy={loading}>
            {loading ? <div className="notice" role="status"><span className="dashboard-loading__indicator" aria-hidden="true" />{copy.loading}</div> : loadFailed ? null : <StratosDataTable
              rows={documents}
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
            />}
          </div>
          <nav className="registry-pagination" aria-label={copy.page}>
            <StratosButton
              type="button"
              disabled={loading || loadFailed || pageIndex === 0}
              onClick={() => setPageIndex((value) => Math.max(0, value - 1))}
            >
              {copy.previousPage}
            </StratosButton>
            <span aria-live="polite">
              {loading
                ? copy.loading
                : loadFailed ? "" : `${copy.page} ${pageIndex + 1} ${copy.of} ${Math.max(1, Math.ceil(page.total / REGISTRY_PAGE_SIZE))}`}
            </span>
            <StratosButton
              type="button"
              disabled={loading || loadFailed || (pageIndex + 1) * REGISTRY_PAGE_SIZE >= page.total}
              onClick={() => setPageIndex((value) => value + 1)}
            >
              {copy.nextPage}
            </StratosButton>
          </nav>
        </div>
      </section>
    </div>
  );
}

function registryView(value: string | null): RegistryView {
  return (["all", "review", "valid", "restricted", "archive"] as const).includes(
    value as RegistryView,
  )
    ? (value as RegistryView)
    : "all";
}

function selectedValues<Value extends string>(values: string[], allowed: readonly Value[]): Value[] {
  const allowedValues = new Set<string>(allowed);
  return [...new Set(values.filter((value): value is Value => allowedValues.has(value)))];
}

function registryViewStatuses(
  view: RegistryView,
  selected: DocumentStatus[],
): DocumentStatus[] {
  if (selected.length > 0) return selected;
  if (view === "review") return ["draft", "review"];
  if (view === "valid") return ["valid"];
  if (view === "archive") return ["archived", "superseded", "cancelled"];
  return [];
}

function registryViewClassifications(
  view: RegistryView,
  selected: Classification[],
): Classification[] {
  if (selected.length > 0) return selected;
  return view === "restricted" ? ["restricted", "confidential"] : [];
}

function documentOwnerLabel(document: Document, language: AklLanguage): string {
  const assignment = (document.assignments ?? []).find((candidate) => (
    candidate.active
    && (candidate.role === "owner" || candidate.role === "gestor")
    && candidate.display_label?.trim()
  ));
  if (assignment?.display_label) return assignment.display_label;
  if (document.owner.trim() && !isTechnicalIdentifier(document.owner)) return document.owner;
  if (document.gestor_unit?.trim()) return document.gestor_unit;
  return language === "en" ? "Assigned owner" : "Přiřazený vlastník";
}

function isTechnicalIdentifier(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(value)
    || /^(?:user|subject|sub|svc|usr)[:_-]/i.test(value);
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
