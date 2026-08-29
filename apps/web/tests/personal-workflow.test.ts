import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { answerPersonalWorkflow, PERSONAL_WORKFLOW_PREVIEW_LIMIT, personalWorkflowHistoryResponse } from "../src/lib/assistant/personal-workflow";
import { personalWorkflowIntent } from "../src/lib/assistant/personal-workflow-intent";
import { routeAssistantMessage, routeAssistantMessageForRag } from "../src/lib/assistant/assistant-tool-router";
import { assistantConversationContextFromMessages } from "../src/lib/assistant/conversation-context";
import { ApiClientError } from "../src/lib/types";
import type { ApiRequestContext, RegistryWorkflowTask, WorkflowDocument, WorkflowPage } from "../src/lib/types";

const actor: ApiRequestContext = {
  subjectId: "subject_reader", organizationId: "organization_a", authorizationSource: "mock",
  capabilities: ["akb:access", "akb:chat", "akb:read_document"], scopes: ["organization:a"],
  identityActive: true, membershipActive: true, applicationAccessActive: true,
};
const now = new Date("2026-08-28T12:00:00Z");
function task(index = 1): RegistryWorkflowTask {
  return {
    task_id: `task_${index}`, source_key: null, kind: "review", priority: "medium", status: "open",
    title: "Document review required", description: "Review the exact submitted version before approval.",
    source: "Document review submission", owner_id: actor.subjectId, owner_label: "Reader", role: "approver",
    document_id: `doc_private_${index}`, document_title: `Private document ${index}`, document_version_id: `ver_private_${index}`,
    audit_event_id: null, job_id: null, due_at: "2026-08-30T12:00:00Z", resolved_at: null,
    metadata: {}, created_at: now.toISOString(), updated_at: now.toISOString(), assigned_to_me: true, allowed_actions: [],
  };
}
function document(): WorkflowDocument {
  return {
    document_id: "doc_owned", title: "Private owned document", document_type: "directive", status: "valid",
    assignment_roles: ["gestor"], document_version_id: "ver_owned", version_label: "1.1", version_status: "valid",
    valid_from: "2025-01-01", valid_to: null, published_version_label: "1.1", published_valid_to: null,
    review_due_on: "2026-09-01", review_date_invalid: false, updated_at: now.toISOString(),
  };
}
function page<T>(items: T[], total = items.length): WorkflowPage<T> {
  return { items, total, limit: PERSONAL_WORKFLOW_PREVIEW_LIMIT, offset: 0 };
}
const registry = {
  async listWorkflowTaskPage() { return page([task()]); },
  async listWorkflowDocumentPage() { return page([document()]); },
};
const base = { intent: { view: "mine" as const }, context: actor, registry, language: "cs" as const, conversationId: "conv_workflow", now };

describe("personal workflow routing", () => {
  for (const [question, view] of [
    ["Jaké mám úkoly?", "mine"], ["Kolik mám úkolů v AKB?", "mine"],
    ["Co mám ke schválení?", "approvals"], ["Co čeká na moje schválení?", "approvals"],
    ["Jaké dokumenty spravuji?", "documents"], ["Které moje dokumenty potřebují revizi?", "documents"],
    ["Show my tasks in AKB", "mine"], ["Show my pending approvals", "approvals"],
  ] as const) {
    it(`routes ${question}`, () => {
      const route = routeAssistantMessage(question, "cs", { stratos_query_state: { sources: ["budget"] } });
      assert.equal(route.tool, "workflow_workspace");
      assert.equal(route.personalWorkflow?.view, view);
      assert.equal(route.queryPlan.quality_gates.citations_required, false);
      assert.equal(route.queryPlan.intent, "personal_workflow");
    });
  }
  for (const question of [
    "Jak mám schválit dokument?", "Schval moje dokumenty", "Přiřaď mi úkol", "Jaké úkoly má můj tým?",
    "Které úkoly mám v ProjectFlow?", "Kolik mám akcí v rozpočtu?", "Jaké jsem měl úkoly v roce 2025?",
    "Co stanoví směrnice o schvalování dokumentů?", "Jak si nastavím dovolenou?", "Jaké jsou interní limity?",
    "Najdi mi formulář", "Jaké mám smluvní povinnosti?", "Co obsahují moje dokumenty?",
    "Jaké mám úkoly podle směrnice?", "Které moje úkoly jsou nejdůležitější?",
    "Kolik mám úkolů do konce měsíce?", "Které moje úkoly jsou po lhůtě?",
    "Zobraz moje vyřešené úkoly", "Zobraz moje oblíbené dokumenty", "Které moje dokumenty jsou schválené?",
  ]) {
    it(`does not substitute a personal queue for ${question}`, () => assert.equal(personalWorkflowIntent(question), null));
  }
  it("clears the personal tool when a caller explicitly requests RAG", () => {
    const route = routeAssistantMessageForRag("Jaké mám úkoly?", "cs");
    assert.equal(route.tool, "rag_document_answer");
    assert.equal(route.personalWorkflow, null);
  });
});

