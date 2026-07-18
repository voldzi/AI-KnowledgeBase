import { AkbAssistantApp } from "@/features/assistant/akb-assistant-app";
import {
  includeRequestedConversation,
  initialConversationId,
  requestedConversationId,
} from "@/features/assistant/conversation-navigation";
import {
  getServerApiClients,
  getServerRequestContextForPath,
} from "@/lib/api/server";
import { requirePageAccess } from "@/lib/auth/server-route-guard";
import type {
  AssistantConversationListItem,
  AssistantSuggestion,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const FALLBACK_SUGGESTIONS: AssistantSuggestion[] = [
  {
    label: "Nový přístup",
    prompt: "Jak požádám o nový přístup?",
    domain: "Service Desk",
    audience: "employee",
  },
  {
    label: "Nahlásit incident",
    prompt: "Jak nahlásím incident?",
    domain: "IT Operations",
    audience: "employee",
  },
  {
    label: "Kdo schvaluje výjimku",
    prompt: "Kdo schvaluje výjimku ze směrnice?",
    domain: "Dokumentace",
    audience: "employee",
  },
  {
    label: "Architektura platformy",
    prompt: "Jaká je architektura AKB platformy?",
    domain: "Dokumentace",
    audience: "employee",
  },
];

interface ChatPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const clients = getServerApiClients();
  const context = await getServerRequestContextForPath("/chat");
  requirePageAccess(context, "employee_chat");
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const requestedId = requestedConversationId(resolvedSearchParams.thread);
  let suggestions = FALLBACK_SUGGESTIONS;
  let initialConversations: AssistantConversationListItem[] = [];
  let historyUnavailable = false;
  let requestedThreadUnavailable = false;

  const [suggestionsResult, conversationsResult] = await Promise.allSettled([
    clients.rag.assistantSuggestions(context),
    clients.registry.listAssistantConversations(context),
  ]);
  if (suggestionsResult.status === "fulfilled") {
    suggestions = suggestionsResult.value.suggestions;
  } else {
    suggestions = FALLBACK_SUGGESTIONS;
  }
  if (conversationsResult.status === "fulfilled") {
    initialConversations = conversationsResult.value.items;
  } else {
    historyUnavailable = true;
  }

  if (
    requestedId &&
    !initialConversations.some(
      (conversation) => conversation.conversation_id === requestedId,
    )
  ) {
    try {
      const requestedConversation =
        await clients.registry.getAssistantConversation(requestedId, context);
      initialConversations = includeRequestedConversation(
        initialConversations,
        requestedConversation,
      );
    } catch {
      requestedThreadUnavailable = true;
    }
  }

  return (
    <AkbAssistantApp
      currentSubjectId={context.subjectId}
      initialNowIso={new Date().toISOString()}
      initialConversations={initialConversations}
      initialConversationId={initialConversationId(
        initialConversations,
        requestedId,
      )}
      initialHistoryUnavailable={historyUnavailable}
      initialRequestedThreadUnavailable={requestedThreadUnavailable}
      suggestions={suggestions}
    />
  );
}
