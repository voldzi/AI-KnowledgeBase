"use client";

import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, CheckCircle2, HelpCircle, LifeBuoy, Send, ShieldAlert } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { StratosButton, StratosSelect } from "@/components/stratos";
import { CitationList, SourceContextCard } from "@/features/citations/citation-viewer";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import type {
  AssistantChatResponse,
  AssistantSuggestion,
  Citation,
  ClarificationQuestion,
  SourceContext
} from "@/lib/types";

interface EmployeeAssistantProps {
  suggestions: AssistantSuggestion[];
}

const assistantCopy = {
  cs: {
    defaultQuestion: "Jaká je architektura AKL platformy?",
    title: "ČSÚ znalostní asistent",
    subtitle: "Odpovídá z platných dokumentů a u odpovědi ukazuje použité zdroje.",
    ready: "Připraven",
    questionPanel: "Dotaz",
    suggestionsLabel: "Doporučené dotazy",
    questionLabel: "Na co se chcete zeptat?",
    ask: "Zeptat se",
    asking: "Odesílám",
    emptyQuestion: "Napište dotaz.",
    requestFailedStatus: "Asistent teď neodpověděl. Kód odpovědi:",
    requestFailed: "Dotaz se nepodařilo odeslat.",
    sourceOpenFailedStatus: "Zdroj se nepodařilo otevřít. Kód odpovědi:",
    sourceOpenFailed: "Zdroj se nepodařilo otevřít.",
    emptyState: "Zeptejte se na postup, odpovědnost, schvalování nebo kde najít správný dokument.",
    sourceTitle: "Zdroj odpovědi",
    sourceOpen: "otevřen",
    sourceOpened: "Citace otevřena",
    sourceWaiting: "čeká",
    sourceFileMissing: "Soubor není dostupný",
    version: "Verze",
    page: "Strana",
    opening: "Otevírám",
    openCitation: "Otevřít citaci",
    openDocument: "Otevřít dokument",
    sourceUnavailable: "zdroj není dostupný",
    copyChunk: "Kopírovat úryvek",
    chunk: "Chunk",
    noSection: "Bez oddílu",
    sourceEmpty: "Po otevření zdroje se zde zobrazí citovaná část dokumentu.",
    clarificationTitle: "Potřebuji doplnit",
    clarificationFallback: "Doplnění pomůže najít správný postup.",
    selectOption: "Vyberte možnost",
    continue: "Pokračovat",
    result: "Výsledek",
    noPreciseSource: "Nenašel jsem dostatečně přesný zdroj.",
    recommendation: "Doporučení:",
    answer: "Odpověď",
    sources: "Použité zdroje",
    sourceDocument: "Zdrojový dokument",
    waitingForSuggestions: "Načítám doporučené dotazy"
  },
  en: {
    defaultQuestion: "What is the architecture of the AKL platform?",
    title: "CSO knowledge assistant",
    subtitle: "Answers from valid documents and shows the sources used for each answer.",
    ready: "Ready",
    questionPanel: "Question",
    suggestionsLabel: "Suggested questions",
    questionLabel: "What would you like to ask?",
    ask: "Ask",
    asking: "Sending",
    emptyQuestion: "Enter a question.",
    requestFailedStatus: "The assistant did not respond. Response code:",
    requestFailed: "The question could not be sent.",
    sourceOpenFailedStatus: "The source could not be opened. Response code:",
    sourceOpenFailed: "The source could not be opened.",
    emptyState: "Ask about a procedure, responsibility, approval, or where to find the right document.",
    sourceTitle: "Answer source",
    sourceOpen: "open",
    sourceOpened: "Citation opened",
    sourceWaiting: "waiting",
    sourceFileMissing: "File is not available",
    version: "Version",
    page: "Page",
    opening: "Opening",
    openCitation: "Open citation",
    openDocument: "Open document",
    sourceUnavailable: "source unavailable",
    copyChunk: "Copy excerpt",
    chunk: "Chunk",
    noSection: "No section",
    sourceEmpty: "After opening a source, the cited part of the document will appear here.",
    clarificationTitle: "I need more details",
    clarificationFallback: "Additional details help find the right procedure.",
    selectOption: "Select an option",
    continue: "Continue",
    result: "Result",
    noPreciseSource: "I could not find a sufficiently precise source.",
    recommendation: "Recommendation:",
    answer: "Answer",
    sources: "Sources used",
    sourceDocument: "Source document",
    waitingForSuggestions: "Loading suggested questions"
  }
} satisfies Record<AklLanguage, Record<string, string>>;