describe("personal workflow authorization and evidence", () => {
  it("reads only a personal preview and uses the scoped Registry total, not the page length", async () => {
    const response = await answerPersonalWorkflow({ ...base, workspaceHref: "/akb/tasks?view=mine", registry: {
      ...registry,
      async listWorkflowTaskPage(context, options) {
        assert.equal(context, actor);
        assert.deepEqual(options, { assignedToMe: true, includeResolved: false, limit: 5, offset: 0 });
        return page(Array.from({ length: 5 }, (_, index) => task(index)), 12);
      },
    } });
    assert.equal(response.response_type, "answer");
    assert.match(response.answer!, /\*\*12\*\*/);
    assert.match(response.answer!, /Zobrazeno prvních 5/);
    assert.match(response.answer!, /Dokument čeká na věcnou kontrolu/);
    assert.match(response.answer!, /\]\(\/akb\/tasks\?view=mine\)/);
    assert.deepEqual(response.citations, []);
    assert.deepEqual(response.suggested_actions, []);
    assert.equal(response.current_context.stratos_query_state, null);
  });
  it("does not infer approval authority from a readable review task", async () => {
    const response = await answerPersonalWorkflow({ ...base, intent: { view: "approvals" }, registry: {
      ...registry, async listWorkflowTaskPage(_context, options) {
        assert.equal(options?.kind, "review");
        assert.equal(options?.assignedToMe, true);
        return page([task()]);
      },
    } });
    assert.equal(response.response_type, "answer");
    assert.deepEqual(response.suggested_actions, []);
    assert.doesNotMatch(response.answer!, /approve|publish|schválit/);
  });
  it("uses current managed-document assignments and the shared review deadline filter", async () => {
    const response = await answerPersonalWorkflow({ ...base, intent: { view: "documents", deadline: "review" }, registry: {
      ...registry, async listWorkflowDocumentPage(_context, options) {
        assert.deepEqual(options, { assignment: "managed", deadline: "review", limit: 5, offset: 0 });
        return page([document()]);
      },
    } });
    assert.equal(response.response_type, "answer");
    assert.match(response.answer!, /Private owned document/);
    assert.match(response.answer!, /verze 1\.1/);
  });
  it("distinguishes an authorized empty queue from a failed lookup", async () => {
    const response = await answerPersonalWorkflow({ ...base, registry: { ...registry, async listWorkflowTaskPage() { return page([]); } } });
    assert.equal(response.response_type, "answer");
    assert.equal((response.current_context.workflow_workspace as { status: string }).status, "no_data");
    assert.match(response.answer!, /nejsou přiřazeny/);
  });
  for (const patch of [
    { capabilities: ["akb:chat"] }, { capabilities: ["akb:read_document"] }, { identityActive: false },
    { membershipActive: false }, { applicationAccessActive: false }, { serviceClientId: "service" },
  ]) {
    it(`denies before reading for ${JSON.stringify(patch)}`, async () => {
      let calls = 0;
      const response = await answerPersonalWorkflow({ ...base, context: { ...actor, ...patch }, registry: {
        ...registry, async listWorkflowTaskPage() { calls++; return page([task()]); },
      } });
      assert.equal(response.response_type, "restricted");
      assert.equal(calls, 0);
      assert.doesNotMatch(response.answer!, /Private/);
    });
  }
  for (const patch of [
    { subjectId: "other" }, { organizationId: "other" }, { scopes: [] }, { capabilities: ["akb:chat"] },
    { applicationAccessActive: false }, { applicationAccess: [{ application: "akb", capabilities: [], scopes: [] }] },
  ]) {
    it(`discards records after access changes: ${JSON.stringify(patch)}`, async () => {
      const response = await answerPersonalWorkflow({ ...base, refreshContext: async () => ({ ...actor, ...patch }) });
      assert.equal(response.response_type, "restricted");
      assert.doesNotMatch(JSON.stringify(response), /Private document|doc_private|task_1|ver_private/);
    });
  }
  it("requires a fresh projection in non-mock mode", async () => {
    const response = await answerPersonalWorkflow({ ...base, context: { ...actor, authorizationSource: "stratos_projection" } });
    assert.equal(response.response_type, "no_answer");
    assert.deepEqual(response.warnings, ["WORKFLOW_UNAVAILABLE"]);
  });
  it("accepts an unchanged refreshed projection", async () => {
    const context = { ...actor, authorizationSource: "stratos_projection" as const };
    const response = await answerPersonalWorkflow({ ...base, context, refreshContext: async () => ({ ...context, scopes: [...context.scopes!] }) });
    assert.equal(response.response_type, "answer");
  });
  for (const invalid of [
    page([task(), task()]), page([], 1), { ...page([task()]), total: -1 },
    { ...page([task()]), offset: 1 }, page([{ ...task(), assigned_to_me: false }]),
    page([{ ...task(), status: "resolved" as const }]),
  ]) {
    it("fails closed on incomplete, duplicate, foreign or resolved records", async () => {
      const response = await answerPersonalWorkflow({ ...base, registry: { ...registry, async listWorkflowTaskPage() { return invalid; } } });
      assert.equal(response.response_type, "no_answer");
      assert.deepEqual(response.warnings, ["WORKFLOW_UNAVAILABLE"]);
      assert.doesNotMatch(response.answer!, /Private document/);
    });
  }
  it("rejects unassigned or out-of-filter documents", async () => {
    for (const item of [{ ...document(), assignment_roles: [] }, { ...document(), review_due_on: "2027-01-01" }]) {
      const response = await answerPersonalWorkflow({ ...base, intent: { view: "documents", deadline: "review" }, registry: {
        ...registry, async listWorkflowDocumentPage() { return page([item]); },
      } });
      assert.equal(response.response_type, "no_answer");
    }
  });
  it("does not expose upstream error details or invent empty results on outage", async () => {
    const response = await answerPersonalWorkflow({ ...base, registry: {
      ...registry, async listWorkflowTaskPage() { throw new ApiClientError("private-upstream-details", 503, "TEST_FAILURE", "workflow-test"); },
    } });
    assert.equal(response.response_type, "no_answer");
    assert.doesNotMatch(JSON.stringify(response), /private-upstream-details|\*\*0\*\*/);
  });
  it("stores only a refresh receipt, with no personal records or counts", async () => {
    const response = await answerPersonalWorkflow(base);
    const receipt = personalWorkflowHistoryResponse(response, "cs");
    assert.doesNotMatch(JSON.stringify(receipt), /Private document|doc_private|ver_private|task_1|returned_count|total|observed_at/);
    assert.deepEqual(receipt.citations, []);
    assert.deepEqual(receipt.current_context.workflow_workspace, { status: "history" });
    assert.equal(personalWorkflowIntent(receipt.follow_up_questions[0]!)?.view, "mine");
    assert.equal(receipt.current_context.controlled_rule_domain, null);
    assert.equal(receipt.current_context.document_id, null);
  });
  it("does not revive financial evidence from an older history capsule", async () => {
    const receipt = personalWorkflowHistoryResponse(await answerPersonalWorkflow(base), "cs");
    const message = {
      message_id: "message", conversation_id: "conv_workflow", role: "assistant" as const,
      author_subject_id: "akb-assistant", author_subject_type: "service" as const,
      author_display_name: "AKB Assistant", response_type: "answer" as const,
      content: "", created_at: now.toISOString(), citations: [], report_artifacts: [], metadata: {},
    };
    const context = assistantConversationContextFromMessages([
      { ...message, metadata: { current_context: { active_source_application: "budget", live_sources: [{ application: "budget" }], mixed_evidence: { live_data: "available" } } } },
      { ...message, metadata: { current_context: receipt.current_context } },
    ]);
    assert.equal(context.active_source_application, null);
    assert.equal(context.live_sources, null);
    assert.equal(context.mixed_evidence, null);
  });
  it("renders untrusted titles as plain text, not injected links or HTML", async () => {
    const response = await answerPersonalWorkflow({ ...base, registry: {
      ...registry, async listWorkflowTaskPage() { return page([{ ...task(), document_title: "[click](https://external.invalid) <script>x</script>" }]); },
    } });
    assert.match(response.answer!, /\\\[click\\\]\\\(/);
    assert.doesNotMatch(response.answer!, /<script>/);
  });
});
