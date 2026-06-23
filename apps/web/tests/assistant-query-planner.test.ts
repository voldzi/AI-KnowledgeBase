import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAssistantQueryPlan } from "../src/lib/assistant/assistant-query-planner";

describe("assistant query planner", () => {
  it("builds a stable obligation table plan with row-level citation gates", () => {
    const input = {
      message: "Vytvoř tabulku povinností podle citovaných zdrojů.",
      language: "cs" as const,
      tool: "rag_document_answer" as const,
      reason: "rag_structured_output" as const,
      structuredOutput: true,
      obligationOutput: true,
      registryReportKind: null,
      registryTopics: []
    };

    const first = buildAssistantQueryPlan(input);
    const second = buildAssistantQueryPlan(input);

    assert.equal(first.plan_id, second.plan_id);
    assert.equal(first.version, "2026-06-23");
    assert.equal(first.intent, "obligation_table");
    assert.equal(first.output.kind, "table");
    assert.equal(first.output.artifact_contract_version, "report.v2");
    assert.equal(first.quality_gates.citations_required, true);
    assert.equal(first.quality_gates.row_citations_required, true);
    assert.equal(first.quality_gates.min_columns, 2);
    assert.equal(first.quality_gates.min_informative_cells_per_row, 2);
  });

  it("allows registry metadata reports without chunk citations", () => {
    const plan = buildAssistantQueryPlan({
      message: "Kolik máme dokumentů na téma digitalizace?",
      language: "cs",
      tool: "registry_document_report",
      reason: "registry_metadata_intent",
      structuredOutput: false,
      obligationOutput: false,
      registryReportKind: "document_inventory_summary",
      registryTopics: ["digitalizace"]
    });

    assert.equal(plan.intent, "document_metadata_report");
    assert.equal(plan.output.kind, "registry_report");
    assert.equal(plan.quality_gates.citations_required, false);
    assert.equal(plan.quality_gates.row_citations_required, false);
    assert.equal(plan.quality_gates.registry_metadata_without_chunk_citations_allowed, true);
    assert.deepEqual(plan.retrieval.topics, ["digitalizace"]);
  });
});
