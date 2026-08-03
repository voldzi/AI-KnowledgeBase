import type { AssistantConversationDetail } from "@/lib/types";

export function hasPersistedAssistantTurn(input: {
  conversation: AssistantConversationDetail;
  submittedQuestion: string;
  knownAssistantMessageIds: Set<string>;
}): boolean {
  const messages = input.conversation.messages;
  for (let index = 1; index < messages.length; index += 1) {
    const message = messages[index];
    const previous = messages[index - 1];
    if (
      message?.role === "assistant"
      && previous?.role === "user"
      && previous.content.trim() === input.submittedQuestion.trim()
      && !input.knownAssistantMessageIds.has(message.message_id)
    ) {
      return true;
    }
  }
  return false;
}

export async function recoverPersistedAssistantTurn(input: {
  conversationId: string;
  submittedQuestion: string;
  knownAssistantMessageIds: Set<string>;
  loadConversation: (conversationId: string) => Promise<AssistantConversationDetail | null>;
  wait?: (milliseconds: number) => Promise<void>;
  intervalMs?: number;
  maxWaitMs?: number;
}): Promise<AssistantConversationDetail | null> {
  const wait = input.wait ?? ((milliseconds: number) => new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  const intervalMs = input.intervalMs ?? 1_500;
  const maxWaitMs = input.maxWaitMs ?? 30_000;
  const attempts = Math.max(1, Math.ceil(maxWaitMs / intervalMs));

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const conversation = await input.loadConversation(input.conversationId).catch(() => null);
    if (conversation && hasPersistedAssistantTurn({
      conversation,
      submittedQuestion: input.submittedQuestion,
      knownAssistantMessageIds: input.knownAssistantMessageIds,
    })) {
      return conversation;
    }
    if (attempt < attempts - 1) {
      await wait(intervalMs);
    }
  }
  return null;
}
