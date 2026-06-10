"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Send, ShieldAlert } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { StratosButton } from "@/components/stratos";
import { CitationList, SourceContextCard } from "@/features/citations/citation-viewer";
import { withAppBasePath } from "@/lib/app-url";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import type { Citation, RagAnswer, SourceContext } from "@/lib/types";

interface KnowledgeChatProps {
  initialAnswer: RagAnswer;
}

const chatCopy = {
  cs: {
    defaultQuestion: "Jaká jsou největší rizika projektu?",
    title: "Znalostní chat",
    notice: "Odpovědi musí obsahovat citace. Pokud zdroje nestačí, zůstane viditelný stav bez odpovědi.",
    question: "Dotaz",
    scope: "Rozsah znalostí",
    asking: "Odesílám",
    ask: "Zeptat se s citacemi",
    answer: "Odpověď",
    citationViewer: "Prohlížeč citací",
    citations: "citací",
    version: "Verze",
    page: "strana",
    opening: "Otevírám",
    openCitation: "Otevřít citaci",
    noCitation: "Pro tuto odpověď není dostupná žádná citace.",
    sourceUnavailable: "zdroj není dostupný",
    noSection: "Bez oddílu",
    copyChunk: "Kopírovat úryvek",
    chunk: "Chunk",
    openDocument: "Otevřít dokument",
    sourceOpened: "Citace otevřena",
    technicalDetails: "Technické detaily",
    technicalDetailsSummary: "Zobrazit technické detaily odpovědi",
    queryId: "Query ID",
    usedChunks: "Použité chunky",
    warnings: "Varování",
    noTechnicalWarnings: "Bez varování",
    requestFailed: "RAG API vrátilo HTTP",
    requestError: "Dotaz se nepodařilo odeslat.",
    citationFailed: "Citation API vrátilo HTTP",
    citationError: "Citaci se nepodařilo otevřít."
  },
  en: {
    defaultQuestion: "What are the biggest project risks?",
    title: "Knowledge chat",
    notice: "Answers must include citations. No-answer states remain visible when sources are insufficient.",
    question: "Question",
    scope: "Knowledge scope",
    asking: "Asking",
    ask: "Ask with citations",
    answer: "Answer",
    citationViewer: "Citation viewer",
    citations: "citations",
    version: "Version",
    page: "page",
    opening: "Opening",
    openCitation: "Open citation",
    noCitation: "No citation can be shown for this answer.",
    sourceUnavailable: "source unavailable",
    noSection: "No section",
    copyChunk: "Copy excerpt",
    chunk: "Chunk",
    openDocument: "Open document",
    sourceOpened: "Citation opened",
    technicalDetails: "Technical details",
    technicalDetailsSummary: "Show technical answer details",
    queryId: "Query ID",
    usedChunks: "Used chunks",
    warnings: "Warnings",
    noTechnicalWarnings: "No warnings",
    requestFailed: "RAG API returned HTTP",
    requestError: "RAG request failed.",
    citationFailed: "Citation API returned HTTP",
    citationError: "Citation open failed."
  }
} satisfies Record<AklLanguage, Record<string, string>>;

