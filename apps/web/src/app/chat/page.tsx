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
import { getAklConfig } from "@/lib/api/config";
import { personalizedAssistantSuggestions } from "@/lib/assistant/personalized-suggestions";
import { canUseEmployeeChat } from "@/lib/auth/authorization";
import type {
  AssistantConversationListItem,
} from "@/lib/types";

export const dynamic = "force-dynamic";

interface ChatPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const clients = getServerApiClients();
  const context = await getServerRequestContextForPath(
    getAklConfig().webProfile === "chat" ? "/" : "/chat",
  );
  if (!canUseEmployeeChat(context)) {
    return (
      <main className="workspace-error" role="alert">
        <h1>Chat zatím není přidělen</h1>
        <p>
          Přihlášení proběhlo správně, ale váš aktuální přístup ve STRATOS
          Access Center neobsahuje oprávnění používat AKB Chat.
        </p>
        <p>Po přidělení oprávnění stránku znovu načtěte.</p>
      </main>
    );
  }
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const requestedId = requestedConversationId(resolvedSearchParams.thread);
  let initialConversations: AssistantConversationListItem[] = [];
  let historyUnavailable = false;
  let requestedThreadUnavailable = false;

  try {
    initialConversations = (
      await clients.registry.listAssistantConversations(context, true, true)
    ).items;
  } catch {
    historyUnavailable = true;
  }
  const suggestions = (
    await personalizedAssistantSuggestions({
      context,
      config: getAklConfig(),
      conversations: initialConversations,
    }).catch(() => ({ suggestions: [] }))
  ).suggestions;

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
