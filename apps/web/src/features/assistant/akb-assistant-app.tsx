"use client";

import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Archive,
  BarChart3,
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
  PanelLeftOpen,
  PanelRightOpen,
  Pencil,
  Pin,
  PinOff,
  Search,
  Send,
  Share2,
  ShieldAlert,
  Table2,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Users,
  X
} from "lucide-react";
import { DirectoryPersonPicker as PersonPicker } from "@voldzi/stratos-ui";

import { StatusBadge } from "@/components/status-badge";
import { StratosButton, StratosDataTable, StratosSelect, type StratosDataTableColumn } from "@/components/stratos";
import { CitationList, CitationModal, SourceContextCard, type CitationViewerLabels } from "@/features/citations/citation-viewer";
import { conversationShareUrl } from "@/features/assistant/conversation-navigation";
import { withAppBasePath } from "@/lib/app-url";
import {
  ASSISTANT_REPORT_REQUEST_CONTEXT_KEY,
  ASSISTANT_REPORT_TEMPLATE_DEFAULT_COLUMNS,
  assistantReportColumnLabel,
  type AssistantReportColumnKey,
  type AssistantReportDetailLevel,
  type AssistantReportExportPreference,
  type AssistantReportRequest,
  type AssistantReportTemplate
} from "@/lib/assistant/assistant-report-request";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import {
  directoryUserDisplayName,
  directoryUsersToPeople,
} from "@/lib/directory-people";
import { normalizeAssistantAnswerReports } from "@/lib/reporting/assistant-answer-report";
import type {
  AssistantChatResponse,
  AssistantChartArtifact,
  AssistantConversationDetail,
  AssistantConversationListItem,
  AssistantConversationMessage,
  AssistantMessageFeedback,
  AssistantMessageFeedbackRating,
  AssistantMessageFeedbackReason,
  AssistantReportArtifact,
  AssistantReportRow,
  AssistantSuggestion,
  Citation,
  ClarificationQuestion,
  DirectoryUser,
  SourceContext
} from "@/lib/types";
import { finiteNumber } from "@/lib/reporting/assistant-chart";

interface AkbAssistantAppProps {
  currentSubjectId: string;
  initialNowIso: string;
  initialConversations?: AssistantConversationListItem[];
  initialConversationId?: string | null;
  initialHistoryUnavailable?: boolean;
  initialRequestedThreadUnavailable?: boolean;
  suggestions: AssistantSuggestion[];
}

type ThreadVisibility = "private" | "shared";
type SharePermission = "viewer" | "commenter";
type ThreadFilter = "active" | "shared" | "archived";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  authorSubjectId?: string;
  authorSubjectType?: "user" | "service";
  authorDisplayName?: string | null;
  response?: AssistantChatResponse;
  pending?: boolean;
  persisted?: boolean;
  feedback?: AssistantMessageFeedback | null;
  feedbackSaving?: boolean;
}

interface AssistantThread {
  id: string;
  conversationId: string | null;
  ownerSubjectId: string | null;
  title: string;
  context: Record<string, unknown>;
  messages: ChatMessage[];
  draft: string;
  status: "active" | "archived";
  visibility: ThreadVisibility;
  pinned: boolean;
  updatedAt: string;
  retentionUntil: string | null;
  sharedWith: Array<{
    subjectType: "user" | "group";
    subjectId: string;
    displayName: string;
    permission: SharePermission;
  }>;
  historyLoaded?: boolean;
}

type AssistantAppLabels = CitationViewerLabels & Record<string, string>;
type SlashCommandId = "report" | "types" | "excel" | "pdf" | "new_thread";

interface SlashCommandOption {
  id: SlashCommandId;
  token: string;
  label: string;
}

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
  },
  td({ children }) {
    return (
      <td>
        {hasMarkdownCellContent(children)
          ? children
          : <span className="akb-chat-message__empty-cell">neuvedeno</span>}
      </td>
    );
  }
};

function hasMarkdownCellContent(children: ReactNode): boolean {
  if (children === null || children === undefined || children === false) {
    return false;
  }
  if (typeof children === "string" || typeof children === "number") {
    return String(children).trim().length > 0;
  }
  if (Array.isArray(children)) {
    return children.some((child) => hasMarkdownCellContent(child));
  }
  return true;
}