export function KnowledgeChat({ initialAnswer }: KnowledgeChatProps) {
  const { language } = useLanguage();
  const copy = chatCopy[language];
  const [question, setQuestion] = useState(copy.defaultQuestion);
  const [tags, setTags] = useState("akl-docs");
  const [answer, setAnswer] = useState(initialAnswer);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sourceContext, setSourceContext] = useState<SourceContext | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [openingChunkId, setOpeningChunkId] = useState<string | null>(null);
  const sourceViewerRef = useRef<HTMLElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setQuestion(chatCopy[language].defaultQuestion);
  }, [language]);

  useEffect(() => {
    if (sourceContext) {
      sourceViewerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [sourceContext]);

  function openCitation(citation: Citation) {
    setOpeningChunkId(citation.chunk_id);
    setSourceError(null);
    fetch(withAppBasePath(`/api/controlled-document/citations/${encodeURIComponent(citation.chunk_id)}/open`), {
      method: "GET",
      headers: { Accept: "application/json" }
    })
      .then(async (response) => {
        setOpeningChunkId(null);
        if (!response.ok) {
          setSourceError(`${copy.citationFailed} ${response.status}.`);
          return;
        }
        const payload = (await response.json()) as { source_context: SourceContext };
        setSourceContext(payload.source_context);
        setSourceError(null);
      })
      .catch((reason: unknown) => {
        setOpeningChunkId(null);
        setSourceError(reason instanceof Error ? reason.message : copy.citationError);
      });
  }

  return (
    <section className="grid grid--two">
      <div className="panel">
        <div className="panel__header">
          <h2>{copy.title}</h2>
          <Bot size={18} aria-hidden="true" />
        </div>
        <div className="panel__body stack">
          <div className="notice">{copy.notice}</div>
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              abortRef.current?.abort();
              const controller = new AbortController();
              abortRef.current = controller;
              setSubmitting(true);
              setStreamingText("");
              setError(null);
              setSourceContext(null);
              setSourceError(null);

              const run = async () => {
                const response = await fetch(withAppBasePath("/api/controlled-document/query-stream"), {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    query: question,
                    document_types: ["project_documentation", "directive", "methodology", "knowledge_base_article", "policy"],
                    classification_max: "internal",
                    tags,
                    max_chunks: 8,
                    response_language: language
                  }),
                  signal: controller.signal,
                });

                if (!response.ok || !response.body) {
                  setError(`${copy.requestFailed} ${response.status}.`);
                  setSubmitting(false);
                  return;
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  buffer += decoder.decode(value, { stream: true });
                  const lines = buffer.split("\n");
                  buffer = lines.pop() ?? "";
                  for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    const raw = line.slice(6).trim();
                    if (!raw) continue;
                    let evt: { kind: string; delta?: string; answer?: RagAnswer };
                    try { evt = JSON.parse(raw) as typeof evt; } catch { continue; }
                    if (evt.kind === "meta" && evt.answer) {
                      setAnswer(evt.answer);
                    } else if (evt.kind === "delta" && evt.delta) {
                      setStreamingText((prev) => prev + evt.delta);
                    } else if (evt.kind === "done" && evt.answer) {
                      setAnswer(evt.answer);
                      setStreamingText("");
                      setSubmitting(false);
                    }
                  }
                }
                setSubmitting(false);
              };

              run().catch((reason: unknown) => {
                if ((reason as { name?: string }).name === "AbortError") return;
                setSubmitting(false);
                setError(reason instanceof Error ? reason.message : copy.requestError);
              });
            }}
          >
            <div className="field">
              <label htmlFor="question">{copy.question}</label>
              <textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="tags-filter">{copy.scope}</label>
              <input id="tags-filter" value={tags} onChange={(event) => setTags(event.target.value)} />
            </div>
            <StratosButton tone="primary" type="submit" disabled={submitting}>
              <Send size={16} aria-hidden="true" />
              {submitting ? copy.asking : copy.ask}
            </StratosButton>
          </form>
          {error ? <div className="notice">{error}</div> : null}
          <article className="answer-block">
            <div className="answer-block__header">
              <h3>{copy.answer}</h3>
              <StatusBadge value={answer.confidence} />
            </div>
            <div className="answer-block__body stack">
              <ReadableAnswer text={streamingText || answer.answer} />
              {answer.warnings.length > 0 ? (
                <div className="notice">
                  <ShieldAlert size={16} aria-hidden="true" />
                  {answer.warnings.join(", ")}
                </div>
              ) : null}
              <AnswerTechnicalDetails answer={answer} copy={copy} />
            </div>
          </article>
        </div>
      </div>

      <aside className="panel">
        <div className="panel__header">
          <h2>{copy.citationViewer}</h2>
          <StatusBadge value={answer.citations.length > 0 ? "valid" : "insufficient_source"} label={`${answer.citations.length} ${copy.citations}`} />
        </div>
        <div className="panel__body stack">
          <CitationList
            citations={answer.citations}
            activeChunkId={sourceContext?.chunk_id}
            openingChunkId={openingChunkId}
            emptyLabel={copy.noCitation}
            labels={copy}
            onOpenCitation={openCitation}
          />
          {sourceError ? <div className="notice">{sourceError}</div> : null}
          {sourceContext ? <SourceContextCard labels={copy} ref={sourceViewerRef} sourceContext={sourceContext} /> : null}
        </div>
      </aside>
    </section>
  );
}

function ReadableAnswer({ text }: { text: string }) {
  const blocks = readableAnswerBlocks(text);
  return (
    <div className="readable-answer">
      {blocks.map((block, index) =>
        block.kind === "bullet" ? (
          <div className="readable-answer__bullet" key={`${block.text}-${index}`}>
            <span aria-hidden="true">•</span>
            <p>{renderAnswerInline(block.text)}</p>
          </div>
        ) : (
          <p key={`${block.text}-${index}`}>{renderAnswerInline(block.text)}</p>
        )
      )}
    </div>
  );
}

function AnswerTechnicalDetails({ answer, copy }: { answer: RagAnswer; copy: Record<string, string> }) {
  const chunkIdsFromText = Array.from(answer.answer.matchAll(/chunk_[a-zA-Z0-9_]+/g), (match) => match[0]);
  const usedChunks = Array.from(new Set([...answer.used_chunks, ...chunkIdsFromText, ...answer.citations.map((citation) => citation.chunk_id)]));
  return (
    <details className="technical-details">
      <summary>{copy.technicalDetailsSummary}</summary>
      <div className="technical-details__body">
        <KeyedLine label={copy.queryId} value={answer.query_id} />
        <KeyedLine label={copy.usedChunks} value={usedChunks.length > 0 ? usedChunks.join(", ") : "n/a"} />
        <KeyedLine label={copy.warnings} value={answer.warnings.length > 0 ? answer.warnings.join(", ") : copy.noTechnicalWarnings} />
      </div>
    </details>
  );
}

function KeyedLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="technical-details__line">
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  );
}

function readableAnswerBlocks(text: string): Array<{ kind: "paragraph" | "bullet"; text: string }> {
  const withoutChunkRefs = text.replace(/\s*\[[^\]]*chunk_[^\]]+\]/g, "");
  const normalized = withoutChunkRefs
    .replace(/\s+\*\s+\*\*/g, "\n- **")
    .replace(/\s+\*\s+/g, "\n- ")
    .replace(/\.\s+-\s+/g, ".\n- ")
    .replace(/\s+-\s+\*\*/g, "\n- **")
    .replace(/\s{2,}/g, " ")
    .trim();
  return normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      kind: line.startsWith("- ") ? "bullet" : "paragraph",
      text: line.replace(/^-\s+/, "")
    }));
}

function renderAnswerInline(text: string) {
  const match = text.match(/^\*\*(.+?):\*\*\s*(.*)$/);
  if (!match) {
    return text;
  }
  return (
    <>
      <strong>{match[1]}:</strong> {match[2]}
    </>
  );
}
