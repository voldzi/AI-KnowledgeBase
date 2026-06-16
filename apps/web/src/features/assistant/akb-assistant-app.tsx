"use client";

import { useMemo, useState } from "react";
import {
  Archive,
  Bot,
  Check,
  Clock3,
  Copy,
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
  Users,
  X
} from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { StratosButton, StratosSelect } from "@/components/stratos";
import { CitationList, CitationModal, SourceContextCard, type CitationViewerLabels } from "@/features/citations/citation-viewer";
import { withAppBasePath } from "@/lib/app-url";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import type {
  AssistantChatResponse,
  AssistantSuggestion,
  Citation,
  ClarificationQuestion,
  SourceContext
} from "@/lib/types";

interface AkbAssistantAppProps {
  initialNowIso: string;
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
}

type AssistantAppLabels = CitationViewerLabels & Record<string, string>;

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

export function AkbAssistantApp({ initialNowIso, suggestions }: AkbAssistantAppProps) {
  const { language } = useLanguage();
  const copy = assistantAppCopy[language];
  const [threads, setThreads] = useState<AssistantThread[]>(() => createInitialThreads(language, initialNowIso));
  const [activeThreadId, setActiveThreadId] = useState(() => "thread-current");
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
    if (!target) {
      return;
    }
    updateThread(activeThread.id, (thread) => ({
      ...thread,
      visibility: "shared",
      sharedWith: [...thread.sharedWith.filter((item) => item.name !== target), { name: target, permission: sharePermission }]
    }));
    setShareTarget("");
    setShareStatus(copy.shareSaved);
  }

  async function copyThreadLink() {
    const link = `${window.location.origin}${withAppBasePath(`/chat?thread=${encodeURIComponent(activeThread.id)}`)}`;
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
              <button className="akb-chat-icon-button" type="button" title={copy.archive} aria-label={copy.archive}>
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
                  openingSourceId={openingSourceId}
                  clarificationValues={clarificationValues}
                  setClarificationValues={setClarificationValues}
                  onOpenSource={openSource}
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
  openingSourceId,
  clarificationValues,
  setClarificationValues,
  onOpenSource,
  onSubmitClarification,
  onOpenCitationViewer
}: {
  message: ChatMessage;
  copy: AssistantAppLabels;
  openingSourceId: string | null;
  clarificationValues: Record<string, string>;
  setClarificationValues: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  onOpenSource: (citation: Citation) => void;
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
        <p>{message.content}</p>
        {message.pending ? <div className="akb-chat-loader" /> : null}
        {response ? (
          <AssistantResponseTools
            response={response}
            copy={copy}
            openingSourceId={openingSourceId}
            clarificationValues={clarificationValues}
            setClarificationValues={setClarificationValues}
            onOpenSource={onOpenSource}
            onSubmitClarification={onSubmitClarification}
            onOpenCitationViewer={onOpenCitationViewer}
          />
        ) : null}
      </div>
    </article>
  );
}

function AssistantResponseTools({
  response,
  copy,
  openingSourceId,
  clarificationValues,
  setClarificationValues,
  onOpenSource,
  onSubmitClarification,
  onOpenCitationViewer
}: {
  response: AssistantChatResponse;
  copy: AssistantAppLabels;
  openingSourceId: string | null;
  clarificationValues: Record<string, string>;
  setClarificationValues: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  onOpenSource: (citation: Citation) => void;
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
      {response.citations.length > 0 ? (
        <div className="akb-chat-citations">
          <div className="akb-chat-citations__header">
            <h3>{copy.sources}</h3>
            <button type="button" className="citation-trigger-btn" onClick={onOpenCitationViewer}>
              {copy.citationViewer} ({response.citations.length})
            </button>
          </div>
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
        <div className="assistant-followups" aria-label={copy.followUps}>
          {response.follow_up_questions.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      ) : null}
    </div>
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

function createInitialThreads(language: AklLanguage, now: string): AssistantThread[] {
  return [
    {
      id: "thread-current",
      conversationId: null,
      title: language === "en" ? "Controlled document question" : "Dotaz k řízeným dokumentům",
      context: {},
      messages: [],
      visibility: "private",
      pinned: true,
      updatedAt: now,
      sharedWith: []
    },
    {
      id: "thread-shared",
      conversationId: null,
      title: language === "en" ? "Exception approval" : "Schvalování výjimek",
      context: {},
      messages: [
        {
          id: "seed-user",
          role: "user",
          content: language === "en" ? "Who approves an exception to a directive?" : "Kdo schvaluje výjimku ze směrnice?",
          createdAt: now
        }
      ],
      visibility: "shared",
      pinned: false,
      updatedAt: now,
      sharedWith: [{ name: "Security reviewers", permission: "viewer" }]
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
    sharedWith: []
  };
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