const assistantAppCopy = {
  cs: {
    appTitle: "Znalostní chat",
    appSubtitle: "AKB Assistant pro práci s řízenými dokumenty, citacemi a sdílenými vlákny.",
    newThread: "Nové vlákno",
    searchThreads: "Hledat vlákna",
    threadList: "Vlákna",
    pinned: "Připnuté",
    recent: "Nedávné",
    activeThreads: "Moje aktivní",
    sharedWithMe: "Sdílené se mnou",
    archivedThreads: "Archiv",
    privateThread: "Soukromé",
    sharedThread: "Sdílené",
    ready: "Připraven",
    share: "Sdílet",
    archive: "Archivovat",
    restore: "Obnovit z archivu",
    pinThread: "Připnout",
    unpinThread: "Odepnout",
    renameThread: "Přejmenovat",
    renameTitle: "Přejmenovat vlákno",
    renameLabel: "Název vlákna",
    renameSave: "Uložit název",
    renameFailed: "Název se nepodařilo uložit.",
    threadUpdateFailed: "Změnu vlákna se nepodařilo uložit.",
    archivedReadOnly: "Archivované vlákno je pouze pro čtení. Pro pokračování je nejprve obnovte.",
    deleteThread: "Trvale odstranit",
    deleteTitle: "Trvale odstranit vlákno?",
    deleteBody: "Zprávy i sdílení budou nenávratně odstraněny. Zůstane pouze obsahově prázdný auditní záznam o odstranění.",
    deleteRetention: "Automatické odstranění je jinak naplánováno na",
    deleteCancel: "Ponechat vlákno",
    deletingThread: "Odstraňuji…",
    deleteFailed: "Vlákno se nepodařilo odstranit. Zkuste to prosím znovu.",
    deleteSucceeded: "Vlákno bylo trvale odstraněno.",
    copied: "Zkopírováno",
    copyLink: "Kopírovat odkaz",
    sourcesPanel: "Zdroje odpovědi",
    threadAccess: "Přístup k vláknu",
    noSources: "Zdroje se zobrazí po první odpovědi s citacemi.",
    sourceOpened: "Citace otevřena",
    sourceTitle: "Zdroj odpovědi",
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
    requestFailed: "Dotaz se nepodařilo odeslat. Zkuste to prosím znovu.",
    assistantServiceUnavailable: "AI služba teď není dostupná. Zkuste to prosím za chvíli znovu.",
    sessionExpired: "Relace vypršela. Přesměrovávám na přihlášení.",
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
    reportMode: "Sestava",
    reportModeActive: "Sestava zapnuta",
    reportTemplate: "Typ výstupu",
    reportTemplateObligations: "Povinnosti",
    reportTemplateSources: "Souhrn zdrojů",
    reportTemplateDecision: "Rozhodovací matice",
    reportDetail: "Detail",
    reportDetailBrief: "Stručný",
    reportDetailStandard: "Standardní",
    reportDetailDetailed: "Detailní",
    reportExport: "Export",
    reportExportXlsxOnly: "Excel",
    reportExportPdfOnly: "PDF",
    reportExportBoth: "Excel + PDF",
    reportColumns: "Sloupce",
    exportXlsx: "Exportovat Excel",
    exportPdf: "Exportovat PDF",
    exportingReport: "Připravuji Excel",
    exportingPdf: "Připravuji PDF",
    exportReportFailed: "Sestavu se nepodařilo exportovat.",
    reportRows: "řádků",
    reportSources: "citovaných zdrojů",
    warningRowsTruncated: "Zobrazená sestava je zkrácená na bezpečný počet řádků.",
    warningRegistryScanLimit: "Výsledek může být neúplný, protože prohledávání narazilo na provozní limit.",
    warningConversationNotPersisted: "Odpověď je dostupná, ale vlákno se teď nepodařilo uložit.",
    warningReportAdjusted: "Sestava byla upravena do bezpečného exportovatelného formátu.",
    warningGeneric: "Odpověď obsahuje provozní upozornění.",
    feedbackHelpful: "Pomohlo",
    feedbackNotHelpful: "Nepomohlo",
    feedbackPrompt: "Co bylo potřeba zlepšit?",
    feedbackIncomplete: "Odpověď je neúplná",
    feedbackIncorrect: "Odpověď není správná",
    feedbackCitation: "Problém se zdrojem nebo citací",
    feedbackAccess: "Problém s přístupem ke zdroji",
    feedbackOther: "Jiný důvod",
    feedbackSaved: "Děkujeme, hodnocení bylo uloženo.",
    feedbackFailed: "Hodnocení se nepodařilo uložit.",
    citationViewer: "Prohlížeč citací",
    shareTitle: "Sdílet vlákno",
    shareTarget: "Osoba z adresáře",
    shareTargetPlaceholder: "Vyberte zaměstnance",
    shareDirectoryTitle: "Adresář zaměstnanců",
    shareDirectorySearch: "Hledat jméno, e-mail nebo účet",
    shareDirectoryEmpty: "Nebyla nalezena žádná aktivní osoba.",
    shareDirectoryLoading: "Načítám adresář…",
    shareDirectoryFailed: "Adresář osob se nepodařilo načíst.",
    sharePermission: "Oprávnění",
    viewer: "Čtenář",
    commenter: "Komentátor",
    addShare: "Přidat sdílení",
    shareSaving: "Ukládám sdílení…",
    shareFailed: "Sdílení se nepodařilo uložit. Zkuste to prosím znovu.",
    shareSaved: "Sdílení bylo bezpečně uloženo.",
    shareEmpty: "Zatím nikdo další.",
    shareAfterFirstMessage: "Vlákno lze sdílet po uložení první odpovědi.",
    historyUnavailable: "Historii se nepodařilo načíst. Nový dotaz můžete zadat a načtení historie zkusit později.",
    requestedThreadUnavailable: "Požadované vlákno není dostupné nebo k němu nemáte přístup.",
    historySourceAccessChanged: "Přístup ke zdrojům této historické odpovědi se změnil. Položte dotaz znovu, aby AKB použila pouze aktuálně dostupné zdroje.",
    close: "Zavřít",
    owner: "Vlastník",
    anotherUser: "Uživatel",
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
    activeThreads: "My active",
    sharedWithMe: "Shared with me",
    archivedThreads: "Archive",
    privateThread: "Private",
    sharedThread: "Shared",
    ready: "Ready",
    share: "Share",
    archive: "Archive",
    restore: "Restore from archive",
    pinThread: "Pin",
    unpinThread: "Unpin",
    renameThread: "Rename",
    renameTitle: "Rename thread",
    renameLabel: "Thread name",
    renameSave: "Save name",
    renameFailed: "The name could not be saved.",
    threadUpdateFailed: "The thread change could not be saved.",
    archivedReadOnly: "An archived thread is read-only. Restore it before continuing.",
    deleteThread: "Delete permanently",
    deleteTitle: "Permanently delete this thread?",
    deleteBody: "Messages and sharing will be removed permanently. Only a content-free deletion audit record will remain.",
    deleteRetention: "Automatic deletion is otherwise scheduled for",
    deleteCancel: "Keep thread",
    deletingThread: "Deleting…",
    deleteFailed: "The thread could not be deleted. Please try again.",
    deleteSucceeded: "The thread was permanently deleted.",
    copied: "Copied",
    copyLink: "Copy link",
    sourcesPanel: "Answer sources",
    threadAccess: "Thread access",
    noSources: "Sources appear after the first cited answer.",
    sourceOpened: "Citation opened",
    sourceTitle: "Answer source",
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
    requestFailed: "The question could not be sent. Please try again.",
    assistantServiceUnavailable: "The AI service is unavailable. Please try again shortly.",
    sessionExpired: "The session expired. Redirecting to sign in.",
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
    reportMode: "Report",
    reportModeActive: "Report enabled",
    reportTemplate: "Output type",
    reportTemplateObligations: "Obligations",
    reportTemplateSources: "Source summary",
    reportTemplateDecision: "Decision matrix",
    reportDetail: "Detail",
    reportDetailBrief: "Brief",
    reportDetailStandard: "Standard",
    reportDetailDetailed: "Detailed",
    reportExport: "Export",
    reportExportXlsxOnly: "Excel",
    reportExportPdfOnly: "PDF",
    reportExportBoth: "Excel + PDF",
    reportColumns: "Columns",
    exportXlsx: "Export Excel",
    exportPdf: "Export PDF",
    exportingReport: "Preparing Excel",
    exportingPdf: "Preparing PDF",
    exportReportFailed: "The report could not be exported.",
    reportRows: "rows",
    reportSources: "cited sources",
    warningRowsTruncated: "The report is truncated to a safe row limit.",
    warningRegistryScanLimit: "The result may be incomplete because the scan reached an operational limit.",
    warningConversationNotPersisted: "The answer is available, but the thread could not be saved right now.",
    warningReportAdjusted: "The report was adjusted into a safe exportable format.",
    warningGeneric: "The answer contains an operational notice.",
    feedbackHelpful: "Helpful",
    feedbackNotHelpful: "Not helpful",
    feedbackPrompt: "What should be improved?",
    feedbackIncomplete: "The answer is incomplete",
    feedbackIncorrect: "The answer is incorrect",
    feedbackCitation: "Source or citation problem",
    feedbackAccess: "Source access problem",
    feedbackOther: "Another reason",
    feedbackSaved: "Thank you. Your feedback was saved.",
    feedbackFailed: "Feedback could not be saved.",
    citationViewer: "Citation viewer",
    shareTitle: "Share thread",
    shareTarget: "Directory person",
    shareTargetPlaceholder: "Select an employee",
    shareDirectoryTitle: "Employee directory",
    shareDirectorySearch: "Search name, email, or account",
    shareDirectoryEmpty: "No active person was found.",
    shareDirectoryLoading: "Loading directory…",
    shareDirectoryFailed: "The people directory could not be loaded.",
    sharePermission: "Permission",
    viewer: "Viewer",
    commenter: "Commenter",
    addShare: "Add share",
    shareSaving: "Saving sharing…",
    shareFailed: "Sharing could not be saved. Please try again.",
    shareSaved: "Sharing was saved securely.",
    shareEmpty: "No one else yet.",
    shareAfterFirstMessage: "The thread can be shared after its first answer has been saved.",
    historyUnavailable: "Conversation history could not be loaded. You can ask a new question and try loading history later.",
    requestedThreadUnavailable: "The requested thread is unavailable or you do not have access to it.",
    historySourceAccessChanged: "Access to the sources for this historical answer has changed. Ask the question again so AKB uses only sources currently available to you.",
    close: "Close",
    owner: "Owner",
    anotherUser: "User",
    you: "You"
  }
} satisfies Record<AklLanguage, AssistantAppLabels>;

