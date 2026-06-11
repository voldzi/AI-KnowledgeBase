"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { FileSearch, ShieldAlert } from "lucide-react";

type PdfJsModule = typeof import("pdfjs-dist");

export type StratosPdfViewerBbox = Record<string, number>;

export interface StratosPdfViewerLabels {
  title: string;
  detail: string;
  loading: string;
  error: string;
  page: string;
  textHighlight: string;
  bbox: string;
}

export interface StratosPdfViewerProps {
  sourceUrl: string;
  labels: StratosPdfViewerLabels;
  bbox?: StratosPdfViewerBbox | null;
  className?: string;
  highlightText?: string | null;
  pageNumber?: number | null;
  scale?: number;
}

interface PdfTextHighlight {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  text: string;
}

export function StratosPdfViewer({
  bbox,
  className,
  highlightText,
  labels,
  pageNumber,
  scale = 1.35,
  sourceUrl
}: StratosPdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const safeRequestedPage = Math.max(1, Math.trunc(pageNumber ?? 1));
  const sourceUrlWithoutFragment = stripUrlFragment(sourceUrl);
  const bboxStyle = bbox ? bboxToPercentStyle(bbox) : null;
  const [renderState, setRenderState] = useState<{
    status: "loading" | "ready" | "error";
    pageNumber: number;
    pageCount: number | null;
    width: number;
    height: number;
    textHighlights: PdfTextHighlight[];
  }>({
    status: "loading",
    pageNumber: safeRequestedPage,
    pageCount: null,
    width: 0,
    height: 0,
    textHighlights: []
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let cancelled = false;
    let cleanupDocument: (() => void) | null = null;
    let cleanupRender: (() => void) | null = null;

    const renderPdf = async () => {
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      setRenderState({
        status: "loading",
        pageNumber: safeRequestedPage,
        pageCount: null,
        width: 0,
        height: 0,
        textHighlights: []
      });

      try {
        const pdfjs = await loadPdfJs();
        if (cancelled) return;

        const response = await fetch(sourceUrlWithoutFragment, { headers: { Accept: "application/pdf" } });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const pdfBytes = await response.arrayBuffer();
        if (cancelled) return;

        const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdfBytes) });
        cleanupDocument = () => {
          void loadingTask.destroy();
        };

        const pdf = await loadingTask.promise;
        if (cancelled) return;

        const resolvedPageNumber = Math.min(Math.max(1, safeRequestedPage), pdf.numPages);
        const page = await pdf.getPage(resolvedPageNumber);
        if (cancelled) return;

        const viewport = page.getViewport({ scale });
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Canvas context unavailable");
        }

        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
        context.clearRect(0, 0, viewport.width, viewport.height);

        const renderTask = page.render({ canvas, canvasContext: context, viewport });
        renderTaskRef.current = renderTask;
        cleanupRender = () => {
          renderTask.cancel();
          if (renderTaskRef.current === renderTask) {
            renderTaskRef.current = null;
          }
        };

        await renderTask.promise;
        if (renderTaskRef.current === renderTask) {
          renderTaskRef.current = null;
        }
        cleanupRender = null;
        if (cancelled) return;

        const textContent = await page.getTextContent();
        const textHighlights = pdfTextHighlights({
          chunkText: highlightText ?? "",
          items: textContent.items,
          pdfjs,
          viewportHeight: viewport.height,
          viewportTransform: viewport.transform,
          viewportWidth: viewport.width
        });

        if (cancelled) {
          return;
        }

        setRenderState({
          status: "ready",
          pageNumber: resolvedPageNumber,
          pageCount: pdf.numPages,
          width: viewport.width,
          height: viewport.height,
          textHighlights
        });
      } catch (error) {
        if (!cancelled) {
          console.warn("STRATOS PDF viewer render failed", error);
          setRenderState({
            status: "error",
            pageNumber: safeRequestedPage,
            pageCount: null,
            width: 0,
            height: 0,
            textHighlights: []
          });
        }
      }
    };

    void renderPdf();

    return () => {
      cancelled = true;
      cleanupRender?.();
      cleanupDocument?.();
    };
  }, [highlightText, safeRequestedPage, scale, sourceUrlWithoutFragment]);

  if (renderState.status === "error") {
    return (
      <div className="notice notice--danger">
        <ShieldAlert size={16} aria-hidden="true" />
        {labels.error}
      </div>
    );
  }

  return (
    <div className={`native-preview__pdf-rendered ${className ?? ""}`.trim()}>
      <div className="native-preview__pdf-rendered-header">
        <div>
          <strong>{labels.title}</strong>
          <p>{labels.detail}</p>
        </div>
        <span>
          {labels.page} {renderState.pageNumber}
          {renderState.pageCount ? ` / ${renderState.pageCount}` : ""}
        </span>
      </div>
      <div className="native-preview__pdf-page-scroll">
        <div
          className="native-preview__pdf-page"
          style={renderState.width > 0 && renderState.height > 0 ? { width: renderState.width, height: renderState.height } : undefined}
        >
          <canvas ref={canvasRef} />
          {renderState.status === "loading" ? (
            <div className="native-preview__pdf-loading">
              <FileSearch size={22} aria-hidden="true" />
              {labels.loading}
            </div>
          ) : null}
          {renderState.textHighlights.map((highlight) => (
            <span
              aria-label={labels.textHighlight}
              className="native-preview__pdf-text-highlight"
              key={highlight.id}
              role="mark"
              style={highlightToPercentStyle(highlight)}
              title={highlight.text}
            />
          ))}
          {bboxStyle ? (
            <span
              aria-label={labels.bbox}
              className="native-preview__bbox native-preview__bbox--pdf-page"
              role="img"
              style={bboxStyle}
              title={labels.bbox}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
      return pdfjs;
    });
  }
  return pdfJsModulePromise;
}

