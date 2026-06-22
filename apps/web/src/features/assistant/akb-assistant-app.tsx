"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Archive,
  Bot,
  Check,
  Clock3,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  LifeBuoy,
  MessageSquare,
  MessageSquarePlus,
  PanelRightOpen,
  Pin,
  Search,
  Send,
  Share2,
  ShieldAlert,
  Table2,
  Users,
  X
} from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { StratosButton, StratosDataTable, StratosSelect, type StratosDataTableColumn } from "@/components/stratos";
import { CitationList, CitationModal, SourceContextCard, type CitationViewerLabels } from "@/features/citations/citation-viewer";
import { withAppBasePath } from "@/lib/app-url";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import { normalizeAssistantAnswerReports } from "@/lib/reporting/assistant-answer-report";
import type {
  AssistantChatResponse,
  AssistantConversationDetail,
  AssistantConversationListItem,
  AssistantConversationMessage,
  AssistantReportArtifact,
  AssistantReportRow,
  AssistantSuggestion,
  Citation,
  ClarificationQuestion,
  SourceContext
} from "@/lib/types";

interface AkbAssistantAppProps {
  initialNowIso: string;
  initialConversations?: AssistantConversationListItem[];
  suggestions: AssistantSuggestion[];
}

type ThreadVisibility = "private" | "shared";
type SharePermission = "viewer" | "commenter";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  response?: AssistantChatResponse;
  pending?: boolean;
}

interface AssistantThread {
  id: string;
  conversationId: string | null;
  title: string;
  context: Record<string, unknown>;
  messages: ChatMessage[];
  visibility: ThreadVisibility;
  pinned: boolean;
  updatedAt: string;
  sharedWith: Array<{ name: string; permission: SharePermission }>;
  historyLoaded?: boolean;
}

type AssistantAppLabels = CitationViewerLabels & Record<string, string>;

const assistantMarkdownComponents: Components = {
  a({ children, href }) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="akb-chat-message__table-wrap">
        <table>{children}</table>
      </div>
    );
  }
};

