"use client";

import { useState } from "react";
import { Bot, Send, ShieldAlert } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import type { RagAnswer } from "@/lib/types";

interface KnowledgeChatProps {
  initialAnswer: RagAnswer;
}

export function KnowledgeChat({ initialAnswer }: KnowledgeChatProps) {
  const [question, setQuestion] = useState("Jak se schvaluje vyjimka z bezpecnostnich pravidel?");
  const [tags, setTags] = useState("controlled-document,phase02");
  const [answer, setAnswer] = useState(initialAnswer);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <section className="grid grid--two">
      <div className="panel">
        <div className="panel__header">
          <h2>Knowledge chat</h2>
          <Bot size={18} aria-hidden="true" />
        </div>
        <div className="panel__body stack">
          <div className="notice">
            RAG answers must include citations. No-answer states remain visible when sources are insufficient.
          </div>
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
                  document_types: ["directive", "methodology", "knowledge_base_article", "policy"],
                  classification_max: "internal",
                  tags,
                  max_chunks: 8
                })
              })
                .then(async (response) => {
                  setSubmitting(false);
                  if (!response.ok) {
                    setError(`RAG API returned HTTP ${response.status}.`);
                    return;
                  }
                  const payload = (await response.json()) as { answer: RagAnswer };
                  setAnswer(payload.answer);
                })
                .catch((reason: unknown) => {
                  setSubmitting(false);
                  setError(reason instanceof Error ? reason.message : "RAG request failed.");
                });
            }}
          >
            <div className="field">
              <label htmlFor="question">Question</label>
              <textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="tags-filter">Tags filter</label>
              <input id="tags-filter" value={tags} onChange={(event) => setTags(event.target.value)} />
            </div>
            <button className="button button--primary" type="submit" disabled={submitting}>
              <Send size={16} aria-hidden="true" />
              {submitting ? "Asking" : "Ask with citations"}
            </button>
          </form>
          {error ? <div className="notice">{error}</div> : null}
          <article className="answer-block">
            <div className="answer-block__header">
              <h3>Answer</h3>
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
          <h2>Citation viewer</h2>
          <StatusBadge value={answer.citations.length > 0 ? "valid" : "insufficient_source"} label={`${answer.citations.length} citations`} />
        </div>
        <div className="panel__body stack">
          {answer.citations.length > 0 ? (
            answer.citations.map((citation) => (
              <article className="timeline-item" key={citation.chunk_id}>
                <strong>{citation.document_title}</strong>
                <span>Version {citation.version_label} - page {citation.page_number ?? "n/a"}</span>
                <span>{citation.section_path.join(" / ")} - {citation.chunk_id}</span>
              </article>
            ))
          ) : (
            <div className="empty-state">No citation can be shown for this answer.</div>
          )}
        </div>
      </aside>
    </section>
  );
}
