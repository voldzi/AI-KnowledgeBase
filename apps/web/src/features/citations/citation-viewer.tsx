"use client";

import { forwardRef, useState } from "react";
import { Dialog } from "@voldzi/stratos-ui";
import { Copy, ExternalLink, FileText, Maximize2, PanelRightOpen, ShieldAlert, Square } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { AssistantMarkdown } from "@/features/assistant/assistant-markdown";
import { withAppBasePath } from "@/lib/app-url";
import type { Citation, SourceContext } from "@/lib/types";

export interface CitationViewerLabels {
  version: string;
  page: string;
  opening: string;
  openCitation: string;
  openDocument: string;
  sourceUnavailable: string;
  noSection: string;
  sourceOpened: string;
  copyChunk: string;
  chunk: string;
  beforeContext?: string;
  afterContext?: string;
  sheet?: string;
  row?: string;
  slide?: string;
}

interface CitationListProps {
  citations: Citation[];
  activeChunkId?: string | null;
  openingChunkId?: string | null;
  emptyLabel: string;
  labels: CitationViewerLabels;
  onOpenCitation: (citation: Citation) => void;
}

interface SourceContextCardProps {
  sourceContext: SourceContext;
  labels: CitationViewerLabels;
  className?: string;
  showStatus?: boolean;
  showTechnicalDetails?: boolean;
}

type CitationDisplayMode = "modal" | "sidebar" | "fullscreen";

export interface CitationModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  citations: Citation[];
  activeChunkId?: string | null;
  openingChunkId?: string | null;
  sourceContext: SourceContext | null;
  sourceError?: string | null;
  emptyLabel: string;
  labels: CitationViewerLabels;
  onOpenCitation: (citation: Citation) => void;
}

function citationDocumentHrefForChunk(chunkId: string) {
  return withAppBasePath(`/api/assistant/citations/${encodeURIComponent(chunkId)}/document`);
}

export function citationDocumentViewerHref(citation: Citation) {
  return citationDocumentHrefForChunk(citation.chunk_id);
}