const assistantAppCopy = {
  cs: {
    appTitle: "Znalostní chat",
    appSubtitle: "AKB Assistant pro práci s řízenými dokumenty, citacemi a sdílenými vlákny.",
    newThread: "Nové vlákno",
    searchThreads: "Hledat vlákna",
    threadList: "Vlákna",
    pinned: "Připnuté",
    recent: "Nedávné",
    privateThread: "Soukromé",
    sharedThread: "Sdílené",
    ready: "Připraven",
    share: "Sdílet",
    archive: "Archivovat",
    copied: "Zkopírováno",
    copyLink: "Kopírovat odkaz",
    sourcesPanel: "Zdroje odpovědi",
    threadAccess: "Přístup k vláknu",
    noSources: "Zdroje se zobrazí po první odpovědi s citacemi.",
    sourceOpened: "Citace otevřena",
    sourceTitle: "Zdroj odpovědi",
    sourceOpenFailedStatus: "Zdroj se nepodařilo otevřít. Kód odpovědi:",
    sourceOpenFailed: "Zdroj se nepodařilo otevřít.",
    noPreciseSource: "Nenašel jsem dostatečně přesný zdroj.",
    version: "Verze",
    page: "Strana",
    opening: "Otevírám",
    openCitation: "Otevřít citaci",
    openDocument: "Otevřít dokument",
    sourceUnavailable: "zdroj není dostupný",
    copyChunk: "Kopírovat úryvek",
    chunk: "Chunk",
    noSection: "Bez oddílu",
    beforeContext: "Před citací",
    afterContext: "Po citaci",
    composerLabel: "Zeptejte se na dokument, postup nebo odpovědnost",
    composerPlaceholder: "Např. Kdo schvaluje výjimku ze směrnice?",
    ask: "Odeslat",
    asking: "Odesílám",
    emptyQuestion: "Napište dotaz.",
    requestFailedStatus: "Asistent teď neodpověděl. Kód odpovědi:",
    requestFailed: "Dotaz se nepodařilo odeslat.",
    suggestionsLabel: "Doporučené dotazy",
    emptyThreadTitle: "Nové vlákno",
    emptyThreadBody: "Začněte dotazem nebo vyberte doporučení. Každá odpověď má držet citace na konkrétní verze dokumentů.",
    answer: "Odpověď",
    sources: "Použité zdroje",
    clarificationTitle: "Potřebuji doplnit",
    clarificationFallback: "Doplnění pomůže najít správný postup.",
    selectOption: "Vyberte možnost",
    continue: "Pokračovat",
    result: "Výsledek",
    recommendation: "Doporučení:",
    followUps: "Navazující dotazy",
    reports: "Sestavy",
    exportXlsx: "Exportovat Excel",
    exportPdf: "Exportovat PDF",
    exportingReport: "Připravuji Excel",
    exportingPdf: "Připravuji PDF",
    exportReportFailedStatus: "Sestavu se nepodařilo exportovat. Kód odpovědi:",
    exportReportFailed: "Sestavu se nepodařilo exportovat.",
    reportRows: "řádků",
    reportSources: "citovaných zdrojů",
    citationViewer: "Prohlížeč citací",
    shareTitle: "Sdílet vlákno",
    shareTarget: "Uživatel nebo skupina",
    shareTargetPlaceholder: "např. Security reviewers",
    sharePermission: "Oprávnění",
    viewer: "Čtenář",
    commenter: "Komentátor",
    addShare: "Přidat sdílení",
    shareSaved: "Sdílení uloženo pro tuto relaci.",
    shareEmpty: "Zatím nikdo další.",
    close: "Zavřít",
    owner: "Vlastník",
    you: "Vy"
  },
  en: {
    appTitle: "Knowledge chat",
    appSubtitle: "AKB Assistant for controlled documents, citations, and shared threads.",
    newThread: "New thread",
    searchThreads: "Search threads",
    threadList: "Threads",
    pinned: "Pinned",
    recent: "Recent",
    privateThread: "Private",
    sharedThread: "Shared",
    ready: "Ready",
    share: "Share",
    archive: "Archive",
    copied: "Copied",
    copyLink: "Copy link",
    sourcesPanel: "Answer sources",
    threadAccess: "Thread access",
    noSources: "Sources appear after the first cited answer.",
    sourceOpened: "Citation opened",
    sourceTitle: "Answer source",
    sourceOpenFailedStatus: "The source could not be opened. Response code:",
    sourceOpenFailed: "The source could not be opened.",
    noPreciseSource: "I could not find a sufficiently precise source.",
    version: "Version",
    page: "Page",
    opening: "Opening",
    openCitation: "Open citation",
    openDocument: "Open document",
    sourceUnavailable: "source unavailable",
    copyChunk: "Copy excerpt",
    chunk: "Chunk",
    noSection: "No section",
    beforeContext: "Before citation",
    afterContext: "After citation",
    composerLabel: "Ask about a document, procedure, or responsibility",
    composerPlaceholder: "For example: Who approves an exception to a directive?",
    ask: "Send",
    asking: "Sending",
    emptyQuestion: "Enter a question.",
    requestFailedStatus: "The assistant did not respond. Response code:",
    requestFailed: "The question could not be sent.",
    suggestionsLabel: "Suggested questions",
    emptyThreadTitle: "New thread",
    emptyThreadBody: "Start with a question or choose a suggestion. Every answer should keep citations to concrete document versions.",
    answer: "Answer",
    sources: "Sources used",
    clarificationTitle: "I need more details",
    clarificationFallback: "Additional details help find the right procedure.",
    selectOption: "Select an option",
    continue: "Continue",
    result: "Result",
    recommendation: "Recommendation:",
    followUps: "Follow-up questions",
    reports: "Reports",
    exportXlsx: "Export Excel",
    exportPdf: "Export PDF",
    exportingReport: "Preparing Excel",
    exportingPdf: "Preparing PDF",
    exportReportFailedStatus: "The report could not be exported. Response code:",
    exportReportFailed: "The report could not be exported.",
    reportRows: "rows",
    reportSources: "cited sources",
    citationViewer: "Citation viewer",
    shareTitle: "Share thread",
    shareTarget: "User or group",
    shareTargetPlaceholder: "e.g. Security reviewers",
    sharePermission: "Permission",
    viewer: "Viewer",
    commenter: "Commenter",
    addShare: "Add share",
    shareSaved: "Sharing saved for this session.",
    shareEmpty: "No one else yet.",
    close: "Close",
    owner: "Owner",
    you: "You"
  }
} satisfies Record<AklLanguage, AssistantAppLabels>;

