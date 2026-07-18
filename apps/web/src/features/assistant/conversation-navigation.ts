import type {
  AssistantConversationDetail,
  AssistantConversationListItem,
} from "@/lib/types";

const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

export function requestedConversationId(
  value: string | string[] | undefined,
): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = candidate?.trim() ?? "";
  return CONVERSATION_ID_PATTERN.test(normalized) ? normalized : null;
}

export function initialConversationId(
  conversations: AssistantConversationListItem[],
  requestedId: string | null,
): string | null {
  if (
    requestedId &&
    conversations.some(
      (conversation) => conversation.conversation_id === requestedId,
    )
  ) {
    return requestedId;
  }
  return conversations[0]?.conversation_id ?? null;
}

export function conversationListItemFromDetail(
  conversation: AssistantConversationDetail,
): AssistantConversationListItem {
  return {
    conversation_id: conversation.conversation_id,
    user_id: conversation.user_id,
    status: conversation.status,
    title: conversation.title,
    visibility: conversation.visibility,
    retention_until: conversation.retention_until,
    archived_at: conversation.archived_at,
    pinned_at: conversation.pinned_at,
    created_at: conversation.created_at,
    updated_at: conversation.updated_at,
    shared_with: conversation.shared_with,
    message_count: conversation.messages.length,
  };
}

export function includeRequestedConversation(
  conversations: AssistantConversationListItem[],
  conversation: AssistantConversationDetail,
): AssistantConversationListItem[] {
  if (
    conversations.some(
      (item) => item.conversation_id === conversation.conversation_id,
    )
  ) {
    return conversations;
  }
  return [conversationListItemFromDetail(conversation), ...conversations];
}

export function conversationShareUrl(
  currentHref: string,
  conversationId: string,
): string {
  const url = new URL(currentHref);
  url.hash = "";
  url.search = "";
  url.searchParams.set("thread", conversationId);
  return url.toString();
}
