import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answerPersonalWorkflow, persistPersonalWorkflowTurn } from "../src/lib/assistant/personal-workflow";
import { MockRegistryClient } from "../src/lib/api/mock/registry-client";
import type { ApiRequestContext, RegistryWorkflowTask } from "../src/lib/types";

const context: ApiRequestContext = {
  subjectId: "workflow_reader", authorizationSource: "mock",
  capabilities: ["akb:access", "akb:chat", "akb:read_document"],
  identityActive: true, membershipActive: true, applicationAccessActive: true,
};
const task: RegistryWorkflowTask = {
  task_id: "task_private", source_key: null, kind: "review", priority: "medium", status: "open",
  title: "Document review required", description: "Review", source: "Document review submission",
  owner_id: "workflow_reader", owner_label: "Reader", role: "approver", assigned_to_me: true, allowed_actions: [],
  document_id: "doc_private", document_version_id: "ver_private", document_title: "Private review source",
  audit_event_id: null, job_id: null, due_at: "2026-09-01T12:00:00Z", resolved_at: null,
  metadata: {}, created_at: "2026-08-28T12:00:00Z", updated_at: "2026-08-28T12:00:00Z",
};
const message = "Co mám ke schválení?";
async function preview() {
  return answerPersonalWorkflow({
    intent: { view: "approvals" }, context, language: "cs", conversationId: "conv_personal",
    registry: {
      async listWorkflowTaskPage() { return { items: [task], total: 1, limit: 5, offset: 0 }; },
      async listWorkflowDocumentPage() { throw new Error("not a document query"); },
    },
  });
}

describe("personal workflow history persistence", () => {
  it("returns a live preview while the Registry receives only a neutral receipt", async () => {
    const registry = new MockRegistryClient();
    const result = await persistPersonalWorkflowTurn({ message, title: message, response: await preview(), language: "cs", context, registry });
    assert.equal(result.persistence_status, "persisted");
    assert.match(result.response.answer!, /Private review source/);
    assert.equal((result.response.current_context.workflow_workspace as { total: number }).total, 1);
    const conversation = await registry.getAssistantConversation("conv_personal", context);
    assert.equal(conversation.user_id, context.subjectId);
    const receipt = conversation.messages.find((item) => item.message_id === result.message_id)!;
    assert.match(receipt.content, /Osobní pracovní přehled/);
    assert.doesNotMatch(JSON.stringify(receipt), /Private review source|task_private|doc_private|ver_private|"total"|returned_count|observed_at/);
    assert.deepEqual(receipt.citations, []);
    assert.deepEqual((receipt.metadata.current_context as Record<string, unknown>).workflow_workspace, { status: "history" });
  });

  it("reports a failed write without silently saving or losing the current preview", async () => {
    const result = await persistPersonalWorkflowTurn({ message, title: message, response: await preview(), language: "cs", context,
      registry: { async appendAssistantConversationMessages() { throw new Error("private-store-failure"); } },
    });
    assert.equal(result.persistence_status, "failed");
    assert.equal(result.message_id, null);
    assert.deepEqual(result.response.warnings, ["CONVERSATION_HISTORY_NOT_PERSISTED"]);
    assert.match(result.response.answer!, /Private review source/);
    assert.doesNotMatch(JSON.stringify(result), /private-store-failure/);
  });
});