export function AkbAssistantApp({ initialNowIso, initialConversations = [], suggestions }: AkbAssistantAppProps) {
  const { language } = useLanguage();
  const copy = assistantAppCopy[language];
  const [threads, setThreads] = useState<AssistantThread[]>(() => createInitialThreads(language, initialNowIso, initialConversations));
  const [activeThreadId, setActiveThreadId] = useState(() => createInitialThreads(language, initialNowIso, initialConversations)[0]?.id ?? "thread-current");
  const [threadSearch, setThreadSearch] = useState("");
  const [composer, setComposer] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sourceContext, setSourceContext] = useState<SourceContext | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [openingSourceId, setOpeningSourceId] = useState<string | null>(null);
  const [citationModalOpen, setCitationModalOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState("");
  const [sharePermission, setSharePermission] = useState<SharePermission>("viewer");
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [clarificationValues, setClarificationValues] = useState<Record<string, string>>({});

  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? threads[0];
  const lastAssistantResponse = findLastAssistantResponse(activeThread);
  const visibleThreads = useMemo(() => {
    const query = threadSearch.trim().toLowerCase();
    const filtered = query
      ? threads.filter((thread) => thread.title.toLowerCase().includes(query))
      : threads;
    return [...filtered].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  }, [threadSearch, threads]);
  const visibleSuggestions = suggestions.slice(0, 4);

  useEffect(() => {
    if (!activeThread?.conversationId || activeThread.historyLoaded) {
      return;
    }
    let active = true;
    fetch(withAppBasePath(`/api/assistant/conversations/${encodeURIComponent(activeThread.conversationId)}`), {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!active || !payload?.conversation) {
          return;
        }
        const loadedThread = threadFromConversation(payload.conversation as AssistantConversationDetail);
        setThreads((current) => current.map((thread) => (thread.id === activeThread.id ? { ...loadedThread, pinned: thread.pinned } : thread)));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [activeThread?.conversationId, activeThread?.historyLoaded, activeThread?.id]);

  function updateThread(threadId: string, updater: (thread: AssistantThread) => AssistantThread) {
    setThreads((current) => current.map((thread) => (thread.id === threadId ? updater(thread) : thread)));
  }

  function createThread() {
    const thread = createEmptyThread(copy.emptyThreadTitle);
    setThreads((current) => [thread, ...current]);
    setActiveThreadId(thread.id);
    setComposer("");
    setStatusMessage(null);
    setSourceContext(null);
    setSourceError(null);
  }

  async function archiveActiveThread() {
    if (!activeThread.conversationId) {
      const remaining = threads.filter((thread) => thread.id !== activeThread.id);
      if (remaining.length) {
        setThreads(remaining);
        setActiveThreadId(remaining[0].id);
      } else {
        const replacement = createEmptyThread(copy.emptyThreadTitle);
        setThreads([replacement]);
        setActiveThreadId(replacement.id);
      }
      return;
    }
    try {
      const response = await fetch(withAppBasePath(`/api/assistant/conversations/${encodeURIComponent(activeThread.conversationId)}`), {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ status: "archived" })
      });
      if (!response.ok) {
        setStatusMessage(`${copy.requestFailedStatus} ${response.status}.`);
        return;
      }
      const remaining = threads.filter((thread) => thread.id !== activeThread.id);
      if (remaining.length) {
        setThreads(remaining);
        setActiveThreadId(remaining[0].id);
      } else {
        const replacement = createEmptyThread(copy.emptyThreadTitle);
        setThreads([replacement]);
        setActiveThreadId(replacement.id);
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : copy.requestFailed);
    }
  }

  async function submitQuestion(nextQuestion = composer, endpoint: "/api/assistant/chat" | "/api/assistant/clarify" = "/api/assistant/chat", nextContext = activeThread.context) {
    const trimmed = nextQuestion.trim();
    if (!trimmed) {
      setStatusMessage(copy.emptyQuestion);
      return;
    }
    if (submitting) {
      return;
    }

    const threadId = activeThread.id;
    const userMessage: ChatMessage = {
      id: createClientId("msg-user"),
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString()
    };
    const pendingMessage: ChatMessage = {
      id: createClientId("msg-assistant"),
      role: "assistant",
      content: copy.asking,
      createdAt: new Date().toISOString(),
      pending: true
    };
    setSubmitting(true);
    setComposer("");
    setStatusMessage(null);
    setSourceContext(null);
    setSourceError(null);
    setClarificationValues({});
    updateThread(threadId, (thread) => ({
      ...thread,
      title: thread.messages.length === 0 ? titleFromQuestion(trimmed) : thread.title,
      messages: [...thread.messages, userMessage, pendingMessage],
      updatedAt: new Date().toISOString()
    }));

    try {
      const httpResponse = await fetch(withAppBasePath(endpoint), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          message: trimmed,
          conversation_id: activeThread.conversationId,
          context: nextContext,
          mode: "ask",
          response_language: language
        })
      });
      if (!httpResponse.ok) {
        setStatusMessage(`${copy.requestFailedStatus} ${httpResponse.status}.`);
        updateThread(threadId, (thread) => ({
          ...thread,
          messages: thread.messages.filter((message) => message.id !== pendingMessage.id)
        }));
        return;
      }
      const payload = (await httpResponse.json()) as { response: AssistantChatResponse };
      const response = payload.response;
      const assistantMessage: ChatMessage = {
        id: createClientId("msg-assistant"),
        role: "assistant",
        content: response.answer ?? response.message ?? response.recommended_action ?? copy.noPreciseSource,
        createdAt: new Date().toISOString(),
        response
      };
      updateThread(threadId, (thread) => ({
        ...thread,
        conversationId: response.conversation_id,
        context: response.current_context ?? nextContext,
        messages: thread.messages.map((message) => (message.id === pendingMessage.id ? assistantMessage : message)),
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : copy.requestFailed);
      updateThread(threadId, (thread) => ({
        ...thread,
        messages: thread.messages.filter((message) => message.id !== pendingMessage.id)
      }));
    } finally {
      setSubmitting(false);
    }
  }

  function submitClarification(response: AssistantChatResponse) {
    const answers = response.questions.reduce<Record<string, string>>((items, question) => {
      const value = clarificationValues[question.id]?.trim();
      if (value) {
        items[question.id] = value;
      }
      return items;
    }, {});
    const nextContext = { ...activeThread.context, ...answers };
    const previousQuestion = [...activeThread.messages].reverse().find((message) => message.role === "user")?.content ?? "";
    void submitQuestion(previousQuestion, "/api/assistant/clarify", nextContext);
  }

  async function openSource(citation: Citation) {
    setOpeningSourceId(citation.chunk_id);
    setStatusMessage(null);
    setSourceError(null);
    setCitationModalOpen(true);
    try {
      const httpResponse = await fetch(withAppBasePath(`/api/assistant/citations/${encodeURIComponent(citation.chunk_id)}/open`), {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      if (!httpResponse.ok) {
        setSourceError(`${copy.sourceOpenFailedStatus} ${httpResponse.status}.`);
        return;
      }
      const payload = (await httpResponse.json()) as { source_context: SourceContext };
      setSourceContext(payload.source_context);
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : copy.sourceOpenFailed);
    } finally {
      setOpeningSourceId(null);
    }
  }

  function addShare() {
    const target = shareTarget.trim();
    if (!target || !activeThread.conversationId) {
      return;
    }
    const nextSharedWith = [...activeThread.sharedWith.filter((item) => item.name !== target), { name: target, permission: sharePermission }];
    fetch(withAppBasePath(`/api/assistant/conversations/${encodeURIComponent(activeThread.conversationId)}/shares`), {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        visibility: "shared",
        shares: nextSharedWith.map((item) => ({
          subject_type: item.name.startsWith("group:") ? "group" : "user",
          subject_id: item.name.replace(/^group:/, ""),
          permission: item.permission
        }))
      })
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`${copy.requestFailedStatus} ${response.status}.`))))
      .then((payload) => {
        const conversation = payload.conversation as AssistantConversationDetail;
        updateThread(activeThread.id, () => threadFromConversation(conversation));
        setShareTarget("");
        setShareStatus(copy.shareSaved);
      })
      .catch((error) => setShareStatus(error instanceof Error ? error.message : copy.requestFailed));
  }

  async function copyThreadLink() {
    const link = `${window.location.origin}${withAppBasePath(`/chat?thread=${encodeURIComponent(activeThread.conversationId ?? activeThread.id)}`)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <section className="akb-chat-app" aria-label="AKB Assistant">
        <aside className="akb-chat-sidebar" aria-label={copy.threadList}>
          <div className="akb-chat-sidebar__brand">
            <div className="akb-chat-mark" aria-hidden="true">
              <Bot size={18} />
            </div>
            <div>
              <strong>AKB Assistant</strong>
              <span>{copy.ready}</span>
            </div>
          </div>
          <StratosButton tone="primary" type="button" onClick={createThread}>
            <MessageSquarePlus size={16} aria-hidden="true" />
            {copy.newThread}
          </StratosButton>
          <label className="akb-chat-search">
            <Search size={15} aria-hidden="true" />
            <input
              value={threadSearch}
              onChange={(event) => setThreadSearch(event.target.value)}
              placeholder={copy.searchThreads}
            />
          </label>
          <div className="akb-chat-thread-list">
            <ThreadGroup
              title={copy.pinned}
              threads={visibleThreads.filter((thread) => thread.pinned)}
              activeThreadId={activeThread.id}
              copy={copy}
              onSelect={setActiveThreadId}
            />
            <ThreadGroup
              title={copy.recent}
              threads={visibleThreads.filter((thread) => !thread.pinned)}
              activeThreadId={activeThread.id}
              copy={copy}
              onSelect={setActiveThreadId}
            />
          </div>
        </aside>

        <main className="akb-chat-main">
          <header className="akb-chat-header">
            <div>
              <h1>{copy.appTitle}</h1>
              <p>{copy.appSubtitle}</p>
            </div>
            <div className="akb-chat-header__actions">
              <button className="akb-chat-icon-button" type="button" onClick={() => void archiveActiveThread()} title={copy.archive} aria-label={copy.archive}>
                <Archive size={16} aria-hidden="true" />
              </button>
              <button className="akb-chat-icon-button" type="button" onClick={copyThreadLink} title={copy.copyLink} aria-label={copy.copyLink}>
                {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              </button>
              <StratosButton type="button" onClick={() => setShareOpen(true)}>
                <Share2 size={16} aria-hidden="true" />
                {copy.share}
              </StratosButton>
            </div>
          </header>

          <section className="akb-chat-transcript" aria-live="polite">
            {activeThread.messages.length === 0 ? (
              <div className="akb-chat-empty">
                <MessageSquare size={24} aria-hidden="true" />
                <h2>{copy.emptyThreadTitle}</h2>
                <p>{copy.emptyThreadBody}</p>
                <div className="akb-chat-suggestions" aria-label={copy.suggestionsLabel}>
                  {visibleSuggestions.map((suggestion) => (
                    <button
                      key={`${suggestion.domain}-${suggestion.label}`}
                      type="button"
                      onClick={() => void submitQuestion(suggestion.prompt)}
                    >
                      <span>{suggestion.label}</span>
                      <small>{suggestion.domain}</small>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              activeThread.messages.map((message) => (
                <ChatBubble
                  key={message.id}
                  message={message}
                  copy={copy}
                  clarificationValues={clarificationValues}
                  setClarificationValues={setClarificationValues}
                  onSubmitClarification={submitClarification}
                  onOpenCitationViewer={() => setCitationModalOpen(true)}
                />
              ))
            )}
          </section>

          {statusMessage ? (
            <div className="notice akb-chat-status">
              <ShieldAlert size={16} aria-hidden="true" />
              {statusMessage}
            </div>
          ) : null}

          <form
            className="akb-chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void submitQuestion();
            }}
          >
            <label htmlFor="akb-chat-composer">{copy.composerLabel}</label>
            <div className="akb-chat-composer__box">
              <textarea
                id="akb-chat-composer"
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                placeholder={copy.composerPlaceholder}
                rows={2}
              />
              <button type="submit" disabled={submitting} aria-label={submitting ? copy.asking : copy.ask}>
                <Send size={17} aria-hidden="true" />
              </button>
            </div>
          </form>
        </main>

        <aside className="akb-chat-context" aria-label={copy.sourcesPanel}>
          <div className="akb-chat-context__header">
            <div>
              <h2>{copy.sourcesPanel}</h2>
              <span>{lastAssistantResponse?.citations.length ?? 0} cit.</span>
            </div>
            <PanelRightOpen size={17} aria-hidden="true" />
          </div>
          <div className="akb-chat-context__body">
            {lastAssistantResponse?.citations.length ? (
              <CitationList
                citations={lastAssistantResponse.citations}
                activeChunkId={sourceContext?.chunk_id}
                openingChunkId={openingSourceId}
                emptyLabel={copy.noPreciseSource}
                labels={copy}
                onOpenCitation={openSource}
              />
            ) : (
              <div className="assistant-source-empty">
                <FileText size={20} aria-hidden="true" />
                {copy.noSources}
              </div>
            )}
            {sourceError ? <div className="notice">{sourceError}</div> : null}
            {sourceContext ? <SourceContextCard labels={copy} sourceContext={sourceContext} showStatus={false} /> : null}
          </div>
          <div className="akb-chat-access">
            <h3>{copy.threadAccess}</h3>
            <div className="akb-chat-access__row">
              <span>{copy.owner}</span>
              <strong>{copy.you}</strong>
            </div>
            {activeThread.sharedWith.length ? (
              activeThread.sharedWith.map((item) => (
                <div className="akb-chat-access__row" key={item.name}>
                  <span>{item.permission === "viewer" ? copy.viewer : copy.commenter}</span>
                  <strong>{item.name}</strong>
                </div>
              ))
            ) : (
              <p>{copy.shareEmpty}</p>
            )}
          </div>
        </aside>
      </section>

      <CitationModal
        open={citationModalOpen}
        onClose={() => setCitationModalOpen(false)}
        title={copy.sourceTitle}
        citations={lastAssistantResponse?.citations ?? []}
        activeChunkId={sourceContext?.chunk_id}
        openingChunkId={openingSourceId}
        sourceContext={sourceContext}
        sourceError={sourceError}
        emptyLabel={copy.noPreciseSource}
        labels={copy}
        onOpenCitation={openSource}
      />

      {shareOpen ? (
        <div className="akb-share-backdrop" role="dialog" aria-modal="true" aria-label={copy.shareTitle}>
          <div className="akb-share-dialog">
            <div className="akb-share-dialog__header">
              <h2>{copy.shareTitle}</h2>
              <button type="button" onClick={() => setShareOpen(false)} aria-label={copy.close}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="akb-share-dialog__body">
              <label className="field" htmlFor="akb-share-target">
                <span>{copy.shareTarget}</span>
                <input
                  id="akb-share-target"
                  value={shareTarget}
                  onChange={(event) => {
                    setShareTarget(event.target.value);
                    setShareStatus(null);
                  }}
                  placeholder={copy.shareTargetPlaceholder}
                />
              </label>
              <StratosSelect
                id="akb-share-permission"
                label={copy.sharePermission}
                value={sharePermission}
                onChange={(event) => setSharePermission(event.target.value as SharePermission)}
              >
                <option value="viewer">{copy.viewer}</option>
                <option value="commenter">{copy.commenter}</option>
              </StratosSelect>
              <StratosButton tone="primary" type="button" onClick={addShare}>
                <Users size={16} aria-hidden="true" />
                {copy.addShare}
              </StratosButton>
              {shareStatus ? <div className="notice">{shareStatus}</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ThreadGroup({
  title,
  threads,
  activeThreadId,
  copy,
  onSelect
}: {
  title: string;
  threads: AssistantThread[];
  activeThreadId: string;
  copy: AssistantAppLabels;
  onSelect: (threadId: string) => void;
}) {
  if (threads.length === 0) {
    return null;
  }
  return (
    <div className="akb-chat-thread-group">
      <h2>{title}</h2>
      {threads.map((thread) => (
        <button
          className={`akb-chat-thread ${thread.id === activeThreadId ? "is-active" : ""}`}
          type="button"
          key={thread.id}
          onClick={() => onSelect(thread.id)}
        >
          <span className="akb-chat-thread__icon" aria-hidden="true">
            {thread.pinned ? <Pin size={13} /> : <MessageSquare size={13} />}
          </span>
          <span className="akb-chat-thread__label">
            <strong>{thread.title}</strong>
            <small>
              {thread.visibility === "shared" ? copy.sharedThread : copy.privateThread} · {formatThreadTime(thread.updatedAt)}
            </small>
          </span>
        </button>
      ))}
    </div>
  );
}

function ChatBubble({
  message,
  copy,
  clarificationValues,
  setClarificationValues,
  onSubmitClarification,
  onOpenCitationViewer
}: {
  message: ChatMessage;
  copy: AssistantAppLabels;
  clarificationValues: Record<string, string>;
  setClarificationValues: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  onSubmitClarification: (response: AssistantChatResponse) => void;
  onOpenCitationViewer: () => void;
}) {
  const response = message.response;
  return (
    <article className={`akb-chat-message akb-chat-message--${message.role}`}>
      <div className="akb-chat-message__avatar" aria-hidden="true">
        {message.role === "assistant" ? <Bot size={16} /> : <Users size={16} />}
      </div>
      <div className="akb-chat-message__body">
        <div className="akb-chat-message__meta">
          <strong>{message.role === "assistant" ? "AKB Assistant" : copy.you}</strong>
          <span>
            <Clock3 size={12} aria-hidden="true" />
            {formatThreadTime(message.createdAt)}
          </span>
          {response?.confidence ? <StatusBadge value={response.confidence} /> : null}
        </div>
        <ChatMessageContent role={message.role} content={message.content} />
        {message.pending ? <div className="akb-chat-loader" /> : null}
        {response ? (
          <AssistantResponseTools
            response={response}
            copy={copy}
            clarificationValues={clarificationValues}
            setClarificationValues={setClarificationValues}
            onSubmitClarification={onSubmitClarification}
            onOpenCitationViewer={onOpenCitationViewer}
          />
        ) : null}
      </div>
    </article>
  );
}

function ChatMessageContent({ role, content }: { role: ChatMessage["role"]; content: string }) {
  if (role !== "assistant") {
    return <p>{content}</p>;
  }

  return (
    <div className="akb-chat-message__markdown">
      <ReactMarkdown components={assistantMarkdownComponents} remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function AssistantResponseTools({
  response,
  copy,
  clarificationValues,
  setClarificationValues,
  onSubmitClarification,
  onOpenCitationViewer
}: {
  response: AssistantChatResponse;
  copy: AssistantAppLabels;
  clarificationValues: Record<string, string>;
  setClarificationValues: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  onSubmitClarification: (response: AssistantChatResponse) => void;
  onOpenCitationViewer: () => void;
}) {
  if (response.response_type === "clarification_needed") {
    return (
      <div className="akb-chat-clarification">
        <h3>{copy.clarificationTitle}</h3>
        <p>{response.why_needed ?? copy.clarificationFallback}</p>
        <div className="clarification-grid">
          {response.questions.map((question) => (
            <ClarificationField
              key={question.id}
              question={question}
              value={clarificationValues[question.id] ?? ""}
              copy={copy}
              onChange={(value) => setClarificationValues((current) => ({ ...current, [question.id]: value }))}
            />
          ))}
        </div>
        <StratosButton tone="primary" type="button" onClick={() => onSubmitClarification(response)}>
          <Send size={16} aria-hidden="true" />
          {copy.continue}
        </StratosButton>
      </div>
    );
  }

  if (response.response_type === "handoff_recommended" || response.response_type === "no_answer") {
    return response.recommended_action ? (
      <div className="notice">
        <LifeBuoy size={16} aria-hidden="true" />
        {copy.recommendation} {response.recommended_action}
      </div>
    ) : null;
  }

  return (
    <div className="akb-chat-answer-tools">
      {response.warnings.length ? (
        <div className="notice">
          <ShieldAlert size={16} aria-hidden="true" />
          {response.warnings.join(", ")}
        </div>
      ) : null}
      {response.report_artifacts.length > 0 ? (
        <div className="akb-chat-reports">
          <h3>{copy.reports}</h3>
          {response.report_artifacts.map((report) => (
            <AssistantReportPanel key={report.artifact_id} report={report} copy={copy} />
          ))}
        </div>
      ) : null}
      {response.citations.length > 0 ? (
        <div className="akb-chat-citations akb-chat-citations--compact">
          <button type="button" className="citation-trigger-btn" onClick={onOpenCitationViewer}>
            {copy.citationViewer} ({response.citations.length})
          </button>
        </div>
      ) : null}
      {response.follow_up_questions.length > 0 ? (
        <div className="assistant-followups" aria-label={copy.followUps}>
          {response.follow_up_questions.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AssistantReportPanel({ report, copy }: { report: AssistantReportArtifact; copy: AssistantAppLabels }) {
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const columns: Array<StratosDataTableColumn<AssistantReportRow>> = report.columns.map((column) => ({
    id: column.key,
    label: column.label,
    minWidth: column.type === "number" ? 96 : 150,
    width: column.key === "summary" ? "minmax(240px, 1.6fr)" : undefined,
    sortable: true,
    sortAccessor: (row) => sortableCellValue(row.cells[column.key]),
    align: column.type === "number" || column.type === "currency" || column.type === "percent" ? "end" : "start",
    render: (row) => formatReportCell(row.cells[column.key])
  }));

  async function exportReport(format: "xlsx" | "pdf") {
    if (exporting) {
      return;
    }
    setExporting(format);
    setExportError(null);
    try {
      const response = await fetch(withAppBasePath("/api/assistant/reports/export"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report, format })
      });
      if (!response.ok) {
        setExportError(`${copy.exportReportFailedStatus} ${response.status}.`);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filenameFromDisposition(response.headers.get("content-disposition")) ?? `akb-report.${format}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : copy.exportReportFailed);
    } finally {
      setExporting(null);
    }
  }

  return (
    <section className="akb-chat-report">
      <div className="akb-chat-report__header">
        <div>
          <span className="akb-chat-report__eyebrow">
            <Table2 size={14} aria-hidden="true" />
            {report.rows.length} {copy.reportRows} · {report.source_citation_count} {copy.reportSources}
          </span>
          <h4>{report.title}</h4>
          {report.description ? <p>{report.description}</p> : null}
        </div>
        <div className="akb-chat-report__actions">
          {report.export_formats.includes("xlsx") ? (
            <StratosButton type="button" onClick={() => void exportReport("xlsx")}>
              {exporting === "xlsx" ? <FileSpreadsheet size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
              {exporting === "xlsx" ? copy.exportingReport : copy.exportXlsx}
            </StratosButton>
          ) : null}
          {report.export_formats.includes("pdf") ? (
            <StratosButton type="button" onClick={() => void exportReport("pdf")}>
              {exporting === "pdf" ? <FileText size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
              {exporting === "pdf" ? copy.exportingPdf : copy.exportPdf}
            </StratosButton>
          ) : null}
        </div>
      </div>
      <StratosDataTable
        rows={report.rows}
        columns={columns}
        getRowId={(row) => row.row_id}
        emptyLabel={copy.noPreciseSource}
        aria-label={report.title}
      />
      {report.warnings.length ? <div className="akb-chat-report__warnings">{report.warnings.join(", ")}</div> : null}
      {exportError ? <div className="notice">{exportError}</div> : null}
    </section>
  );
}

function ClarificationField({
  question,
  value,
  copy,
  onChange
}: {
  question: ClarificationQuestion;
  value: string;
  copy: AssistantAppLabels;
  onChange: (value: string) => void;
}) {
  if (question.type === "single_choice") {
    return (
      <StratosSelect
        id={`akb-clarification-${question.id}`}
        label={question.question}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{copy.selectOption}</option>
        {question.options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </StratosSelect>
    );
  }

  return (
    <label className="field" htmlFor={`akb-clarification-${question.id}`}>
      <span>{question.question}</span>
      <input id={`akb-clarification-${question.id}`} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function formatReportCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "Ano" : "Ne";
  }
  return String(value);
}

function sortableCellValue(value: string | number | boolean | null | undefined): string | number | null {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return value ? String(value) : null;
}

function filenameFromDisposition(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return null;
    }
  }
  return /filename="([^"]+)"/i.exec(value)?.[1] ?? null;
}