export function EmployeeAssistant({ suggestions }: EmployeeAssistantProps) {
  const { language } = useLanguage();
  const copy = assistantCopy[language];
  const [question, setQuestion] = useState(copy.defaultQuestion);
  const [context, setContext] = useState<Record<string, unknown>>({});
  const [response, setResponse] = useState<AssistantChatResponse | null>(null);
  const [localizedSuggestions, setLocalizedSuggestions] = useState(suggestions);
  const [clarificationValues, setClarificationValues] = useState<Record<string, string>>({});
  const [sourceContext, setSourceContext] = useState<SourceContext | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [openingSourceId, setOpeningSourceId] = useState<string | null>(null);

  const visibleSuggestions = useMemo(() => localizedSuggestions.slice(0, 6), [localizedSuggestions]);

  useEffect(() => {
    let cancelled = false;
    setQuestion(assistantCopy[language].defaultQuestion);
    setResponse(null);
    setSourceContext(null);
    fetch(`/api/assistant/suggestions?language=${language}`, { headers: { Accept: "application/json" } })
      .then(async (httpResponse) => {
        if (!httpResponse.ok) {
          return;
        }
        const payload = (await httpResponse.json()) as { suggestions: AssistantSuggestion[] };
        if (!cancelled) {
          setLocalizedSuggestions(payload.suggestions);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLocalizedSuggestions(suggestions);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [language, suggestions]);

  async function ask(nextQuestion = question, nextContext = context, endpoint = "/api/assistant/chat") {
    const trimmed = nextQuestion.trim();
    if (!trimmed) {
      setStatusMessage(copy.emptyQuestion);
      return;
    }
    setSubmitting(true);
    setStatusMessage(null);
    setSourceContext(null);
    try {
      const httpResponse = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          message: trimmed,
          conversation_id: response?.conversation_id ?? null,
          context: nextContext,
          mode: "it_support_answer",
          response_language: language
        })
      });
      if (!httpResponse.ok) {
        setStatusMessage(`${copy.requestFailedStatus} ${httpResponse.status}.`);
        return;
      }
      const payload = (await httpResponse.json()) as { response: AssistantChatResponse };
      setResponse(payload.response);
      setContext(payload.response.current_context ?? nextContext);
      setClarificationValues({});
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : copy.requestFailed);
    } finally {
      setSubmitting(false);
    }
  }

  function submitClarification(questions: ClarificationQuestion[]) {
    const answers = questions.reduce<Record<string, string>>((items, item) => {
      const value = clarificationValues[item.id]?.trim();
      if (value) {
        items[item.id] = value;
      }
      return items;
    }, {});
    const nextContext = { ...context, ...answers };
    setContext(nextContext);
    void ask(question, nextContext, "/api/assistant/clarify");
  }

  async function openSource(citation: Citation) {
    setOpeningSourceId(citation.chunk_id);
    setStatusMessage(null);
    try {
      const httpResponse = await fetch(`/api/assistant/citations/${encodeURIComponent(citation.chunk_id)}/open`, {
        method: "GET",
        headers: { Accept: "application/json" }
      });
      if (!httpResponse.ok) {
        setStatusMessage(`${copy.sourceOpenFailedStatus} ${httpResponse.status}.`);
        return;
      }
      const payload = (await httpResponse.json()) as { source_context: SourceContext };
      setSourceContext(payload.source_context);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : copy.sourceOpenFailed);
    } finally {
      setOpeningSourceId(null);
    }
  }

  return (
    <section className="assistant-workspace">
      <div className="assistant-main">
        <header className="assistant-header">
          <div>
            <h1>{copy.title}</h1>
            <p>{copy.subtitle}</p>
          </div>
          <span className="assistant-header__status">
            <CheckCircle2 size={16} aria-hidden="true" />
            {copy.ready}
          </span>
        </header>

        <section className="assistant-panel">
          <div className="assistant-panel__header">
            <h2>{copy.questionPanel}</h2>
            <HelpCircle size={18} aria-hidden="true" />
          </div>
          <div className="assistant-panel__body stack">
            <div className="assistant-suggestions" aria-label={copy.suggestionsLabel}>
              {visibleSuggestions.map((suggestion) => (
                <button
                  className="suggestion-button"
                  key={`${suggestion.domain}-${suggestion.label}`}
                  type="button"
                  onClick={() => {
                    setQuestion(suggestion.prompt);
                    void ask(suggestion.prompt, context);
                  }}
                >
                  <span>{suggestion.label}</span>
                  <small>{suggestion.domain}</small>
                </button>
              ))}
            </div>

            <form
              className="assistant-question-form"
              onSubmit={(event) => {
                event.preventDefault();
                void ask();
              }}
            >
              <label htmlFor="employee-question">{copy.questionLabel}</label>
              <textarea id="employee-question" value={question} onChange={(event) => setQuestion(event.target.value)} />
              <StratosButton tone="primary" type="submit" disabled={submitting}>
                <Send size={16} aria-hidden="true" />
                {submitting ? copy.asking : copy.ask}
              </StratosButton>
            </form>

            {statusMessage ? (
              <div className="notice">
                <ShieldAlert size={16} aria-hidden="true" />
                {statusMessage}
              </div>
            ) : null}
          </div>
        </section>

        {response ? (
          <AssistantResponse
            openingSourceId={openingSourceId}
            response={response}
            clarificationValues={clarificationValues}
            setClarificationValues={setClarificationValues}
            onSubmitClarification={submitClarification}
            onOpenSource={openSource}
            copy={copy}
          />
        ) : (
          <section className="assistant-empty">
            <BookOpen size={22} aria-hidden="true" />
            <span>{copy.emptyState}</span>
          </section>
        )}
      </div>

      <aside className="assistant-source-panel">
        <div className="assistant-source-panel__header">
          <h2>{copy.sourceTitle}</h2>
          <StatusBadge value={sourceContext ? "valid" : "insufficient_source"} label={sourceContext ? copy.sourceOpen : copy.sourceWaiting} />
        </div>
        {sourceContext ? (
          <div className="assistant-source-panel__body">
            <SourceContextCard labels={copy} sourceContext={sourceContext} />
          </div>
        ) : (
          <div className="assistant-source-empty">
            <BookOpen size={20} aria-hidden="true" />
            <span>{copy.sourceEmpty}</span>
          </div>
        )}
      </aside>
    </section>
  );
}