export function AkbAssistantApp({
  currentSubjectId,
  initialNowIso,
  initialConversations = [],
  initialConversationId = null,
  initialHistoryUnavailable = false,
  initialRequestedThreadUnavailable = false,
  suggestions
}: AkbAssistantAppProps) {
  const { language } = useLanguage();
  const copy = assistantAppCopy[language];
  const [threads, setThreads] = useState<AssistantThread[]>(() => createInitialThreads(language, initialNowIso, initialConversations));
  const [activeThreadId, setActiveThreadId] = useState(() => initialActiveThreadId(initialConversations, initialConversationId));
  const [threadSearch, setThreadSearch] = useState("");
  const [threadFilter, setThreadFilter] = useState<ThreadFilter>("active");
  const [mobileThreadsOpen, setMobileThreadsOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(() => {
    if (initialRequestedThreadUnavailable) {
      return assistantAppCopy[language].requestedThreadUnavailable;
    }
    if (initialHistoryUnavailable) {
      return assistantAppCopy[language].historyUnavailable;
    }
    return null;
  });
  const [submitting, setSubmitting] = useState(false);
  const [sourceContext, setSourceContext] = useState<SourceContext | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [openingSourceId, setOpeningSourceId] = useState<string | null>(null);
  const [citationModalOpen, setCitationModalOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<DirectoryUser | null>(null);
  const [sharePermission, setSharePermission] = useState<SharePermission>("viewer");
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [shareSaving, setShareSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingThread, setDeletingThread] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [clarificationValues, setClarificationValues] = useState<Record<string, string>>({});
  const [reportModeEnabled, setReportModeEnabled] = useState(false);
  const [reportTemplate, setReportTemplate] = useState<AssistantReportTemplate>("obligation_table");
  const [reportDetailLevel, setReportDetailLevel] = useState<AssistantReportDetailLevel>("standard");
  const [reportExportFormat, setReportExportFormat] = useState<AssistantReportExportPreference>("xlsx");
  const [reportColumns, setReportColumns] = useState<AssistantReportColumnKey[]>(ASSISTANT_REPORT_TEMPLATE_DEFAULT_COLUMNS.obligation_table);

  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? threads[0];
  const canManageActiveThread = !activeThread?.conversationId ||
    activeThread.ownerSubjectId === currentSubjectId;
  const composer = activeThread?.draft ?? "";
  const lastAssistantResponse = findLastAssistantResponse(activeThread);
  const visibleThreads = useMemo(() => {
    const query = threadSearch.trim().toLowerCase();
    const byView = threads.filter((thread) => {
      if (threadFilter === "archived") {
        return thread.status === "archived";
      }
      if (thread.status !== "active") {
        return false;
      }
      if (threadFilter === "shared") {
        return thread.ownerSubjectId !== currentSubjectId;
      }
      return thread.ownerSubjectId === currentSubjectId || thread.ownerSubjectId === null;
    });
    const filtered = query
      ? byView.filter((thread) => thread.title.toLowerCase().includes(query))
      : byView;
    return [...filtered].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  }, [currentSubjectId, threadFilter, threadSearch, threads]);
  const visibleSuggestions = suggestions.slice(0, 4);
  const visibleSlashCommands = useMemo(() => slashCommandOptions(composer, language), [composer, language]);

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
        const loadedThread = threadFromConversation(
          payload.conversation as AssistantConversationDetail,
          language
        );
        setThreads((current) => current.map((thread) => (
          thread.id === activeThread.id ? { ...loadedThread, pinned: thread.pinned, draft: thread.draft } : thread
        )));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [activeThread?.conversationId, activeThread?.historyLoaded, activeThread?.id, language]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (activeThread?.conversationId) {
      url.searchParams.set("thread", activeThread.conversationId);
    } else {
      url.searchParams.delete("thread");
    }
    if (url.toString() !== window.location.href) {
      window.history.replaceState(window.history.state, "", url.toString());
    }
  }, [activeThread?.conversationId]);

  function updateThread(threadId: string, updater: (thread: AssistantThread) => AssistantThread) {
    setThreads((current) => current.map((thread) => (thread.id === threadId ? updater(thread) : thread)));
  }

  function updateActiveDraft(value: string) {
    const threadId = activeThread?.id;
    if (!threadId) {
      return;
    }
    updateThread(threadId, (thread) => ({ ...thread, draft: value }));
  }

  function selectThread(threadId: string) {
    setActiveThreadId(threadId);
    setStatusMessage(null);
    setSourceContext(null);
    setSourceError(null);
    setOpeningSourceId(null);
    setCitationModalOpen(false);
    setMobileThreadsOpen(false);
  }

  function createThread() {
    const thread = createEmptyThread(copy.emptyThreadTitle);
    setThreads((current) => [thread, ...current]);
    setActiveThreadId(thread.id);
    setThreadFilter("active");
    setStatusMessage(null);
    setSourceContext(null);
    setSourceError(null);
    setMobileThreadsOpen(false);
  }

  function removeThreadFromView(threadId: string, successMessage?: string) {
    const remaining = threads.filter((thread) => thread.id !== threadId);
    if (remaining.length) {
      setThreads(remaining);
      setActiveThreadId(remaining[0].id);
    } else {
      const replacement = createEmptyThread(copy.emptyThreadTitle);
      setThreads([replacement]);
      setActiveThreadId(replacement.id);
    }
    setDeleteOpen(false);
    if (successMessage) {
      setStatusMessage(successMessage);
    }
  }

  function redirectToLoginAfterUnauthorized() {
    setStatusMessage(copy.sessionExpired);
    window.setTimeout(() => {
      const returnTo = window.location.pathname === "/" ? "/" : "/chat";
      window.location.assign(withAppBasePath(`/api/auth/login?return_to=${encodeURIComponent(returnTo)}`));
    }, 250);
  }

  async function archiveActiveThread() {
    if (!activeThread.conversationId) {
      removeThreadFromView(activeThread.id);
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
        if (response.status === 401) {
          redirectToLoginAfterUnauthorized();
          return;
        }
        setStatusMessage(copy.threadUpdateFailed);
        return;
      }
      const payload = await response.json() as {
        conversation: AssistantConversationDetail;
      };
      const archived = threadFromConversation(payload.conversation, language);
      const nextThreads = threads.map((thread) => (
        thread.id === activeThread.id ? archived : thread
      ));
      const nextActive = nextThreads.find(
        (thread) => thread.status === "active"
          && (thread.ownerSubjectId === currentSubjectId || thread.ownerSubjectId === null),
      );
      if (nextActive) {
        setThreads(nextThreads);
        setActiveThreadId(nextActive.id);
      } else {
        const replacement = createEmptyThread(copy.emptyThreadTitle);
        setThreads([replacement, ...nextThreads]);
        setActiveThreadId(replacement.id);
      }
      setThreadFilter("active");
    } catch (error) {
      setStatusMessage(copy.threadUpdateFailed);
    }
  }

  async function restoreActiveThread() {
    if (!activeThread.conversationId || !canManageActiveThread) {
      return;
    }
    try {
      const response = await fetch(
        withAppBasePath(
          `/api/assistant/conversations/${encodeURIComponent(activeThread.conversationId)}`,
        ),
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ status: "active" }),
        },
      );
      if (!response.ok) {
        if (response.status === 401) {
          redirectToLoginAfterUnauthorized();
          return;
        }
        setStatusMessage(copy.threadUpdateFailed);
        return;
      }
      const payload = await response.json() as {
        conversation: AssistantConversationDetail;
      };
      updateThread(
        activeThread.id,
        () => threadFromConversation(payload.conversation, language),
      );
      setThreadFilter("active");
    } catch {
      setStatusMessage(copy.threadUpdateFailed);
    }
  }

  async function toggleActiveThreadPin() {
    if (!activeThread.conversationId || !canManageActiveThread) {
      return;
    }
    try {
      const response = await fetch(
        withAppBasePath(
          `/api/assistant/conversations/${encodeURIComponent(activeThread.conversationId)}`,
        ),
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ pinned: !activeThread.pinned }),
        },
      );
      if (!response.ok) {
        if (response.status === 401) {
          redirectToLoginAfterUnauthorized();
          return;
        }
        setStatusMessage(copy.threadUpdateFailed);
        return;
      }
      const payload = await response.json() as {
        conversation: AssistantConversationDetail;
      };
      updateThread(
        activeThread.id,
        () => threadFromConversation(payload.conversation, language),
      );
    } catch {
      setStatusMessage(copy.threadUpdateFailed);
    }
  }

  async function renameActiveThread() {
    const title = renameValue.replace(/\s+/g, " ").trim();
    if (!activeThread.conversationId || !canManageActiveThread || !title) {
      return;
    }
    setRenameSaving(true);
    try {
      const response = await fetch(
        withAppBasePath(
          `/api/assistant/conversations/${encodeURIComponent(activeThread.conversationId)}`,
        ),
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ title }),
        },
      );
      if (!response.ok) {
        setStatusMessage(copy.renameFailed);
        return;
      }
      const payload = await response.json() as {
        conversation: AssistantConversationDetail;
      };
      updateThread(
        activeThread.id,
        () => threadFromConversation(payload.conversation, language),
      );
      setRenameOpen(false);
    } catch {
      setStatusMessage(copy.renameFailed);
    } finally {
      setRenameSaving(false);
    }
  }

  async function deleteActiveThread() {
    if (
      !activeThread.conversationId ||
      activeThread.ownerSubjectId !== currentSubjectId ||
      deletingThread
    ) {
      return;
    }
    setDeletingThread(true);
    try {
      const response = await fetch(
        withAppBasePath(
          `/api/assistant/conversations/${encodeURIComponent(activeThread.conversationId)}`,
        ),
        {
          method: "DELETE",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok) {
        if (response.status === 401) {
          redirectToLoginAfterUnauthorized();
          return;
        }
        setStatusMessage(copy.deleteFailed);
        return;
      }
      removeThreadFromView(activeThread.id, copy.deleteSucceeded);
    } catch {
      setStatusMessage(copy.deleteFailed);
    } finally {
      setDeletingThread(false);
    }
  }

  async function submitQuestion(nextQuestion = composer, endpoint: "/api/assistant/chat" | "/api/assistant/clarify" = "/api/assistant/chat", nextContext = activeThread.context) {
    if (activeThread.status === "archived") {
      setStatusMessage(copy.archivedReadOnly);
      return;
    }
    const trimmed = nextQuestion.trim();
    if (!trimmed) {
      setStatusMessage(copy.emptyQuestion);
      return;
    }
    if (submitting) {
      return;
    }

    const threadId = activeThread.id;
    const effectiveContext = contextWithReportRequest(nextContext, reportModeEnabled ? {
      enabled: true,
      output_kind: "table",
      template: reportTemplate,
      detail_level: reportDetailLevel,
      export_format: reportExportFormat,
      columns: reportColumns,
      require_row_citations: true
    } : null);
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
    setStatusMessage(null);
    setSourceContext(null);
    setSourceError(null);
    setClarificationValues({});
    updateThread(threadId, (thread) => ({
      ...thread,
      title: thread.messages.length === 0 ? titleFromQuestion(trimmed) : thread.title,
      draft: "",
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
          context: effectiveContext,
          mode: "ask",
          response_language: language
        })
      });
      if (!httpResponse.ok) {
        if (httpResponse.status === 401) {
          redirectToLoginAfterUnauthorized();
          updateThread(threadId, (thread) => ({
            ...thread,
            messages: thread.messages.filter((message) => message.id !== pendingMessage.id)
          }));
          return;
        }
        setStatusMessage(await assistantHttpErrorMessage(httpResponse, copy));
        updateThread(threadId, (thread) => ({
          ...thread,
          messages: thread.messages.filter((message) => message.id !== pendingMessage.id)
        }));
        return;
      }
      const payload = (await httpResponse.json()) as {
        response: AssistantChatResponse;
        message_id?: string | null;
      };
      const response = payload.response;
      const assistantMessage: ChatMessage = {
        id: payload.message_id ?? createClientId("msg-assistant"),
        role: "assistant",
        content: response.answer ?? response.message ?? response.recommended_action ?? copy.noPreciseSource,
        createdAt: new Date().toISOString(),
        response,
        persisted: Boolean(payload.message_id),
      };
      updateThread(threadId, (thread) => ({
        ...thread,
        conversationId: response.conversation_id,
        ownerSubjectId: thread.ownerSubjectId ?? currentSubjectId,
        context: response.current_context ?? effectiveContext,
        messages: thread.messages.map((message) => (message.id === pendingMessage.id ? assistantMessage : message)),
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      setStatusMessage(copy.requestFailed);
      updateThread(threadId, (thread) => ({
        ...thread,
        messages: thread.messages.filter((message) => message.id !== pendingMessage.id)
      }));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitMessageFeedback(
    messageId: string,
    rating: AssistantMessageFeedbackRating,
    reasonCode: AssistantMessageFeedbackReason | null,
  ) {
    if (!activeThread.conversationId) {
      return;
    }
    updateThread(activeThread.id, (thread) => ({
      ...thread,
      messages: thread.messages.map((message) => (
        message.id === messageId
          ? { ...message, feedbackSaving: true }
          : message
      )),
    }));
    try {
      const response = await fetch(
        withAppBasePath(
          `/api/assistant/conversations/${encodeURIComponent(activeThread.conversationId)}/messages/${encodeURIComponent(messageId)}/feedback`,
        ),
        {
          method: "PUT",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            rating,
            reason_code: reasonCode,
          }),
        },
      );
      if (!response.ok) {
        if (response.status === 401) {
          redirectToLoginAfterUnauthorized();
          return;
        }
        setStatusMessage(copy.feedbackFailed);
        return;
      }
      const payload = (await response.json()) as {
        feedback: AssistantMessageFeedback;
      };
      updateThread(activeThread.id, (thread) => ({
        ...thread,
        messages: thread.messages.map((message) => (
          message.id === messageId
            ? {
                ...message,
                feedback: payload.feedback,
                feedbackSaving: false,
              }
            : message
        )),
      }));
      setStatusMessage(copy.feedbackSaved);
    } catch {
      setStatusMessage(copy.feedbackFailed);
    } finally {
      updateThread(activeThread.id, (thread) => ({
        ...thread,
        messages: thread.messages.map((message) => (
          message.id === messageId
            ? { ...message, feedbackSaving: false }
            : message
        )),
      }));
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    if (visibleSlashCommands.length && composer.trimStart().startsWith("/")) {
      applySlashCommand(visibleSlashCommands[0].id);
      return;
    }
    void submitQuestion();
  }

  function applySlashCommand(commandId: SlashCommandId) {
    setStatusMessage(null);
    const remainder = removeLeadingSlashToken(composer);
    if (commandId === "new_thread") {
      createThread();
      return;
    }
    if (commandId === "types") {
      setReportModeEnabled(false);
      updateActiveDraft(language === "en"
        ? "Create a report with document type and count."
        : "Vytvoř sestavu, kde bude typ dokumentu a počet.");
      return;
    }
    updateActiveDraft(remainder);
    setReportModeEnabled(true);
    if (commandId === "excel") {
      setReportExportFormat("xlsx");
      return;
    }
    if (commandId === "pdf") {
      setReportExportFormat("pdf");
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

  function changeReportTemplate(value: AssistantReportTemplate) {
    setReportTemplate(value);
    setReportColumns(ASSISTANT_REPORT_TEMPLATE_DEFAULT_COLUMNS[value]);
  }

  function toggleReportColumn(column: AssistantReportColumnKey) {
    setReportColumns((current) => {
      if (current.includes(column)) {
        return current.length <= 2 ? current : current.filter((item) => item !== column);
      }
      return [...current, column];
    });
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
        if (httpResponse.status === 401) {
          setSourceError(copy.sessionExpired);
          redirectToLoginAfterUnauthorized();
          return;
        }
        setSourceError(copy.sourceOpenFailed);
        return;
      }
      const payload = (await httpResponse.json()) as { source_context: SourceContext };
      setSourceContext(payload.source_context);
    } catch (error) {
      setSourceError(copy.sourceOpenFailed);
    } finally {
      setOpeningSourceId(null);
    }
  }

  function addShare() {
    if (!shareTarget || !activeThread.conversationId) {
      return;
    }
    const nextSharedWith = [
      ...activeThread.sharedWith.filter(
        (item) =>
          item.subjectType !== "user" ||
          item.subjectId !== shareTarget.subject_id,
      ),
      {
        subjectType: "user" as const,
        subjectId: shareTarget.subject_id,
        displayName: directoryUserDisplayName(shareTarget),
        permission: sharePermission,
      },
    ];
    setShareSaving(true);
    setShareStatus(null);
    fetch(withAppBasePath(`/api/assistant/conversations/${encodeURIComponent(activeThread.conversationId)}/shares`), {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        visibility: "shared",
        shares: nextSharedWith.map((item) => ({
          subject_type: item.subjectType,
          subject_id: item.subjectId,
          permission: item.permission
        }))
      })
    })
      .then((response) => {
        if (response.ok) {
          return response.json();
        }
        if (response.status === 401) {
          redirectToLoginAfterUnauthorized();
          return Promise.reject(new Error(copy.sessionExpired));
        }
        return Promise.reject(new Error(copy.shareFailed));
      })
      .then((payload) => {
        const conversation = payload.conversation as AssistantConversationDetail;
        updateThread(activeThread.id, () => threadFromConversation(conversation, language));
        setShareTarget(null);
        setShareStatus(copy.shareSaved);
      })
      .catch((error) => setShareStatus(error instanceof Error ? error.message : copy.shareFailed))
      .finally(() => setShareSaving(false));
  }

  async function copyThreadLink() {
    if (!activeThread.conversationId) {
      setStatusMessage(copy.shareAfterFirstMessage);
      return;
    }
    const link = conversationShareUrl(
      window.location.href,
      activeThread.conversationId,
    );
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
        <aside
          id="akb-chat-thread-panel"
          className={`akb-chat-sidebar${mobileThreadsOpen ? " is-mobile-open" : ""}`}
          aria-label={copy.threadList}
        >
          <div className="akb-chat-sidebar__brand">
            <div className="akb-chat-mark" aria-hidden="true">
              <Bot size={18} />
            </div>
            <div>
              <strong>AKB Assistant</strong>
              <span>{copy.ready}</span>
            </div>
            <button
              className="akb-chat-icon-button akb-chat-sidebar__close"
              type="button"
              onClick={() => setMobileThreadsOpen(false)}
              title={copy.close}
              aria-label={copy.close}
            >
              <X size={16} aria-hidden="true" />
            </button>
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
          <div className="akb-chat-thread-filters" role="group" aria-label={copy.threadList}>
            {([
              ["active", copy.activeThreads],
              ["shared", copy.sharedWithMe],
              ["archived", copy.archivedThreads],
            ] as Array<[ThreadFilter, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={threadFilter === value ? "is-active" : ""}
                aria-pressed={threadFilter === value}
                onClick={() => setThreadFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="akb-chat-thread-list">
            <ThreadGroup
              title={copy.pinned}
              threads={visibleThreads.filter((thread) => thread.pinned)}
              activeThreadId={activeThread.id}
              copy={copy}
              onSelect={selectThread}
            />
            <ThreadGroup
              title={copy.recent}
              threads={visibleThreads.filter((thread) => !thread.pinned)}
              activeThreadId={activeThread.id}
              copy={copy}
              onSelect={selectThread}
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
              <button
                className="akb-chat-icon-button akb-chat-mobile-threads"
                type="button"
                onClick={() => setMobileThreadsOpen((open) => !open)}
                title={copy.threadList}
                aria-label={copy.threadList}
                aria-controls="akb-chat-thread-panel"
                aria-expanded={mobileThreadsOpen}
              >
                <PanelLeftOpen size={16} aria-hidden="true" />
              </button>
              {canManageActiveThread && activeThread.status === "active" ? (
                <button className="akb-chat-icon-button" type="button" onClick={() => void archiveActiveThread()} title={copy.archive} aria-label={copy.archive}>
                  <Archive size={16} aria-hidden="true" />
                </button>
              ) : null}
              {canManageActiveThread && activeThread.status === "archived" ? (
                <button className="akb-chat-icon-button" type="button" onClick={() => void restoreActiveThread()} title={copy.restore} aria-label={copy.restore}>
                  <Archive size={16} aria-hidden="true" />
                </button>
              ) : null}
              {canManageActiveThread && activeThread.conversationId ? (
                <>
                  <button
                    className="akb-chat-icon-button"
                    type="button"
                    onClick={() => void toggleActiveThreadPin()}
                    title={activeThread.pinned ? copy.unpinThread : copy.pinThread}
                    aria-label={activeThread.pinned ? copy.unpinThread : copy.pinThread}
                    aria-pressed={activeThread.pinned}
                  >
                    {activeThread.pinned ? <PinOff size={16} aria-hidden="true" /> : <Pin size={16} aria-hidden="true" />}
                  </button>
                  <button
                    className="akb-chat-icon-button"
                    type="button"
                    onClick={() => {
                      setRenameValue(activeThread.title);
                      setRenameOpen(true);
                    }}
                    title={copy.renameThread}
                    aria-label={copy.renameThread}
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </button>
                </>
              ) : null}
              {activeThread.conversationId &&
              activeThread.ownerSubjectId === currentSubjectId ? (
                <button
                  className="akb-chat-icon-button akb-chat-icon-button--danger"
                  type="button"
                  onClick={() => setDeleteOpen(true)}
                  title={copy.deleteThread}
                  aria-label={copy.deleteThread}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              ) : null}
              <button
                className="akb-chat-icon-button"
                type="button"
                onClick={copyThreadLink}
                title={activeThread.conversationId ? copy.copyLink : copy.shareAfterFirstMessage}
                aria-label={activeThread.conversationId ? copy.copyLink : copy.shareAfterFirstMessage}
                disabled={!activeThread.conversationId}
              >
                {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              </button>
              <StratosButton
                type="button"
                onClick={() => setShareOpen(true)}
                disabled={
                  !activeThread.conversationId ||
                  activeThread.ownerSubjectId !== currentSubjectId
                }
                title={
                  activeThread.conversationId
                    ? copy.share
                    : copy.shareAfterFirstMessage
                }
              >
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
                  currentSubjectId={currentSubjectId}
                  clarificationValues={clarificationValues}
                  setClarificationValues={setClarificationValues}
                  onSubmitClarification={submitClarification}
                  onAskFollowUp={(question) => void submitQuestion(question)}
                  onFeedback={(rating, reasonCode) => void submitMessageFeedback(
                    message.id,
                    rating,
                    reasonCode,
                  )}
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
            <div className="akb-chat-report-mode">
              <button
                type="button"
                className={`akb-chat-report-mode__toggle ${reportModeEnabled ? "is-active" : ""}`}
                aria-pressed={reportModeEnabled}
                onClick={() => setReportModeEnabled((current) => !current)}
              >
                <Table2 size={15} aria-hidden="true" />
                {reportModeEnabled ? copy.reportModeActive : copy.reportMode}
              </button>
              {reportModeEnabled ? (
                <div className="akb-chat-report-mode__panel">
                  <StratosSelect
                    id="akb-report-template"
                    label={copy.reportTemplate}
                    value={reportTemplate}
                    onChange={(event) => changeReportTemplate(event.target.value as AssistantReportTemplate)}
                  >
                    <option value="obligation_table">{copy.reportTemplateObligations}</option>
                    <option value="source_summary">{copy.reportTemplateSources}</option>
                    <option value="decision_matrix">{copy.reportTemplateDecision}</option>
                  </StratosSelect>
                  <StratosSelect
                    id="akb-report-detail"
                    label={copy.reportDetail}
                    value={reportDetailLevel}
                    onChange={(event) => setReportDetailLevel(event.target.value as AssistantReportDetailLevel)}
                  >
                    <option value="brief">{copy.reportDetailBrief}</option>
                    <option value="standard">{copy.reportDetailStandard}</option>
                    <option value="detailed">{copy.reportDetailDetailed}</option>
                  </StratosSelect>
                  <StratosSelect
                    id="akb-report-export"
                    label={copy.reportExport}
                    value={reportExportFormat}
                    onChange={(event) => setReportExportFormat(event.target.value as AssistantReportExportPreference)}
                  >
                    <option value="xlsx">{copy.reportExportXlsxOnly}</option>
                    <option value="pdf">{copy.reportExportPdfOnly}</option>
                    <option value="both">{copy.reportExportBoth}</option>
                  </StratosSelect>
                  <fieldset className="akb-chat-report-mode__columns">
                    <legend>{copy.reportColumns}</legend>
                    <div>
                      {reportColumnOptionsForTemplate(reportTemplate).map((column) => (
                        <label key={column}>
                          <input
                            type="checkbox"
                            checked={reportColumns.includes(column)}
                            onChange={() => toggleReportColumn(column)}
                          />
                          <span>{assistantReportColumnLabel(column, language)}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>
              ) : null}
            </div>
            {visibleSlashCommands.length ? (
              <div className="akb-chat-slash-menu" role="listbox" aria-label={language === "en" ? "Quick actions" : "Rychlé akce"}>
                {visibleSlashCommands.map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    role="option"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applySlashCommand(command.id)}
                  >
                    <span>{command.token}</span>
                    {command.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="akb-chat-composer__box">
              <textarea
                id="akb-chat-composer"
                value={composer}
                onChange={(event) => updateActiveDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={copy.composerPlaceholder}
                rows={2}
                disabled={activeThread.status === "archived"}
              />
              <button type="submit" disabled={submitting || activeThread.status === "archived"} aria-label={submitting ? copy.asking : copy.ask}>
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
                <div
                  className="akb-chat-access__row"
                  key={`${item.subjectType}:${item.subjectId}`}
                >
                  <span>{item.permission === "viewer" ? copy.viewer : copy.commenter}</span>
                  <strong>{item.displayName}</strong>
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
              <AssistantSharePersonPicker
                copy={copy}
                selectedUser={shareTarget}
                onSelect={(user) => {
                  setShareTarget(user);
                  setShareStatus(null);
                }}
              />
              <StratosSelect
                id="akb-share-permission"
                label={copy.sharePermission}
                value={sharePermission}
                onChange={(event) => setSharePermission(event.target.value as SharePermission)}
              >
                <option value="viewer">{copy.viewer}</option>
                <option value="commenter">{copy.commenter}</option>
              </StratosSelect>
              <StratosButton
                tone="primary"
                type="button"
                disabled={!shareTarget || shareSaving}
                onClick={addShare}
              >
                <Users size={16} aria-hidden="true" />
                {shareSaving ? copy.shareSaving : copy.addShare}
              </StratosButton>
              {shareStatus ? <div className="notice">{shareStatus}</div> : null}
            </div>
          </div>
        </div>
      ) : null}

      {deleteOpen ? (
        <div
          className="akb-share-backdrop"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="akb-delete-thread-title"
          aria-describedby="akb-delete-thread-description"
        >
          <div className="akb-share-dialog akb-delete-dialog">
            <div className="akb-share-dialog__header">
              <h2 id="akb-delete-thread-title">{copy.deleteTitle}</h2>
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                aria-label={copy.close}
                disabled={deletingThread}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="akb-share-dialog__body">
              <div className="akb-delete-dialog__warning">
                <Trash2 size={20} aria-hidden="true" />
                <p id="akb-delete-thread-description">{copy.deleteBody}</p>
              </div>
              <div className="akb-delete-dialog__thread">
                <strong>{activeThread.title}</strong>
                {activeThread.retentionUntil ? (
                  <span>
                    {copy.deleteRetention}{" "}
                    {formatRetentionDate(activeThread.retentionUntil, language)}.
                  </span>
                ) : null}
              </div>
              <div className="akb-delete-dialog__actions">
                <StratosButton
                  type="button"
                  onClick={() => setDeleteOpen(false)}
                  disabled={deletingThread}
                >
                  {copy.deleteCancel}
                </StratosButton>
                <StratosButton
                  tone="danger"
                  type="button"
                  onClick={() => void deleteActiveThread()}
                  disabled={deletingThread}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {deletingThread ? copy.deletingThread : copy.deleteThread}
                </StratosButton>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {renameOpen ? (
        <div
          className="akb-share-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="akb-rename-thread-title"
        >
          <div className="akb-share-dialog akb-delete-dialog">
            <div className="akb-share-dialog__header">
              <h2 id="akb-rename-thread-title">{copy.renameTitle}</h2>
              <button
                type="button"
                className="akb-chat-icon-button"
                onClick={() => setRenameOpen(false)}
                aria-label={copy.close}
                disabled={renameSaving}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="akb-share-dialog__body">
              <label className="akb-chat-rename-field">
                <span>{copy.renameLabel}</span>
                <input
                  value={renameValue}
                  maxLength={300}
                  autoFocus
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void renameActiveThread();
                    }
                  }}
                />
              </label>
              <div className="akb-delete-dialog__actions">
                <StratosButton type="button" onClick={() => setRenameOpen(false)} disabled={renameSaving}>
                  {copy.close}
                </StratosButton>
                <StratosButton tone="primary" type="button" onClick={() => void renameActiveThread()} disabled={renameSaving || !renameValue.trim()}>
                  {copy.renameSave}
                </StratosButton>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function contextWithReportRequest(
  context: Record<string, unknown>,
  reportRequest: AssistantReportRequest | null
): Record<string, unknown> {
  const next = { ...context };
  if (reportRequest) {
    next[ASSISTANT_REPORT_REQUEST_CONTEXT_KEY] = reportRequest;
  } else {
    delete next[ASSISTANT_REPORT_REQUEST_CONTEXT_KEY];
  }
  return next;
}

async function assistantHttpErrorMessage(response: Response, copy: AssistantAppLabels): Promise<string> {
  const payload = await response.json().catch(() => null) as { error?: { code?: unknown; message?: unknown } } | null;
  const code = typeof payload?.error?.code === "string" ? payload.error.code : "";

  if (code === "UPSTREAM_UNAVAILABLE" || code === "UPSTREAM_ERROR") {
    return copy.assistantServiceUnavailable;
  }
  return response.status === 401 ? copy.sessionExpired : copy.requestFailed;
}

function slashCommandOptions(composer: string, language: AklLanguage): SlashCommandOption[] {
  const trimmed = composer.trimStart();
  if (!trimmed.startsWith("/")) {
    return [];
  }
  if (/^\/[^\s]+\s/.test(trimmed)) {
    return [];
  }
  const query = trimmed.slice(1).split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  const options = language === "en"
    ? [
        { id: "report" as const, token: "/report", label: "Report mode" },
        { id: "types" as const, token: "/types", label: "Document types" },
        { id: "excel" as const, token: "/excel", label: "Excel output" },
        { id: "pdf" as const, token: "/pdf", label: "PDF output" },
        { id: "new_thread" as const, token: "/new", label: "New thread" }
      ]
    : [
        { id: "report" as const, token: "/sestava", label: "Režim sestavy" },
        { id: "types" as const, token: "/typy", label: "Typy dokumentů" },
        { id: "excel" as const, token: "/excel", label: "Výstup Excel" },
        { id: "pdf" as const, token: "/pdf", label: "Výstup PDF" },
        { id: "new_thread" as const, token: "/nove", label: "Nové vlákno" }
      ];
  return options.filter((option) => {
    if (!query) {
      return true;
    }
    return option.token.slice(1).toLowerCase().startsWith(query) ||
      option.label.toLowerCase().includes(query);
  });
}

function removeLeadingSlashToken(value: string): string {
  return value.replace(/^\s*\/[^\s]*\s*/, "");
}

function reportColumnOptionsForTemplate(template: AssistantReportTemplate): AssistantReportColumnKey[] {
  if (template === "source_summary") {
    return ["source_document", "evidence_summary", "page_or_section", "cited_rule_or_source", "risk_or_priority"];
  }
  if (template === "decision_matrix") {
    return ["decision_or_recommendation", "risk_or_priority", "evidence_summary", "source_document", "page_or_section"];
  }
  return [
    "obligation_or_area",
    "cited_rule_or_source",
    "practical_meaning_or_note",
    "owner_or_role",
    "deadline_or_frequency",
    "source_document",
    "page_or_section"
  ];
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

function AssistantSharePersonPicker({
  copy,
  selectedUser,
  onSelect,
}: {
  copy: AssistantAppLabels;
  selectedUser: DirectoryUser | null;
  onSelect: (user: DirectoryUser) => void;
}) {
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(withAppBasePath("/api/assistant/directory?limit=50"), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(await assistantHttpErrorMessage(response, copy));
        }
        return response.json() as Promise<{ users?: DirectoryUser[] }>;
      })
      .then((payload) => {
        setUsers(Array.isArray(payload.users) ? payload.users : []);
        setError(false);
      })
      .catch((fetchError) => {
        if (
          fetchError instanceof DOMException &&
          fetchError.name === "AbortError"
        ) {
          return;
        }
        setUsers([]);
        setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [copy]);

  const people = useMemo(
    () => directoryUsersToPeople(selectedUser ? [selectedUser, ...users] : users),
    [selectedUser, users],
  );

  return (
    <div className="akb-share-person-picker">
      <PersonPicker
        disabled={loading || error || people.length === 0}
        label={copy.shareTarget}
        labels={{
          title: copy.shareDirectoryTitle,
          search: copy.shareDirectorySearch,
          placeholder: loading
            ? copy.shareDirectoryLoading
            : copy.shareTargetPlaceholder,
          empty: error
            ? copy.shareDirectoryFailed
            : copy.shareDirectoryEmpty,
          close: copy.close,
        }}
        people={people}
        popoverMinWidth={380}
        popoverPlacement="bottom-start"
        popoverZIndex={150}
        selectedPersonId={selectedUser?.subject_id ?? null}
        onPersonSelect={(personId) => {
          const user =
            users.find((candidate) => candidate.subject_id === personId) ??
            selectedUser;
          if (user) {
            onSelect(user);
          }
        }}
      />
      {error ? (
        <p className="akb-share-person-picker__status" role="alert">
          {copy.shareDirectoryFailed}
        </p>
      ) : null}
    </div>
  );
}

function ChatBubble({
  message,
  copy,
  currentSubjectId,
  clarificationValues,
  setClarificationValues,
  onSubmitClarification,
  onAskFollowUp,
  onFeedback,
}: {
  message: ChatMessage;
  copy: AssistantAppLabels;
  currentSubjectId: string;
  clarificationValues: Record<string, string>;
  setClarificationValues: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  onSubmitClarification: (response: AssistantChatResponse) => void;
  onAskFollowUp: (question: string) => void;
  onFeedback: (
    rating: AssistantMessageFeedbackRating,
    reasonCode: AssistantMessageFeedbackReason | null,
  ) => void;
}) {
  const response = message.response;
  const [feedbackReasonsOpen, setFeedbackReasonsOpen] = useState(false);
  return (
    <article className={`akb-chat-message akb-chat-message--${message.role}`}>
      <div className="akb-chat-message__avatar" aria-hidden="true">
        {message.role === "assistant" ? <Bot size={16} /> : <Users size={16} />}
      </div>
      <div className="akb-chat-message__body">
        <div className="akb-chat-message__meta">
          <strong>
            {message.role === "assistant"
              ? message.authorDisplayName ?? "AKB Assistant"
              : message.authorSubjectId === currentSubjectId ||
                  !message.authorSubjectId
                ? copy.you
                : message.authorDisplayName ?? copy.anotherUser}
          </strong>
          <span>
            <Clock3 size={12} aria-hidden="true" />
            {formatThreadTime(message.createdAt)}
          </span>
          {response?.confidence ? <StatusBadge value={response.confidence} /> : null}
        </div>
        <ChatMessageContent
          role={message.role}
          content={message.content}
          hideMarkdownTables={Boolean(response?.report_artifacts.length)}
        />
        {message.pending ? <div className="akb-chat-loader" /> : null}
        {response ? (
          <AssistantResponseTools
            response={response}
            copy={copy}
            clarificationValues={clarificationValues}
            setClarificationValues={setClarificationValues}
            onSubmitClarification={onSubmitClarification}
            onAskFollowUp={onAskFollowUp}
          />
        ) : null}
        {message.role === "assistant" && message.persisted && !message.pending ? (
          <div className="akb-chat-feedback">
            <div
              className="akb-chat-feedback__actions"
              aria-label={copy.feedbackPrompt}
            >
              <button
                type="button"
                className={message.feedback?.rating === "helpful" ? "is-active" : ""}
                disabled={message.feedbackSaving}
                aria-pressed={message.feedback?.rating === "helpful"}
                onClick={() => {
                  setFeedbackReasonsOpen(false);
                  onFeedback("helpful", "accurate_useful");
                }}
              >
                <ThumbsUp size={15} aria-hidden="true" />
                {copy.feedbackHelpful}
              </button>
              <button
                type="button"
                className={message.feedback?.rating === "not_helpful" ? "is-active" : ""}
                disabled={message.feedbackSaving}
                aria-expanded={feedbackReasonsOpen}
                aria-pressed={message.feedback?.rating === "not_helpful"}
                onClick={() => setFeedbackReasonsOpen((current) => !current)}
              >
                <ThumbsDown size={15} aria-hidden="true" />
                {copy.feedbackNotHelpful}
              </button>
            </div>
            {feedbackReasonsOpen ? (
              <div className="akb-chat-feedback__reasons" role="group" aria-label={copy.feedbackPrompt}>
                {feedbackReasonOptions(copy).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={message.feedbackSaving}
                    onClick={() => {
                      setFeedbackReasonsOpen(false);
                      onFeedback("not_helpful", option.value);
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ChatMessageContent({
  role,
  content,
  hideMarkdownTables = false
}: {
  role: ChatMessage["role"];
  content: string;
  hideMarkdownTables?: boolean;
}) {
  if (role !== "assistant") {
    return <p>{content}</p>;
  }

  const displayContent = hideMarkdownTables ? stripMarkdownTables(content) : content;
  if (!displayContent.trim()) {
    return null;
  }

  return (
    <div className="akb-chat-message__markdown">
      <ReactMarkdown components={assistantMarkdownComponents} remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
    </div>
  );
}

function stripMarkdownTables(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const nextLine = lines[index + 1] ?? "";
    if (isMarkdownTableStart(line, nextLine)) {
      index += 2;
      while (index < lines.length && looksLikeMarkdownTableRow(lines[index] ?? "")) {
        index += 1;
      }
      index -= 1;
      continue;
    }
    output.push(line);
  }
  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function isMarkdownTableStart(line: string, nextLine: string): boolean {
  return looksLikeMarkdownTableRow(line) && looksLikeMarkdownTableRow(nextLine) && isMarkdownTableSeparator(nextLine);
}

function looksLikeMarkdownTableRow(line: string): boolean {
  return line.trim().includes("|") && line.replace(/\|/g, "").trim().length > 0;
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function AssistantResponseTools({
  response,
  copy,
  clarificationValues,
  setClarificationValues,
  onSubmitClarification,
  onAskFollowUp
}: {
  response: AssistantChatResponse;
  copy: AssistantAppLabels;
  clarificationValues: Record<string, string>;
  setClarificationValues: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  onSubmitClarification: (response: AssistantChatResponse) => void;
  onAskFollowUp: (question: string) => void;
}) {
  const visibleWarnings = visibleAssistantWarnings(response.warnings, copy);
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
      {visibleWarnings.length ? (
        <div className="notice">
          <ShieldAlert size={16} aria-hidden="true" />
          {visibleWarnings.join(" ")}
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
      {response.follow_up_questions.length > 0 ? (
        <div className="assistant-followups" aria-label={copy.followUps}>
          {response.follow_up_questions.map((item) => (
            <button key={item} type="button" onClick={() => onAskFollowUp(item)}>
              {item}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AssistantReportPanel({ report, copy }: { report: AssistantReportArtifact; copy: AssistantAppLabels }) {
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const visibleWarnings = visibleAssistantWarnings(report.warnings, copy);
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
        setExportError(copy.exportReportFailed);
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
      {(report.charts ?? []).map((chart) => (
        <AssistantChartPanel
          key={chart.artifact_id}
          chart={chart}
          report={report}
        />
      ))}
      <StratosDataTable
        rows={report.rows}
        columns={columns}
        getRowId={(row) => row.row_id}
        emptyLabel={copy.noPreciseSource}
        aria-label={report.title}
      />
      {visibleWarnings.length ? <div className="akb-chat-report__warnings">{visibleWarnings.join(" ")}</div> : null}
      {exportError ? <div className="notice">{exportError}</div> : null}
    </section>
  );
}

const CHART_COLORS = ["#087f8c", "#2864dc", "#7c3aed", "#d97706"];

function AssistantChartPanel({
  chart,
  report,
}: {
  chart: AssistantChartArtifact;
  report: AssistantReportArtifact;
}) {
  const categoryColumn = report.columns.find(
    (column) => column.key === chart.category_column_key,
  );
  const valueColumns = chart.value_column_keys
    .map((key) => report.columns.find((column) => column.key === key))
    .filter(isPresent);
  const rows = report.rows
    .slice(0, chart.row_limit)
    .map((row) => ({
      label: String(row.cells[chart.category_column_key] ?? "").slice(0, 80),
      values: valueColumns.map((column) => finiteNumber(row.cells[column.key])),
    }))
    .filter(
      (row) =>
        row.label.trim() &&
        row.values.some((value) => value !== null),
    );
  if (!categoryColumn || valueColumns.length === 0 || rows.length < 2) {
    return null;
  }
  const width = 760;
  const height = 320;
  const plot = { left: 64, top: 24, width: 660, height: 232 };
  const allValues = rows
    .flatMap((row) => row.values)
    .filter((value): value is number => value !== null);
  const maxValue = Math.max(1, ...allValues);
  const minValue = Math.min(0, ...allValues);
  const scaleY = (value: number) =>
    plot.top +
    plot.height -
    ((value - minValue) / Math.max(1, maxValue - minValue)) * plot.height;
  const baselineY = scaleY(0);
  const seriesLabel = (key: string) =>
    report.columns.find((column) => column.key === key)?.label ?? key;

  return (
    <figure className="akb-chat-chart">
      <figcaption>
        <BarChart3 size={16} aria-hidden="true" />
        <span>{chart.title}</span>
      </figcaption>
      <svg
        role="img"
        aria-label={`${chart.title}: ${categoryColumn.label}`}
        viewBox={`0 0 ${width} ${height}`}
      >
        <title>{chart.title}</title>
        {chart.chart_type === "pie" ? (
          <AssistantPieMarks
            rows={rows}
            columnLabel={valueColumns[0]?.label ?? ""}
          />
        ) : chart.chart_type === "line" ? (
          <AssistantLineMarks
            rows={rows}
            valueColumns={valueColumns}
            plot={plot}
            scaleY={scaleY}
          />
        ) : chart.chart_type === "scatter" ? (
          <AssistantScatterMarks
            rows={rows}
            xLabel={valueColumns[0]?.label ?? ""}
            yLabel={valueColumns[1]?.label ?? ""}
            plot={plot}
          />
        ) : (
          <AssistantBarMarks
            rows={rows}
            valueColumns={valueColumns}
            plot={plot}
            scaleY={scaleY}
            baselineY={baselineY}
            stacked={chart.chart_type === "stacked_bar"}
          />
        )}
      </svg>
      <div className="akb-chat-chart__legend" aria-label="Legenda grafu">
        {chart.value_column_keys.map((key, index) => (
          <span key={key}>
            <i style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
            {seriesLabel(key)}
          </span>
        ))}
      </div>
    </figure>
  );
}

interface ChartRow {
  label: string;
  values: Array<number | null>;
}

interface ChartPlot {
  left: number;
  top: number;
  width: number;
  height: number;
}

function AssistantBarMarks({
  rows,
  valueColumns,
  plot,
  scaleY,
  baselineY,
  stacked,
}: {
  rows: ChartRow[];
  valueColumns: AssistantReportArtifact["columns"];
  plot: ChartPlot;
  scaleY: (value: number) => number;
  baselineY: number;
  stacked: boolean;
}) {
  const groupWidth = plot.width / rows.length;
  const barGap = 3;
  const barWidth = stacked
    ? Math.max(3, groupWidth * 0.62)
    : Math.max(3, (groupWidth * 0.72) / valueColumns.length - barGap);
  return (
    <>
      <line x1={plot.left} y1={baselineY} x2={plot.left + plot.width} y2={baselineY} className="akb-chart-axis" />
      {rows.map((row, rowIndex) => {
        let positiveStack = 0;
        return (
          <g key={`${row.label}:${rowIndex}`}>
            {row.values.map((rawValue, seriesIndex) => {
              if (rawValue === null) return null;
              const value = stacked ? positiveStack + rawValue : rawValue;
              const start = stacked ? positiveStack : 0;
              positiveStack = stacked ? value : positiveStack;
              const top = Math.min(scaleY(value), scaleY(start));
              const barHeight = Math.max(1, Math.abs(scaleY(value) - scaleY(start)));
              const x = stacked
                ? plot.left + rowIndex * groupWidth + (groupWidth - barWidth) / 2
                : plot.left + rowIndex * groupWidth + groupWidth * 0.14 + seriesIndex * (barWidth + barGap);
              return (
                <rect
                  key={`${rowIndex}:${seriesIndex}`}
                  x={x}
                  y={top}
                  width={barWidth}
                  height={barHeight}
                  rx={2}
                  fill={CHART_COLORS[seriesIndex % CHART_COLORS.length]}
                >
                  <title>{`${row.label}: ${rawValue}`}</title>
                </rect>
              );
            })}
            <text
              x={plot.left + rowIndex * groupWidth + groupWidth / 2}
              y={plot.top + plot.height + 22}
              textAnchor="middle"
              className="akb-chart-label"
            >
              {shortChartLabel(row.label)}
            </text>
          </g>
        );
      })}
    </>
  );
}

function AssistantLineMarks({
  rows,
  valueColumns,
  plot,
  scaleY,
}: {
  rows: ChartRow[];
  valueColumns: AssistantReportArtifact["columns"];
  plot: ChartPlot;
  scaleY: (value: number) => number;
}) {
  const xFor = (index: number) =>
    plot.left + (index / Math.max(1, rows.length - 1)) * plot.width;
  return (
    <>
      <line x1={plot.left} y1={plot.top + plot.height} x2={plot.left + plot.width} y2={plot.top + plot.height} className="akb-chart-axis" />
      {valueColumns.map((column, seriesIndex) => {
        const points = rows
          .map((row, index) => {
            const value = row.values[seriesIndex];
            return value === null ? null : `${xFor(index)},${scaleY(value)}`;
          })
          .filter(isPresent);
        return (
          <g key={column.key}>
            <polyline
              fill="none"
              stroke={CHART_COLORS[seriesIndex % CHART_COLORS.length]}
              strokeWidth={3}
              points={points.join(" ")}
            />
            {rows.map((row, index) => {
              const value = row.values[seriesIndex];
              return value === null ? null : (
                <circle
                  key={`${column.key}:${index}`}
                  cx={xFor(index)}
                  cy={scaleY(value)}
                  r={4}
                  fill={CHART_COLORS[seriesIndex % CHART_COLORS.length]}
                >
                  <title>{`${row.label}: ${value}`}</title>
                </circle>
              );
            })}
          </g>
        );
      })}
      {rows.map((row, index) => (
        <text
          key={`${row.label}:${index}`}
          x={xFor(index)}
          y={plot.top + plot.height + 22}
          textAnchor="middle"
          className="akb-chart-label"
        >
          {shortChartLabel(row.label)}
        </text>
      ))}
    </>
  );
}

function AssistantPieMarks({
  rows,
  columnLabel,
}: {
  rows: ChartRow[];
  columnLabel: string;
}) {
  const values = rows.map((row) => Math.max(0, row.values[0] ?? 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  let cursor = -Math.PI / 2;
  return (
    <>
      {rows.map((row, index) => {
        const angle = (values[index]! / total) * Math.PI * 2;
        const start = cursor;
        const end = cursor + angle;
        cursor = end;
        const path = pieSlicePath(380, 150, 116, start, end);
        return (
          <path
            key={`${row.label}:${index}`}
            d={path}
            fill={CHART_COLORS[index % CHART_COLORS.length]}
            stroke="#ffffff"
            strokeWidth={2}
          >
            <title>{`${row.label}: ${values[index]} ${columnLabel}`}</title>
          </path>
        );
      })}
    </>
  );
}

function AssistantScatterMarks({
  rows,
  xLabel,
  yLabel,
  plot,
}: {
  rows: ChartRow[];
  xLabel: string;
  yLabel: string;
  plot: ChartPlot;
}) {
  const points = rows
    .map((row) => ({ label: row.label, x: row.values[0], y: row.values[1] }))
    .filter((point): point is { label: string; x: number; y: number } => point.x !== null && point.y !== null);
  if (points.length < 2) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const xFor = (value: number) => plot.left + ((value - minX) / Math.max(1, maxX - minX)) * plot.width;
  const yFor = (value: number) => plot.top + plot.height - ((value - minY) / Math.max(1, maxY - minY)) * plot.height;
  return (
    <>
      <line x1={plot.left} y1={plot.top + plot.height} x2={plot.left + plot.width} y2={plot.top + plot.height} className="akb-chart-axis" />
      <line x1={plot.left} y1={plot.top} x2={plot.left} y2={plot.top + plot.height} className="akb-chart-axis" />
      <text x={plot.left + plot.width / 2} y={plot.top + plot.height + 42} textAnchor="middle" className="akb-chart-label">{xLabel}</text>
      <text x={18} y={plot.top + plot.height / 2} textAnchor="middle" className="akb-chart-label" transform={`rotate(-90 18 ${plot.top + plot.height / 2})`}>{yLabel}</text>
      {points.map((point, index) => (
        <circle
          key={`${point.label}:${index}`}
          cx={xFor(point.x)}
          cy={yFor(point.y)}
          r={6}
          fill={CHART_COLORS[0]}
          fillOpacity={0.82}
        >
          <title>{`${point.label}: ${point.x}, ${point.y}`}</title>
        </circle>
      ))}
    </>
  );
}

function pieSlicePath(
  centerX: number,
  centerY: number,
  radius: number,
  start: number,
  end: number,
): string {
  const startX = centerX + radius * Math.cos(start);
  const startY = centerY + radius * Math.sin(start);
  const endX = centerX + radius * Math.cos(end);
  const endY = centerY + radius * Math.sin(end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return [
    `M ${centerX} ${centerY}`,
    `L ${startX} ${startY}`,
    `A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY}`,
    "Z",
  ].join(" ");
}

function shortChartLabel(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= 14 ? compact : `${compact.slice(0, 12)}…`;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function visibleAssistantWarnings(warnings: string[], copy: AssistantAppLabels): string[] {
  return Array.from(new Set(warnings.map((warning) => assistantWarningLabel(warning, copy)).filter(isPresentString)));
}

function assistantWarningLabel(warning: string, copy: AssistantAppLabels): string | null {
  switch (warning) {
    case "REGISTRY_METADATA_REPORT":
    case "REGISTRY_METADATA_SUMMARY":
    case "REGISTRY_DOCUMENT_LIST":
      return null;
    case "REPORT_ROWS_TRUNCATED":
      return copy.warningRowsTruncated;
    case "REGISTRY_SCAN_LIMIT_REACHED":
      return copy.warningRegistryScanLimit;
    case "CONVERSATION_HISTORY_NOT_PERSISTED":
      return copy.warningConversationNotPersisted;
    case "REPORT_LIMITED_TO_CITED_SOURCES":
    case "REPORT_MARKDOWN_TABLE_PROMOTED":
      return copy.warningReportAdjusted;
    default:
      return copy.warningGeneric;
  }
}

function isPresentString(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
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
    return conversations.map((conversation) => threadFromConversationListItem(conversation));
  }
  return [
    {
      id: "thread-current",
      conversationId: null,
      ownerSubjectId: null,
      title: language === "en" ? "New thread" : "Nové vlákno",
      context: {},
      messages: [],
      draft: "",
      status: "active",
      visibility: "private",
      pinned: false,
      updatedAt: now,
      retentionUntil: null,
      sharedWith: [],
      historyLoaded: true
    }
  ];
}

function initialActiveThreadId(
  conversations: AssistantConversationListItem[] = [],
  requestedConversationId: string | null = null
): string {
  const conversationId = requestedConversationId &&
    conversations.some((conversation) => conversation.conversation_id === requestedConversationId)
    ? requestedConversationId
    : (
      conversations.find((conversation) => conversation.status === "active") ??
      conversations[0]
    )?.conversation_id;
  return conversationId
    ? threadIdFromConversationId(conversationId)
    : "thread-current";
}

function createEmptyThread(title: string): AssistantThread {
  return {
    id: createClientId("thread"),
    conversationId: null,
    ownerSubjectId: null,
    title,
    context: {},
    messages: [],
    draft: "",
    status: "active",
    visibility: "private",
    pinned: false,
    updatedAt: new Date().toISOString(),
    retentionUntil: null,
    sharedWith: [],
    historyLoaded: true
  };
}

function threadFromConversationListItem(conversation: AssistantConversationListItem): AssistantThread {
  return {
    id: threadIdFromConversationId(conversation.conversation_id),
    conversationId: conversation.conversation_id,
    ownerSubjectId: conversation.user_id,
    title: conversation.title ?? "AKB chat",
    context: {},
    messages: [],
    draft: "",
    status: conversation.status,
    visibility: conversation.visibility,
    pinned: conversation.pinned_at !== null,
    updatedAt: conversation.updated_at,
    retentionUntil: conversation.retention_until,
    sharedWith: conversation.shared_with.map((share) => ({
      subjectType: share.subject_type,
      subjectId: share.subject_id,
      displayName:
        share.subject_display_name ??
        shareName(share.subject_type, share.subject_id),
      permission: share.permission
    })),
    historyLoaded: false
  };
}

function threadFromConversation(
  conversation: AssistantConversationDetail,
  language: AklLanguage
): AssistantThread {
  let previousUserMessage = "";
  return {
    id: threadIdFromConversationId(conversation.conversation_id),
    conversationId: conversation.conversation_id,
    ownerSubjectId: conversation.user_id,
    title: conversation.title ?? "AKB chat",
    context: {},
    messages: conversation.messages.map((message) => {
      const chatMessage = messageFromConversationMessage(
        conversation.conversation_id,
        message,
        previousUserMessage,
        language
      );
      if (message.role === "user") {
        previousUserMessage = message.content;
      }
      return chatMessage;
    }),
    draft: "",
    status: conversation.status,
    visibility: conversation.visibility,
    pinned: conversation.pinned_at !== null,
    updatedAt: conversation.updated_at,
    retentionUntil: conversation.retention_until,
    sharedWith: conversation.shared_with.map((share) => ({
      subjectType: share.subject_type,
      subjectId: share.subject_id,
      displayName:
        share.subject_display_name ??
        shareName(share.subject_type, share.subject_id),
      permission: share.permission
    })),
    historyLoaded: true
  };
}

function messageFromConversationMessage(
  conversationId: string,
  message: AssistantConversationMessage,
  previousUserMessage = "",
  language: AklLanguage
): ChatMessage {
  const content = message.availability === "source_access_changed"
    ? assistantAppCopy[language].historySourceAccessChanged
    : message.content;
  return {
    id: message.message_id,
    role: message.role,
    content,
    createdAt: message.created_at,
    authorSubjectId: message.author_subject_id,
    authorSubjectType: message.author_subject_type,
    authorDisplayName: message.author_display_name,
    persisted: true,
    feedback: message.viewer_feedback ?? null,
    response: message.role === "assistant"
      ? responseFromPersistedMessage(
          conversationId,
          message,
          previousUserMessage,
          content
        )
      : undefined
  };
}

function feedbackReasonOptions(
  copy: AssistantAppLabels,
): Array<{ value: AssistantMessageFeedbackReason; label: string }> {
  return [
    { value: "incomplete", label: copy.feedbackIncomplete },
    { value: "incorrect", label: copy.feedbackIncorrect },
    { value: "citation_problem", label: copy.feedbackCitation },
    { value: "access_problem", label: copy.feedbackAccess },
    { value: "other", label: copy.feedbackOther },
  ];
}

function responseFromPersistedMessage(
  conversationId: string,
  message: AssistantConversationMessage,
  previousUserMessage: string,
  content: string
): AssistantChatResponse {
  const metadata = message.metadata ?? {};
  const response: AssistantChatResponse = {
    response_type: message.response_type ?? "answer",
    conversation_id: conversationId,
    answer: content,
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
  return normalizeAssistantAnswerReports(response, previousUserMessage, "cs");
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

function formatRetentionDate(value: string, language: AklLanguage): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "cs-CZ", {
    dateStyle: "long",
  }).format(date);
}
