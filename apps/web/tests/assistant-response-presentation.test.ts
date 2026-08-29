import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assistantResponseStatus, assistantVisibleWarnings } from "../src/lib/assistant/response-presentation";
import type { AssistantChatResponse } from "../src/lib/types";

function response(patch: Partial<AssistantChatResponse> = {}): AssistantChatResponse {
  return {
    response_type: "answer", conversation_id: "conv_status", answer: "Answer", message: null,
    questions: [], why_needed: null, current_context: {}, citations: [], follow_up_questions: [],
    suggested_actions: [], report_artifacts: [], confidence: "high", warnings: [], missing_information: null,
    recommended_action: null, ...patch,
  };
}
function live(status: string) {
  return { live_sources: [{ application: "budget", status, item_count: status === "no_data" ? 0 : 1 }] };
}

describe("assistant status presentation", () => {
  it("does not show high confidence for an empty live result", () => {
    const badge = assistantResponseStatus(response({ response_type: "no_answer", current_context: live("no_data") }), "cs");
    assert.equal(badge?.label, "Bez odpovídajících dat");
    assert.notEqual(badge?.value, "high");
  });
  it("shows partial status next to the answer, not just in a technical warning", () => {
    const badge = assistantResponseStatus(response({ current_context: live("partial") }), "cs");
    assert.equal(badge?.label, "Částečná odpověď");
    assert.equal(badge?.value, "medium");
  });
  it("keeps a partial mixed answer visibly partial when only one evidence group succeeds", () => {
    const badge = assistantResponseStatus(response({ current_context: {
      ...live("complete"), mixed_evidence: { live_data: "available", document_guidance: "not_available" },
    } }), "cs");
    assert.equal(badge?.label, "Částečná odpověď");
  });
  it("does not display verified data when the evidence gate failed", () => {
    const badge = assistantResponseStatus(response({ response_type: "no_answer", current_context: live("complete"), warnings: ["LIVE_DATA_EVIDENCE_GATE_FAILED"] }), "cs");
    assert.equal(badge?.label, "Výsledek nelze ověřit");
    assert.equal(badge?.value, "insufficient_source");
  });
  it("preserves the distinction between conflict and absence", () => {
    const badge = assistantResponseStatus(response({ response_type: "no_answer", confidence: "conflicting_sources" }), "cs");
    assert.equal(badge?.value, "conflicting_sources");
    assert.equal(badge?.label, "Rozpor ve zdrojích");
  });
  it("distinguishes an access denial from temporary unavailability", () => {
    assert.equal(assistantResponseStatus(response({ response_type: "restricted" }), "cs")?.label, "Omezený přístup");
    assert.equal(assistantResponseStatus(response({ response_type: "no_answer", current_context: live("unavailable") }), "cs")?.label, "Dočasně nedostupné");
  });
  it("shows a neutral empty personal queue and historical refresh receipt", () => {
    for (const [status, label] of [["no_data", "Bez přiřazených záznamů"], ["history", "Obnovit osobní přehled"]]) {
      const badge = assistantResponseStatus(response({ confidence: null, current_context: { workflow_workspace: { status } } }), "cs");
      assert.equal(badge?.label, label);
      assert.equal(badge?.value, "info");
    }
  });
  it("does not relabel a source requiring freshness review as fully verified", () => {
    assert.equal(assistantResponseStatus(response({ warnings: ["SOURCE_REVIEW_OVERDUE_POSSIBLY_STALE"] }), "cs")?.label, "Ověřit aktuálnost");
  });
  it("preserves confidence for a normal grounded document answer", () => {
    assert.deepEqual(assistantResponseStatus(response({ confidence: "medium" }), "cs"), { value: "medium" });
  });
  it("localizes status labels for English", () => {
    assert.equal(assistantResponseStatus(response({ current_context: live("partial") }), "en")?.label, "Partial answer");
  });
});

describe("assistant warning presentation", () => {
  it("hides provenance markers but not substantive limitations", () => {
    const labels = assistantVisibleWarnings(["DIRECTOR_COPILOT_V2_LIVE_DATA", "MIXED_EVIDENCE_COMPOSITION", "BUDGET_APPROVED_PLAN_MISSING"], "cs");
    assert.equal(labels.length, 1);
    assert.match(labels[0]!, /nemá schválený plán/);
    assert.match(labels[0]!, /nenahrazuje nulou/);
  });
  it("describes incomplete counts and conflicts without displaying technical codes", () => {
    const labels = assistantVisibleWarnings(["LIVE_DATA_EVIDENCE_COUNT_INCOMPLETE", "CONTROLLED_RULE_CONFLICT"], "cs");
    assert.match(labels.join(" "), /Úplný počet nelze bezpečně určit/);
    assert.match(labels.join(" "), /gestor/);
    assert.doesNotMatch(labels.join(" "), /LIVE_DATA|CONTROLLED_RULE/);
  });
  it("deduplicates labels and never reflects unknown warning content", () => {
    const labels = assistantVisibleWarnings(["SOURCE_REVIEW_OVERDUE_POSSIBLY_STALE", "SOURCE_REVIEW_OVERDUE_POSSIBLY_STALE", "sensitive-upstream-data", "<script>"], "cs");
    assert.equal(labels.length, 2);
    assert.doesNotMatch(labels.join(" "), /sensitive|<script>|SOURCE_REVIEW/);
  });
  it("explains contract drift separately from transport outages", () => {
    const labels = assistantVisibleWarnings(["DIRECTOR_COPILOT_V2_MANIFEST_DRIFT"], "en");
    assert.match(labels[0]!, /contract changed/);
    assert.doesNotMatch(labels[0]!, /temporarily unavailable/);
  });
  it("treats an incomplete generated answer as rejected, not complete", () => {
    assert.match(assistantVisibleWarnings(["LLM_ANSWER_INCOMPLETE"], "cs")[0]!, /nebyla použita/);
  });
});