function pdfTextHighlights({
  chunkText,
  items,
  pdfjs,
  viewportHeight,
  viewportTransform,
  viewportWidth
}: {
  chunkText: string;
  items: unknown[];
  pdfjs: PdfJsModule;
  viewportHeight: number;
  viewportTransform: number[];
  viewportWidth: number;
}): PdfTextHighlight[] {
  const normalizedChunk = normalizePdfSearchText(chunkText);
  if (!normalizedChunk || viewportWidth <= 0 || viewportHeight <= 0) {
    return [];
  }

  const viewportScale = Math.max(Math.hypot(viewportTransform[0] ?? 1, viewportTransform[1] ?? 0), 1);
  return items.flatMap((item, index) => {
    if (!isPdfTextItem(item) || !pdfTextMatchesChunk(item.str, normalizedChunk)) {
      return [];
    }

    const transform = pdfjs.Util.transform(viewportTransform, item.transform);
    const left = Number(transform[4] ?? 0);
    const baselineTop = Number(transform[5] ?? 0);
    const height = Math.max(Math.abs(item.height * viewportScale), Math.hypot(Number(transform[2] ?? 0), Number(transform[3] ?? 0)), 8);
    const width = Math.max(Math.abs(item.width * viewportScale), 8);
    return [
      {
        id: `${index}-${item.str}`,
        left: clampPercent((left / viewportWidth) * 100),
        top: clampPercent(((baselineTop - height) / viewportHeight) * 100),
        width: clampPercent((width / viewportWidth) * 100),
        height: clampPercent((height / viewportHeight) * 100),
        text: item.str
      }
    ];
  });
}

function isPdfTextItem(item: unknown): item is { str: string; transform: number[]; width: number; height: number } {
  return (
    typeof item === "object" &&
    item !== null &&
    "str" in item &&
    typeof item.str === "string" &&
    "transform" in item &&
    Array.isArray(item.transform) &&
    "width" in item &&
    typeof item.width === "number" &&
    "height" in item &&
    typeof item.height === "number"
  );
}

function pdfTextMatchesChunk(text: string, normalizedChunk: string): boolean {
  const normalizedText = normalizePdfSearchText(text);
  if (normalizedText.length < 4) {
    return false;
  }
  if (normalizedChunk.includes(normalizedText) || normalizedText.includes(normalizedChunk)) {
    return true;
  }

  const chunkTokens = new Set(normalizedChunk.split(" ").filter((token) => token.length >= 4));
  const textTokens = normalizedText.split(" ").filter((token) => token.length >= 4);
  if (textTokens.length === 0) {
    return false;
  }
  const matches = textTokens.filter((token) => chunkTokens.has(token)).length;
  return matches >= Math.min(2, textTokens.length);
}

function normalizePdfSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function highlightToPercentStyle(highlight: PdfTextHighlight): CSSProperties {
  return {
    left: `${highlight.left}%`,
    top: `${highlight.top}%`,
    width: `${Math.max(highlight.width, 1)}%`,
    height: `${Math.max(highlight.height, 1)}%`
  };
}

function bboxToPercentStyle(bbox: StratosPdfViewerBbox): CSSProperties {
  const left = normalizeBboxPercent(bbox.x ?? bbox.left ?? 0);
  const top = normalizeBboxPercent(bbox.y ?? bbox.top ?? 0);
  const width = normalizeBboxPercent(bbox.width ?? bbox.w ?? 0);
  const height = normalizeBboxPercent(bbox.height ?? bbox.h ?? 0);
  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${Math.max(width, 1)}%`,
    height: `${Math.max(height, 1)}%`
  };
}

function normalizeBboxPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const percent = value > 0 && value <= 1 ? value * 100 : value;
  return Math.min(100, Math.max(0, percent));
}

function stripUrlFragment(sourceUrl: string): string {
  const [baseUrl] = sourceUrl.split("#");
  return baseUrl;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}
