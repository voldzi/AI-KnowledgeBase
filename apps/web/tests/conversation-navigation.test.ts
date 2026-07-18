import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  conversationShareUrl,
  conversationListItemFromDetail,
  includeRequestedConversation,
  initialConversationId,
  requestedConversationId,
} from "../src/features/assistant/conversation-navigation";
import type {
  AssistantConversationDetail,
  AssistantConversationListItem,
} from "../src/lib/types";

function listItem(
  conversationId: string,
): AssistantConversationListItem {
  return {
    conversation_id: conversationId,
    user_id: "user_1",
    status: "active",
    title: conversationId,
    visibility: "private",
    retention_until: null,
    archived_at: null,
    pinned_at: null,
    created_at: "2026-07-18T08:00:00.000Z",
    updated_at: "2026-07-18T09:00:00.000Z",
    shared_with: [],
    message_count: 2,
  };
}

function detail(conversationId: string): AssistantConversationDetail {
  return {
    ...listItem(conversationId),
    messages: [
      {
        message_id: "msg_1",
        role: "user",
        author_subject_id: "user_1",
        author_subject_type: "user",
        author_display_name: "Jan Novák",
        content: "Dotaz",
        response_type: null,
        citations: [],
        metadata: {},
        created_at: "2026-07-18T08:00:00.000Z",
      },
    ],
  };
}

describe("assistant conversation navigation", () => {
  it("builds canonical links from the currently visible chat route", () => {
    assert.equal(
      conversationShareUrl(
        "https://chat.example/?blocked=1",
        "conv_shared",
      ),
      "https://chat.example/?thread=conv_shared",
    );
    assert.equal(
      conversationShareUrl(
        "https://stratos.example/akb/chat?thread=old#answer",
        "conv_new",
      ),
      "https://stratos.example/akb/chat?thread=conv_new",
    );
  });

  it("accepts bounded opaque ids and rejects malformed thread parameters", () => {
    assert.equal(requestedConversationId(" conv_123:abc "), "conv_123:abc");
    assert.equal(requestedConversationId(["conv_shared", "ignored"]), "conv_shared");
    assert.equal(requestedConversationId("../conversation"), null);
    assert.equal(requestedConversationId("conversation/child"), null);
    assert.equal(requestedConversationId(""), null);
  });

  it("keeps an authorized requested conversation active", () => {
    const conversations = [listItem("conv_recent"), listItem("conv_shared")];

    assert.equal(
      initialConversationId(conversations, "conv_shared"),
      "conv_shared",
    );
    assert.equal(
      initialConversationId(conversations, "conv_missing"),
      "conv_recent",
    );
    assert.equal(initialConversationId([], "conv_missing"), null);
  });

  it("adds an authorized deep-linked conversation outside the first page once", () => {
    const conversations = [listItem("conv_recent")];
    const requested = detail("conv_older");
    const withRequested = includeRequestedConversation(
      conversations,
      requested,
    );

    assert.deepEqual(
      withRequested.map((item) => item.conversation_id),
      ["conv_older", "conv_recent"],
    );
    assert.equal(withRequested[0]?.message_count, 1);
    assert.deepEqual(
      includeRequestedConversation(withRequested, requested),
      withRequested,
    );
    assert.deepEqual(
      conversationListItemFromDetail(requested),
      withRequested[0],
    );
  });
});
