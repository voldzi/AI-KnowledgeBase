"use client";

import { useEffect, useState } from "react";
import { Bot, Copy, ExternalLink, FileText, Send, ShieldAlert } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sourceContext, setSourceContext] = useState<SourceContext | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [openingChunkId, setOpeningChunkId] = useState<string | null>(null);

  useEffect(() => {
    setQuestion(chatCopy[language].defaultQuestion);
  }, [language]);

  function openCitation(citation: Citation) {
    setOpeningChunkId(citation.chunk_id);
    setSourceError(null);
    fetch(`/api/controlled-document/citations/${encodeURIComponent(citation.chunk_id)}/open`, {
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
              setSubmitting(true);
              setError(null);
              fetch("/api/controlled-document/query", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  query: question,
                  document_types: ["project_documentation", "directive", "methodology", "knowledge_base_article", "policy"],
                  classification_max: "internal",
                  tags,
                  max_chunks: 8,
                  response_language: language
                })
              })
                .then(async (response) => {
                  setSubmitting(false);
                  if (!response.ok) {
                    setError(`${copy.requestFailed} ${response.status}.`);
                    return;
                  }
                  const payload = (await response.json()) as { answer: RagAnswer };
                  setAnswer(payload.answer);
                })
                .catch((reason: unknown) => {
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
            <button className="button button--primary" type="submit" disabled={submitting}>
              <Send size={16} aria-hidden="true" />
              {submitting ? copy.asking : copy.ask}
            </button>
          </form>
          {error ? <div className="notice">{error}</div> : null}
          <article className="answer-block">
            <div className="answer-block__header">
              <h3>{copy.answer}</h3>
              <StatusBadge value={answer.confidence} />
            </div>
            <div className="answer-block__body stack">
              <p>{answer.answer}</p>
              {answer.warnings.length > 0 ? (
                <div className="notice">
                  <ShieldAlert size={16} aria-hidden="true" />
                  {answer.warnings.join(", ")}
                </div>
              ) : null}
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
          {answer.citations.length > 0 ? (
            answer.citations.map((citation) => (
              <article className="timeline-item" key={citation.chunk_id}>
                <strong>{citation.document_title}</strong>
                <span>{copy.version} {citation.version_label} - {copy.page} {citation.page_number ?? "n/a"}</span>
                <span>{citation.section_path.join(" / ")} - {citation.chunk_id}</span>
                <button className="button citation-open-button" type="button" onClick={() => openCitation(citation)} disabled={openingChunkId === citation.chunk_id}>
                  <ExternalLink size={15} aria-hidden="true" />
                  {openingChunkId === citation.chunk_id ? copy.opening : copy.openCitation}
                </button>
              </article>
            ))
          ) : (
            <div className="empty-state">{copy.noCitation}</div>
          )}
          {sourceError ? <div className="notice">{sourceError}</div> : null}
          {sourceContext ? (
            <article className="source-viewer">
              <div className="source-viewer__header">
                <div>
                  <h3>{sourceContext.document_title}</h3>
                  <span>{sourceContext.viewer_mode} viewer - {sourceContext.source_file_name ?? copy.sourceUnavailable}</span>
                </div>
                <StatusBadge value="valid" label={sourceContext.viewer_mode} />
              </div>
              <div className="source-viewer__meta">
                <span>{copy.chunk} {sourceContext.chunk_id}</span>
                <span>{copy.version} {sourceContext.document_version_id}</span>
                <span>{copy.page} {sourceContext.location.page_number ?? "n/a"}</span>
                <span>{sourceContext.location.section_path.join(" / ") || copy.noSection}</span>
              </div>
              {sourceContext.source_file_uri ? (
                <div className="source-uri">
                  <FileText size={15} aria-hidden="true" />
                  <span>{sourceContext.source_file_uri}</span>
                </div>
              ) : null}
              <pre className="chunk-text">{sourceContext.chunk_text}</pre>
              <button
                className="button"
                type="button"
                onClick={() => navigator.clipboard.writeText(sourceContext.chunk_text)}
              >
                <Copy size={15} aria-hidden="true" />
                {copy.copyChunk}
              </button>
              {sourceContext.warnings.length > 0 ? (
                <div className="notice">
                  <ShieldAlert size={16} aria-hidden="true" />
                  {sourceContext.warnings.join(", ")}
                </div>
              ) : null}
            </article>
          ) : null}
        </div>
      </aside>
    </section>
  );
}