interface AssistantResponseProps {
  response: AssistantChatResponse;
  clarificationValues: Record<string, string>;
  setClarificationValues: Dispatch<SetStateAction<Record<string, string>>>;
  openingSourceId: string | null;
  onSubmitClarification: (questions: ClarificationQuestion[]) => void;
  onOpenSource: (citation: Citation) => void;
  copy: (typeof assistantCopy)[AklLanguage];
}

function AssistantResponse({
  response,
  clarificationValues,
  setClarificationValues,
  openingSourceId,
  onSubmitClarification,
  onOpenSource,
  copy
}: AssistantResponseProps) {
  if (response.response_type === "clarification_needed") {
    return (
      <section className="assistant-panel">
        <div className="assistant-panel__header">
          <h2>{copy.clarificationTitle}</h2>
          <HelpCircle size={18} aria-hidden="true" />
        </div>
        <div className="assistant-panel__body stack">
          <p className="assistant-copy">{response.why_needed ?? copy.clarificationFallback}</p>
          <div className="clarification-grid">
            {response.questions.map((question) => (
              <div className="field" key={question.id}>
                {question.type === "single_choice" ? (
                  <StratosSelect
                    id={`assistant-clarification-${question.id}`}
                    label={question.question}
                    value={clarificationValues[question.id] ?? ""}
                    onChange={(event) =>
                      setClarificationValues((current) => ({ ...current, [question.id]: event.target.value }))
                    }
                  >
                    <option value="">{copy.selectOption}</option>
                    {question.options.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </StratosSelect>
                ) : (
                  <label className="field" htmlFor={`assistant-clarification-${question.id}`}>
                    <span>{question.question}</span>
                    <input
                      id={`assistant-clarification-${question.id}`}
                      value={clarificationValues[question.id] ?? ""}
                      onChange={(event) =>
                        setClarificationValues((current) => ({ ...current, [question.id]: event.target.value }))
                      }
                    />
                  </label>
                )}
              </div>
            ))}
          </div>
          <StratosButton tone="primary" type="button" onClick={() => onSubmitClarification(response.questions)}>
            <Send size={16} aria-hidden="true" />
            {copy.continue}
          </StratosButton>
        </div>
      </section>
    );
  }

  if (response.response_type === "handoff_recommended" || response.response_type === "no_answer") {
    return (
      <section className="assistant-panel">
        <div className="assistant-panel__header">
          <h2>{copy.result}</h2>
          <LifeBuoy size={18} aria-hidden="true" />
        </div>
        <div className="assistant-panel__body stack">
          <p className="assistant-copy">{response.answer ?? copy.noPreciseSource}</p>
          {response.recommended_action ? (
            <div className="notice">
              <LifeBuoy size={16} aria-hidden="true" />
              {copy.recommendation} {response.recommended_action}
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="assistant-panel">
      <div className="assistant-panel__header">
        <h2>{copy.answer}</h2>
        <StatusBadge value={response.confidence ?? "valid"} />
      </div>
      <div className="assistant-panel__body stack">
        <p className="assistant-copy">{response.answer}</p>
        {response.citations.length > 0 ? (
          <div className="assistant-sources">
            <h3>{copy.sources}</h3>
            <CitationList
              citations={response.citations}
              openingChunkId={openingSourceId}
              emptyLabel={copy.noPreciseSource}
              labels={copy}
              onOpenCitation={onOpenSource}
            />
          </div>
        ) : null}
        {response.follow_up_questions.length > 0 ? (
          <div className="assistant-followups">
            {response.follow_up_questions.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
