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
    assert.equal(first.version, "2026-07-28");
    assert.equal(first.intent, "obligation_table");
    assert.equal(first.output.kind, "table");
    assert.equal(first.output.artifact_contract_version, "report.v2");
    assert.equal(first.quality_gates.citations_required, true);
    assert.equal(first.quality_gates.row_citations_required, true);
    assert.equal(first.quality_gates.min_columns, 3);
    assert.equal(first.quality_gates.min_informative_cells_per_row, 2);
    assert.equal(first.execution.lane, "generative_rag");
    assert.equal(first.execution.retrieval_strategy, "hybrid");
    assert.equal(first.execution.generative_model_required, true);
  });

  it("uses report mode columns, detail, and export preference in the query plan", () => {
    const plan = buildAssistantQueryPlan({
      message: "Jaké povinnosti z toho plynou?",
      language: "cs",
      tool: "rag_document_answer",
      reason: "rag_structured_output",
      structuredOutput: true,
      obligationOutput: true,
      registryReportKind: null,
      registryTopics: [],
      reportRequest: {
        enabled: true,
        output_kind: "table",
        template: "obligation_table",
        detail_level: "detailed",
        export_format: "pdf",
        columns: ["obligation_or_area", "owner_or_role", "deadline_or_frequency"],
        require_row_citations: true
      }
    });

    assert.equal(plan.intent, "obligation_table");
    assert.deepEqual(plan.output.required_columns, ["Povinnost nebo oblast", "Vlastník nebo role", "Termín nebo periodicita"]);
    assert.deepEqual(plan.output.preferred_export_formats, ["pdf"]);
    assert.equal(plan.output.detail_level, "detailed");
    assert.equal(plan.quality_gates.min_columns, 3);
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
    assert.equal(plan.execution.lane, "deterministic_registry");
    assert.equal(plan.execution.retrieval_strategy, "none");
    assert.equal(plan.execution.generative_model_required, false);
  });

  it("builds a no-LLM lexical extraction plan with citation gates", () => {
    const plan = buildAssistantQueryPlan({
      message: "Cituj čl. 4 odst. 2 zákona 365/2000 Sb.",
      language: "cs",
      tool: "document_search_extract",
      reason: "document_lookup_intent",
      structuredOutput: false,
      obligationOutput: false,
      registryReportKind: null,
      registryTopics: []
    });

    assert.equal(plan.intent, "document_extract");
    assert.equal(plan.output.kind, "answer");
    assert.equal(plan.quality_gates.citations_required, true);
    assert.equal(plan.execution.lane, "lexical_extract");
    assert.equal(plan.execution.source_authority, "document_index");
    assert.equal(plan.execution.operation, "extract");
    assert.equal(plan.execution.retrieval_strategy, "lexical");
    assert.equal(plan.execution.generative_model_required, false);
    assert.equal(plan.execution.model_policy, "none");
    assert.equal(plan.execution.fallback_tool, null);
  });
});
