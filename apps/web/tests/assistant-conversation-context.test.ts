import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assistantConversationContextFromMessages,
  hasAssistantContinuityContext,
  mergeAssistantConversationContext,
  safeAssistantConversationContext,
} from "../src/lib/assistant/conversation-context";
import type { AssistantConversationMessage } from "../src/lib/types";

function assistantMessage(
  currentContext: Record<string, unknown>,
  availability: AssistantConversationMessage["availability"] = "available",
): AssistantConversationMessage {
  return {
    message_id: crypto.randomUUID(),
    role: "assistant",
    author_subject_id: "akb-assistant",
    author_subject_type: "service",
    author_display_name: "AKB Assistant",
    content: "This answer must never become conversation context.",
    response_type: "answer",
    citations: [],
    metadata: { current_context: currentContext },
    availability,
    created_at: new Date().toISOString(),
  };
}

describe("assistant conversation context", () => {
  it("restores the latest structured state and never assistant prose", () => {
    const messages = [
      assistantMessage({
        controlled_rule_domain: "public_procurement",
        controlled_rule_valid_on: "2026-08-25",
      }),
      assistantMessage({
        answer_source: "director_copilot_v2",
        stratos_query_state: { sources: ["budget"], period: { fiscal_year: 2026 } },
      }),
    ];

    const context = assistantConversationContextFromMessages(messages);

    assert.equal(context.controlled_rule_domain, "public_procurement");
    assert.deepEqual(context.stratos_query_state, {
      sources: ["budget"],
      period: { fiscal_year: 2026 },
    });
    assert.doesNotMatch(JSON.stringify(context), /answer must never/i);
  });

  it("skips context whose source access changed", () => {
    const context = assistantConversationContextFromMessages([
      assistantMessage({ document_id: "doc_allowed" }),
      assistantMessage({ document_id: "doc_revoked" }, "source_access_changed"),
    ]);

    assert.equal(context.document_id, "doc_allowed");
  });

  it("removes credentials and bulky evidence snapshots", () => {
    const context = safeAssistantConversationContext({
      stratos_query_state: { sources: ["projectflow"] },
      access_token: "must-not-survive",
      nested: {
        refreshToken: "must-not-survive",
        apiKey: "must-not-survive",
        useful: true,
      },
      director_copilot_v2_snapshot: { huge: "payload" },
    });

    assert.deepEqual(context, {
      stratos_query_state: { sources: ["projectflow"] },
      nested: { useful: true },
    });
  });

  it("keeps current explicit state over older persisted state", () => {
    const context = mergeAssistantConversationContext(
      { controlled_rule_valid_on: "2025-01-01", stratos_query_state: { sources: ["budget"] } },
      { controlled_rule_valid_on: "2026-08-25" },
    );

    assert.equal(context.controlled_rule_valid_on, "2026-08-25");
    assert.deepEqual(context.stratos_query_state, { sources: ["budget"] });
    assert.equal(hasAssistantContinuityContext(context), true);
    assert.equal(hasAssistantContinuityContext({ answer_source: "rag_retrieval" }), false);
    assert.equal(hasAssistantContinuityContext({ status: "published" }), false);
  });
});
