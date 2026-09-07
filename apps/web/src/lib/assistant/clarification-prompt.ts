interface PromptMessage {
  id: string;
  role: string;
  content: string;
  inReplyToMessageId?: string;
}

/** Only an explicit local request binding can resume a clarification. */
export function clarificationPrompt(messages: PromptMessage[], responseMessageId: string): string | null {
  const responseIndex = messages.findIndex((message) => message.id === responseMessageId);
  const response = messages[responseIndex];
  if (!response || response.role !== "assistant" || !response.inReplyToMessageId) return null;
  const promptIndex = messages.findIndex((message) => message.id === response.inReplyToMessageId);
  const prompt = messages[promptIndex];
  if (!prompt || promptIndex >= responseIndex || prompt.role !== "user" || !prompt.content.trim()) return null;
  return prompt.content;
}
