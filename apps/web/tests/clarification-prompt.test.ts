import assert from "node:assert/strict";
import { test } from "node:test";
import { clarificationPrompt } from "../src/lib/assistant/clarification-prompt";

test("clarification follows its exact prompt binding despite a later unrelated question", () => {
  assert.equal(clarificationPrompt([
    { id: "question_1", role: "user", content: "Original question" },
    { id: "response_1", role: "assistant", content: "Clarify", inReplyToMessageId: "question_1" },
    { id: "question_2", role: "user", content: "Unrelated later question" },
  ], "response_1"), "Original question");
});

test("deleted, unbound, wrong-role and out-of-order prompts cannot fall back to another question", () => {
  const other = { id: "other", role: "user", content: "Never substitute this question" };
  for (const messages of [
    [other, { id: "response", role: "assistant", content: "Clarify" }],
    [other, { id: "response", role: "assistant", content: "Clarify", inReplyToMessageId: "deleted" }],
    [{ id: "bound", role: "assistant", content: "Wrong role" }, other, { id: "response", role: "assistant", content: "Clarify", inReplyToMessageId: "bound" }],
    [other, { id: "response", role: "assistant", content: "Clarify", inReplyToMessageId: "after" }, { id: "after", role: "user", content: "Later" }],
    [{ id: "bound", role: "user", content: " " }, other, { id: "response", role: "assistant", content: "Clarify", inReplyToMessageId: "bound" }],
  ]) assert.equal(clarificationPrompt(messages, "response"), null);
  assert.equal(clarificationPrompt([other], "missing_response"), null);
});