export function CitationModal({
  open,
  onClose,
  title,
  citations,
  activeChunkId,
  openingChunkId,
  sourceContext,
  sourceError,
  emptyLabel,
  labels,
  onOpenCitation
}: CitationModalProps) {
  const [mode, setMode] = useState<CitationDisplayMode>("sidebar");
  const showCitationList = !sourceContext;
  const showContextPane = Boolean(sourceContext || sourceError);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      className={`citation-modal citation-modal--${mode}`}
    >
      <div className="citation-modal__modes" role="group" aria-label="Zobrazení citace">
        <button
          type="button"
          className={`citation-mode-btn ${mode === "modal" ? "is-active" : ""}`}
          title="Okno"
          aria-label="Okno"
          aria-pressed={mode === "modal"}
          onClick={() => setMode("modal")}
        >
          <Square size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`citation-mode-btn ${mode === "sidebar" ? "is-active" : ""}`}
          title="Panel"
          aria-label="Panel"
          aria-pressed={mode === "sidebar"}
          onClick={() => setMode("sidebar")}
        >
          <PanelRightOpen size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`citation-mode-btn ${mode === "fullscreen" ? "is-active" : ""}`}
          title="Celá obrazovka"
          aria-label="Celá obrazovka"
          aria-pressed={mode === "fullscreen"}
          onClick={() => setMode("fullscreen")}
        >
          <Maximize2 size={14} aria-hidden="true" />
        </button>
      </div>
      <div className={`citation-modal__body ${sourceContext ? "citation-modal__body--detail" : ""}`.trim()}>
        {showCitationList ? (
          <div className="citation-modal__list-pane">
            <CitationList
              citations={citations}
              activeChunkId={activeChunkId}
              openingChunkId={openingChunkId}
              emptyLabel={emptyLabel}
              labels={labels}
              onOpenCitation={onOpenCitation}
            />
          </div>
        ) : null}
        {showContextPane ? (
          <div className="citation-modal__context-pane">
            {sourceError ? <div className="notice">{sourceError}</div> : null}
            {sourceContext ? (
              <SourceContextCard labels={labels} sourceContext={sourceContext} showStatus={false} />
            ) : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

export function CitationList({
  citations,
  activeChunkId,
  openingChunkId,
  emptyLabel,
  labels,
  onOpenCitation
}: CitationListProps) {
  if (citations.length === 0) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  return (
    <>
      {citations.map((citation) => (
        <article className={`timeline-item ${activeChunkId === citation.chunk_id ? "timeline-item--active" : ""}`} key={citation.chunk_id}>
          <strong>{citation.document_title}</strong>
          <span>
            {labels.version} {citation.version_label}{citation.page_number != null ? ` · ${labels.page} ${citation.page_number}` : ""}
          </span>
          <span>{citation.section_path.join(" / ") || labels.noSection}</span>
          <button
            className="button citation-open-button"
            type="button"
            onClick={() => {
              if (openingChunkId !== citation.chunk_id) onOpenCitation(citation);
            }}
            aria-disabled={openingChunkId === citation.chunk_id}
          >
            <ExternalLink size={15} aria-hidden="true" />
            {openingChunkId === citation.chunk_id ? labels.opening : labels.openCitation}
          </button>
          <a
            className="button"
            href={citationDocumentViewerHref(citation)}
            target="_blank"
            rel="noreferrer noopener"
          >
            <FileText size={15} aria-hidden="true" />
            {labels.openDocument}
          </a>
        </article>
      ))}
    </>
  );
}

export const SourceContextCard = forwardRef<HTMLElement, SourceContextCardProps>(function SourceContextCard(
  { sourceContext, labels, className = "", showStatus = true, showTechnicalDetails = false },
  ref
) {
  const locationLabel = sourceLocationLabel(sourceContext.location, labels);

  return (
    <article className={`source-viewer ${className}`.trim()} ref={ref}>
      <div className="source-viewer__header">
        <div>
          <h3>{sourceContext.document_title}</h3>
          <span>{locationLabel}</span>
        </div>
        {showStatus ? <StatusBadge value="valid" label={sourceContext.viewer_mode} /> : null}
      </div>
      {showTechnicalDetails ? (
        <div className="source-viewer__technical" aria-label="Technické údaje zdroje">
          <span>
            {sourceContext.viewer_mode} viewer - {sourceContext.source_file_name ?? labels.sourceUnavailable}
          </span>
          <span>{labels.chunk} {sourceContext.chunk_id}</span>
          <span>{labels.version} {sourceContext.document_version_id}</span>
          {sourceContext.source_file_uri ? (
            <span>{sourceContext.source_file_uri}</span>
          ) : null}
        </div>
      ) : null}
      {sourceContext.before_text ? (
        <div className="source-context-block">
          {labels.beforeContext ? <strong>{labels.beforeContext}</strong> : null}
          <SourceContextPreview text={sourceContext.before_text} viewerMode={sourceContext.viewer_mode} openLinkLabel={labels.openCitation} contextual />
        </div>
      ) : null}
      <SourceContextPreview text={sourceContext.chunk_text} viewerMode={sourceContext.viewer_mode} openLinkLabel={labels.openCitation} />
      {sourceContext.after_text ? (
        <div className="source-context-block">
          {labels.afterContext ? <strong>{labels.afterContext}</strong> : null}
          <SourceContextPreview text={sourceContext.after_text} viewerMode={sourceContext.viewer_mode} openLinkLabel={labels.openCitation} contextual />
        </div>
      ) : null}
      <div className="source-viewer__actions">
        <a
          className="button"
          href={citationDocumentHrefForChunk(sourceContext.chunk_id)}
          target="_blank"
          rel="noreferrer noopener"
        >
          <FileText size={15} aria-hidden="true" />
          {labels.openDocument}
        </a>
        <button
          className="button"
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(sourceContext.chunk_text);
          }}
        >
          <Copy size={15} aria-hidden="true" />
          {labels.copyChunk}
        </button>
      </div>
      {sourceContext.warnings.length > 0 ? (
        <div className="notice notice--danger">
          <ShieldAlert size={16} aria-hidden="true" />
          {sourceContext.warnings.join(", ")}
        </div>
      ) : null}
    </article>
  );
});

export function sourceLocationLabel(location: SourceContext["location"], labels: CitationViewerLabels): string {
  const sections = [...location.section_path];
  if (location.sheet_name) {
    if (sections[0] === location.sheet_name) sections.shift();
    return [
      `${labels.sheet ?? "List"} ${location.sheet_name}`,
      sections.join(" / ") || (location.row_number ? `${labels.row ?? "Řádek"} ${location.row_number}` : ""),
    ].filter(Boolean).join(" · ");
  }
  if (location.slide_number) {
    if (sections[0] === `Snímek ${location.slide_number}`) sections.shift();
    return [`${labels.slide ?? "Snímek"} ${location.slide_number}`, sections.join(" / ")].filter(Boolean).join(" · ");
  }
  return [location.page_number != null ? `${labels.page} ${location.page_number}` : "", sections.join(" / ") || labels.noSection]
    .filter(Boolean).join(" · ");
}

function SourceContextPreview({
  text,
  viewerMode,
  openLinkLabel,
  contextual = false
}: {
  text: string;
  viewerMode: SourceContext["viewer_mode"];
  openLinkLabel: string;
  contextual?: boolean;
}) {
  if (viewerMode === "markdown") {
    return (
      <article className={`native-preview__markdown native-preview__markdown--citation ${contextual ? "native-preview__markdown--context" : ""}`.trim()}>
        <AssistantMarkdown content={text} openLinkLabel={openLinkLabel} />
      </article>
    );
  }

  return <pre className={`chunk-text ${contextual ? "chunk-text--context" : ""}`.trim()}>{text}</pre>;
}