function createInitialThreads(
  language: AklLanguage,
  now: string,
  conversations: AssistantConversationListItem[] = []
): AssistantThread[] {
  if (conversations.length > 0) {
    return conversations.map((conversation, index) => threadFromConversationListItem(conversation, index === 0));
  }
  return [
    {
      id: "thread-current",
      conversationId: null,
      title: language === "en" ? "New thread" : "Nové vlákno",
      context: {},
      messages: [],
      visibility: "private",
      pinned: true,
      updatedAt: now,
      sharedWith: [],
      historyLoaded: true
    }
  ];
}

function createEmptyThread(title: string): AssistantThread {
  return {
    id: createClientId("thread"),
    conversationId: null,
    title,
    context: {},
    messages: [],
    visibility: "private",
    pinned: false,
    updatedAt: new Date().toISOString(),
    sharedWith: [],
    historyLoaded: true
  };
}

function threadFromConversationListItem(conversation: AssistantConversationListItem, pinned: boolean): AssistantThread {
  return {
    id: threadIdFromConversationId(conversation.conversation_id),
    conversationId: conversation.conversation_id,
    title: conversation.title ?? "AKB chat",
    context: {},
    messages: [],
    visibility: conversation.visibility,
    pinned,
    updatedAt: conversation.updated_at,
    sharedWith: conversation.shared_with.map((share) => ({
      name: shareName(share.subject_type, share.subject_id),
      permission: share.permission
    })),
    historyLoaded: false
  };
}

