import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeAssistantChatResponse } from "../src/lib/assistant/assistant-response-normalizer";
import { routeAssistantMessage } from "../src/lib/assistant/assistant-tool-router";
import type { AssistantChatResponse, AssistantReportArtifact, Citation } from "../src/lib/types";

const citation: Citation = {
  document_id: "doc_1",
  document_version_id: "ver_1",
  document_title: "Metodika povinností",
  version_label: "v1",
  document_version: "v1",
  section_path: ["Povinnosti"],
  page_number: 4,
  chunk_id: "chunk_1"
};

function responseFixture(input: Partial<AssistantChatResponse> = {}): AssistantChatResponse {
  return {
    response_type: "answer",
    conversation_id: "conv_test",
    answer: null,
    message: null,
    questions: [],
    why_needed: null,
    current_context: {},
    citations: [citation],
    follow_up_questions: [],
    suggested_actions: [],
    report_artifacts: [],
    confidence: "medium",
    warnings: [],
    missing_information: null,
    recommended_action: null,
    ...input
  };
}

describe("assistant response normalizer", () => {
  it("adds enterprise routing context and promotes a useful RAG markdown table once", () => {
    const message = "vytvoř tabulku kde bude seznam povinností";
    const route = routeAssistantMessage(message, "cs");
    const response = responseFixture({
      answer: [
        "V rámci kategorie povinností se posuzují následující oblasti:",
        "",
        "| Oblast povinnosti | Ustanovení | Poznámka |",
        "| :--- | :--- | :--- |",
        "| právní povinnosti | VKB § 4 písm. a), b) | nad rámec VKB |",
        "| obchodní tajemství | VKB § 4 písm. a), b) | - |"
      ].join("\n"),
      current_context: { tenant_id: "tenant-1" }
    });

    const normalized = normalizeAssistantChatResponse({ response, message, language: "cs", route });

    assert.equal(normalized.current_context.tenant_id, "tenant-1");
    assert.equal(normalized.current_context.answer_source, "rag_retrieval");
    assert.equal(normalized.current_context.assistant_contract_version, "2026-06-23");
    assert.equal(normalized.current_context.assistant_tool, "rag_document_answer");
    assert.equal(normalized.current_context.assistant_tool_reason, "rag_structured_output");
    assert.equal(normalized.current_context.structured_output_requested, true);
    assert.equal(normalized.current_context.obligation_output_requested, true);
    assert.equal((normalized.current_context.assistant_query_plan as { intent?: string }).intent, "obligation_table");
    assert.equal(
      (normalized.current_context.assistant_query_plan as { output?: { artifact_contract_version?: string } }).output?.artifact_contract_version,
      "report.v2"
    );
    assert.equal(normalized.current_context.report_artifact_count, 1);
    assert.equal(normalized.report_artifacts.length, 1);
    assert.equal(normalized.report_artifacts[0]?.artifact_contract_version, "report.v2");
    assert.equal(normalized.report_artifacts[0]?.provenance?.query_plan_id, route.queryPlan.plan_id);
    assert.equal(normalized.answer?.includes("| :---"), false);
  });

  it("preserves registry answer source while adding the shared envelope", () => {
    const message = "Kolik máme dokumentů na téma digitalizace?";
    const route = routeAssistantMessage(message, "cs");
    const registryReport: AssistantReportArtifact = {
      artifact_id: "rpt_registry_inventory",
      title: "Inventura dokumentů podle témat",
      description: null,
      columns: [
        { key: "topic", label: "Téma", type: "text" },
        { key: "document_count", label: "Dokumentů", type: "number" }
      ],
      rows: [
        {
          row_id: "topic_digitalizace",
          cells: { topic: "digitalizace", document_count: 12 },
          citations: []
        }
      ],
      export_formats: ["xlsx", "pdf"],
      source_citation_count: 0,
      warnings: ["REGISTRY_METADATA_REPORT"]
    };
    const response = responseFixture({
      answer: "Na téma digitalizace máte 12 dokumentů.",
      citations: [],
      current_context: { answer_source: "registry_metadata_summary" },
      report_artifacts: [registryReport],
      warnings: ["REGISTRY_METADATA_REPORT"]
    });

    const normalized = normalizeAssistantChatResponse({ response, message, language: "cs", route });

    assert.equal(normalized.current_context.answer_source, "registry_metadata_summary");
    assert.equal(normalized.current_context.assistant_tool, "registry_document_report");
    assert.equal(normalized.current_context.assistant_tool_reason, "registry_metadata_intent");
    assert.equal(normalized.current_context.registry_report_kind, "document_inventory_summary");
    assert.equal(normalized.current_context.registry_topic_count, 1);
    assert.equal((normalized.current_context.assistant_query_plan as { intent?: string }).intent, "document_metadata_report");
    assert.equal(normalized.current_context.report_artifact_count, 1);
    assert.equal(normalized.report_artifacts[0]?.artifact_id, registryReport.artifact_id);
    assert.equal(normalized.report_artifacts[0]?.artifact_kind, "registry_metadata_table");
  });
});
