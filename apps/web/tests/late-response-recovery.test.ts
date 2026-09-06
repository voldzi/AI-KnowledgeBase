import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasPersistedAssistantTurn,
  recoverPersistedAssistantTurn,
} from "../src/lib/assistant/late-response-recovery";
import type { AssistantConversationDetail } from "../src/lib/types";

describe("late assistant response recovery", () => {
  it("recognizes the newly persisted answer paired with the submitted question", () => {
    assert.equal(hasPersistedAssistantTurn({
      conversation: conversationWithAnswer(),
      submittedQuestion: "Jaký je limit?",
      knownAssistantMessageIds: new Set(["assistant_old"]),
    }), true);
  });

  it("polls until the server-side response becomes available without resubmitting", async () => {
    let loads = 0;
    const recovered = await recoverPersistedAssistantTurn({
      conversationId: "conv_1",
      submittedQuestion: "Jaký je limit?",
      knownAssistantMessageIds: new Set(),
      loadConversation: async () => {
        loads += 1;
        return loads === 1 ? conversationWithoutAnswer() : conversationWithAnswer();
      },
      wait: async () => undefined,
      intervalMs: 1,
      maxWaitMs: 3,
    });

    assert.equal(loads, 2);
    assert.equal(recovered?.messages.at(-1)?.message_id, "assistant_new");
  });

  it("stops recovery immediately while waiting and never performs another load", async () => {
    const controller = new AbortController();
    let loads = 0;
    const pending = recoverPersistedAssistantTurn({
      conversationId: "conv_1", submittedQuestion: "Jaký je limit?", knownAssistantMessageIds: new Set(),
      signal: controller.signal, intervalMs: 60_000, maxWaitMs: 120_000,
      loadConversation: async () => { loads++; return null; },
    });
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    assert.equal(await pending, null);
    assert.equal(loads, 1);
  });

  it("does not return a late persisted answer after cancellation during a load", async () => {
    const controller = new AbortController();
    const result = await recoverPersistedAssistantTurn({
      conversationId: "conv_1", submittedQuestion: "Jaký je limit?", knownAssistantMessageIds: new Set(),
      signal: controller.signal,
      loadConversation: async () => { controller.abort(); return conversationWithAnswer(); },
    });
    assert.equal(result, null);
  });
});

function conversationWithoutAnswer(): AssistantConversationDetail {
  return {
    conversation_id: "conv_1",
    user_id: "user_1",
    title: "Limit",
    status: "active",
    visibility: "private",
    pinned_at: null,
    archived_at: null,
    retention_until: null,
    shared_with: [],
    created_at: "2026-08-03T10:00:00Z",
    updated_at: "2026-08-03T10:00:00Z",
    messages: [{
      message_id: "user_new",
      role: "user",
      content: "Jaký je limit?",
      response_type: null,
      citations: [],
      metadata: {},
      author_subject_id: "user_1",
      author_subject_type: "user",
      author_display_name: null,
      viewer_feedback: null,
      availability: "available",
      created_at: "2026-08-03T10:00:00Z",
    }],
  };
}

function conversationWithAnswer(): AssistantConversationDetail {
  const conversation = conversationWithoutAnswer();
  conversation.messages.push({
    message_id: "assistant_new",
    role: "assistant",
    content: "Limit činí 100 000 Kč.",
    response_type: "answer",
    citations: [],
    metadata: {},
    author_subject_id: "akb",
    author_subject_type: "service",
    author_display_name: "AKB Assistant",
    viewer_feedback: null,
    availability: "available",
    created_at: "2026-08-03T10:00:02Z",
  });
  return conversation;
}