function threadFromConversation(conversation: AssistantConversationDetail): AssistantThread {
  return {
    id: threadIdFromConversationId(conversation.conversation_id),
    conversationId: conversation.conversation_id,
    title: conversation.title ?? "AKB chat",
    context: {},
    messages: conversation.messages.map((message) => messageFromConversationMessage(conversation.conversation_id, message)),
    visibility: conversation.visibility,
    pinned: false,
    updatedAt: conversation.updated_at,
    sharedWith: conversation.shared_with.map((share) => ({
      name: shareName(share.subject_type, share.subject_id),
      permission: share.permission
    })),
    historyLoaded: true
  };
}

function messageFromConversationMessage(conversationId: string, message: AssistantConversationMessage): ChatMessage {
  return {
    id: message.message_id,
    role: message.role,
    content: message.content,
    createdAt: message.created_at,
    response: message.role === "assistant" ? responseFromPersistedMessage(conversationId, message) : undefined
  };
}

function responseFromPersistedMessage(
  conversationId: string,
  message: AssistantConversationMessage
): AssistantChatResponse {
  const metadata = message.metadata ?? {};
  const response: AssistantChatResponse = {
    response_type: message.response_type ?? "answer",
    conversation_id: conversationId,
    answer: message.content,
    message: null,
    questions: [],
    why_needed: null,
    current_context: objectValue(metadata.current_context),
    citations: message.citations,
    follow_up_questions: [],
    suggested_actions: [],
    report_artifacts: reportArtifactsValue(metadata.report_artifacts),
    confidence: typeof metadata.confidence === "string" ? metadata.confidence as AssistantChatResponse["confidence"] : null,
    warnings: Array.isArray(metadata.warnings) ? metadata.warnings.filter((item): item is string => typeof item === "string") : [],
    missing_information: null,
    recommended_action: null
  };
  return normalizeAssistantAnswerReports(response, "", "cs");
}

function threadIdFromConversationId(conversationId: string): string {
  return `thread_${conversationId}`;
}

function shareName(subjectType: string, subjectId: string): string {
  return subjectType === "group" ? `group:${subjectId}` : subjectId;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function reportArtifactsValue(value: unknown): AssistantReportArtifact[] {
  return Array.isArray(value) ? value.filter((item): item is AssistantReportArtifact => Boolean(item && typeof item === "object")) : [];
}

function findLastAssistantResponse(thread: AssistantThread): AssistantChatResponse | null {
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const response = thread.messages[index]?.response;
    if (response) {
      return response;
    }
  }
  return null;
}

function titleFromQuestion(question: string): string {
  const compact = question.replace(/\s+/g, " ").trim();
  if (compact.length <= 48) {
    return compact;
  }
  return `${compact.slice(0, 45)}...`;
}

function createClientId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatThreadTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Prague"
  }).format(date);
}
