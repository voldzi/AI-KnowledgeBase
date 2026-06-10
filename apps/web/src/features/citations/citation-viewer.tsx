"use client";

import { forwardRef, useEffect, useState } from "react";
import { Copy, ExternalLink, FileText, Maximize2, PanelRightOpen, ShieldAlert, Square, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { StatusBadge } from "@/components/status-badge";
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

export function citationDocumentViewerHref(citation: Citation) {
  const params = new URLSearchParams({
    tab: "viewer",
    chunk_id: citation.chunk_id
  });
  return withAppBasePath(`/documents/${encodeURIComponent(citation.document_id)}?${params.toString()}`);
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

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={`citation-backdrop citation-backdrop--${mode}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={`citation-modal citation-modal--${mode}`}>
        <div className="citation-modal__header">
          <span className="citation-modal__title">{title}</span>
          <div className="citation-modal__modes">
            <button
              type="button"
              className={`citation-mode-btn ${mode === "modal" ? "is-active" : ""}`}
              title="Okno"
              onClick={() => setMode("modal")}
            >
              <Square size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`citation-mode-btn ${mode === "sidebar" ? "is-active" : ""}`}
              title="Panel"
              onClick={() => setMode("sidebar")}
            >
              <PanelRightOpen size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`citation-mode-btn ${mode === "fullscreen" ? "is-active" : ""}`}
              title="Celá obrazovka"
              onClick={() => setMode("fullscreen")}
            >
              <Maximize2 size={14} aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            className="citation-modal__close"
            onClick={onClose}
            aria-label="Zavřít"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="citation-modal__body">
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
          {(sourceContext || sourceError) ? (
            <div className="citation-modal__context-pane">
              {sourceError ? <div className="notice">{sourceError}</div> : null}
              {sourceContext ? (
                <SourceContextCard labels={labels} sourceContext={sourceContext} showStatus={false} />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
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
            {labels.version} {citation.version_label} - {labels.page} {citation.page_number ?? "n/a"}
          </span>
          <span>{citation.section_path.join(" / ") || labels.noSection}</span>
          <button
            className="button citation-open-button"
            type="button"
            onClick={() => onOpenCitation(citation)}
            disabled={openingChunkId === citation.chunk_id}
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
  { sourceContext, labels, className = "", showStatus = true },
  ref
) {
  return (
    <article className={`source-viewer ${className}`.trim()} ref={ref}>
      <div className="source-viewer__header">
        <div>
          <h3>{sourceContext.document_title}</h3>
          <span>
            {sourceContext.viewer_mode} viewer - {sourceContext.source_file_name ?? labels.sourceUnavailable}
          </span>
        </div>
        {showStatus ? <StatusBadge value="valid" label={sourceContext.viewer_mode} /> : null}
      </div>
      <div className="notice" role="status">{labels.sourceOpened}</div>
      <div className="source-viewer__meta">
        <span>{labels.chunk} {sourceContext.chunk_id}</span>
        <span>{labels.version} {sourceContext.document_version_id}</span>
        <span>{labels.page} {sourceContext.location.page_number ?? "n/a"}</span>
        <span>{sourceContext.location.section_path.join(" / ") || labels.noSection}</span>
      </div>
      {sourceContext.source_file_uri ? (
        <div className="source-uri">
          <FileText size={15} aria-hidden="true" />
          <span>{sourceContext.source_file_uri}</span>
        </div>
      ) : null}
      {sourceContext.before_text ? (
        <div className="source-context-block">
          {labels.beforeContext ? <strong>{labels.beforeContext}</strong> : null}
          <SourceContextPreview text={sourceContext.before_text} viewerMode={sourceContext.viewer_mode} contextual />
        </div>
      ) : null}
      <SourceContextPreview text={sourceContext.chunk_text} viewerMode={sourceContext.viewer_mode} />
      {sourceContext.after_text ? (
        <div className="source-context-block">
          {labels.afterContext ? <strong>{labels.afterContext}</strong> : null}
          <SourceContextPreview text={sourceContext.after_text} viewerMode={sourceContext.viewer_mode} contextual />
        </div>
      ) : null}
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
      {sourceContext.warnings.length > 0 ? (
        <div className="notice notice--danger">
          <ShieldAlert size={16} aria-hidden="true" />
          {sourceContext.warnings.join(", ")}
        </div>
      ) : null}
    </article>
  );
});

function SourceContextPreview({
  text,
  viewerMode,
  contextual = false
}: {
  text: string;
  viewerMode: SourceContext["viewer_mode"];
  contextual?: boolean;
}) {
  if (viewerMode === "markdown") {
    return (
      <article className={`native-preview__markdown native-preview__markdown--citation ${contextual ? "native-preview__markdown--context" : ""}`.trim()}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </article>
    );
  }

  return <pre className={`chunk-text ${contextual ? "chunk-text--context" : ""}`.trim()}>{text}</pre>;
}
