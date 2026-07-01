import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ragContextForAssistantRoute,
  routeAssistantMessage,
  routeAssistantMessageForRag
} from "../src/lib/assistant/assistant-tool-router";

describe("assistant tool router", () => {
  it("routes inventory questions to registry metadata reports", () => {
    const route = routeAssistantMessage("Kolik máme dokumentů na téma digitalizace?", "cs");

    assert.equal(route.tool, "registry_document_report");
    assert.equal(route.reason, "registry_metadata_intent");
    assert.equal(route.registryReportKind, "document_inventory_summary");
    assert.deepEqual(route.registryTopics, ["digitalizace"]);
    assert.equal(route.answerFormatInstruction, null);
    assert.equal(route.queryPlan.intent, "document_metadata_report");
    assert.equal(route.queryPlan.output.kind, "registry_report");
    assert.equal(route.queryPlan.quality_gates.registry_metadata_without_chunk_citations_allowed, true);
  });

  it("routes document list requests to registry metadata reports", () => {
    const route = routeAssistantMessage("Seznam smluv vytvoř do tabulky.", "cs");

    assert.equal(route.tool, "registry_document_report");
    assert.equal(route.registryReportKind, "document_list");
    assert.deepEqual(route.registryTopics, ["smlouvy"]);
    assert.equal(route.structuredOutput, true);
    assert.equal(route.queryPlan.intent, "document_list");
  });

  it("routes contract title and description follow-ups to document lists", () => {
    const route = routeAssistantMessage("Udělej tabulku smluv vlevo název, vpravo stručný popis", "cs", {
      answer_source: "registry_metadata",
      report_kind: "document_type_count"
    });

    assert.equal(route.tool, "registry_document_report");
    assert.equal(route.registryReportKind, "document_list");
    assert.deepEqual(route.registryTopics, ["smlouvy"]);
    assert.equal(route.structuredOutput, true);
    assert.equal(route.queryPlan.intent, "document_list");
  });

  it("routes document type breakdown questions to registry metadata reports", () => {
    const route = routeAssistantMessage("Jakého typu jsou dokumenty, které máš k dispozici?", "cs");

    assert.equal(route.tool, "registry_document_report");
    assert.equal(route.reason, "registry_metadata_intent");
    assert.equal(route.registryReportKind, "document_type_count");
    assert.deepEqual(route.registryTopics, ["všechny dokumenty"]);
    assert.equal(route.queryPlan.intent, "document_metadata_report");
    assert.equal(route.queryPlan.retrieval.registry_report_kind, "document_type_count");
  });

  it("keeps registry follow-up report requests on the registry path", () => {
    const route = routeAssistantMessage("Ok vytvoř tedy sestavu, kde bude typ počet", "cs", {
      answer_source: "registry_metadata_summary",
      report_kind: "document_inventory_summary"
    });

    assert.equal(route.tool, "registry_document_report");
    assert.equal(route.registryReportKind, "document_type_count");
    assert.equal(route.structuredOutput, true);
    assert.equal(route.queryPlan.retrieval.registry_report_kind, "document_type_count");
  });

  it("keeps content interpretation reports on the RAG answer path", () => {
    const route = routeAssistantMessage("Vytvoř sestavu z obsahu smlouvy o podpoře.", "cs");
    const context = ragContextForAssistantRoute({ entity_id: "contract-1" }, route);

    assert.equal(route.tool, "rag_document_answer");
    assert.equal(route.reason, "rag_structured_output");
    assert.equal(route.registryReportKind, null);
    assert.deepEqual(route.registryTopics, []);
    assert.match(route.answerFormatInstruction ?? "", /markdown tabulku s alespoň dvěma významovými sloupci/);
    assert.equal(context.entity_id, "contract-1");
    assert.equal("assistant_tool" in context, false);
    assert.equal((context.assistant_query_plan as { intent?: string }).intent, "structured_report");
    assert.match(String(context.answer_format_instruction), /Nevracej jednosloupcový seznam/);
  });

  it("adds obligation-specific guidance for structured obligation answers", () => {
    const route = routeAssistantMessage("Vytvoř tabulku povinností podle citovaných zdrojů.", "cs");

    assert.equal(route.tool, "rag_document_answer");
    assert.equal(route.obligationOutput, true);
    assert.equal(route.queryPlan.intent, "obligation_table");
    assert.deepEqual(route.queryPlan.output.required_columns, [
      "povinnost_nebo_oblast",
      "citovane_ustanoveni_nebo_zdroj",
      "prakticky_vyznam_nebo_poznamka"
    ]);
    assert.match(route.answerFormatInstruction ?? "", /U každého řádku povinnosti/);
  });

  it("uses explicit report mode context for natural-language questions", () => {
    const route = routeAssistantMessage("Jaké povinnosti z toho plynou?", "cs", {
      assistant_report_request: {
        enabled: true,
        output_kind: "table",
        template: "obligation_table",
        detail_level: "detailed",
        export_format: "pdf",
        columns: ["obligation_or_area", "owner_or_role", "deadline_or_frequency"],
        require_row_citations: true
      }
    });
    const context = ragContextForAssistantRoute({ entity_id: "project-1" }, route);

    assert.equal(route.tool, "rag_document_answer");
    assert.equal(route.reason, "rag_structured_output");
    assert.equal(route.structuredOutput, true);
    assert.equal(route.queryPlan.intent, "obligation_table");
    assert.deepEqual(route.queryPlan.output.preferred_export_formats, ["pdf"]);
    assert.match(route.answerFormatInstruction ?? "", /Povinnost nebo oblast, Vlastník nebo role, Termín nebo periodicita/);
    assert.equal(context.entity_id, "project-1");
    assert.equal((context.assistant_query_plan as { output?: { detail_level?: string } }).output?.detail_level, "detailed");
  });

  it("keeps ordinary questions on the plain grounded RAG path", () => {
    const route = routeAssistantMessage("Kdo schvaluje výjimku ze směrnice?", "cs");
    const originalContext = { tenant_id: "tenant-1" };

    assert.equal(route.tool, "rag_document_answer");
    assert.equal(route.reason, "rag_grounded_answer");
    assert.equal(route.answerFormatInstruction, null);
    const context = ragContextForAssistantRoute(originalContext, route);
    assert.equal(context.tenant_id, "tenant-1");
    assert.equal((context.assistant_query_plan as { intent?: string }).intent, "grounded_answer");
  });

  it("forces clarify-style continuation back to the RAG path", () => {
    const route = routeAssistantMessageForRag("Seznam smluv vytvoř do tabulky.", "cs");

    assert.equal(route.tool, "rag_document_answer");
    assert.equal(route.reason, "rag_structured_output");
    assert.equal(route.registryReportKind, null);
    assert.deepEqual(route.registryTopics, []);
    assert.equal(route.queryPlan.intent, "structured_report");
    assert.match(route.answerFormatInstruction ?? "", /markdown tabulku/);
  });
});
