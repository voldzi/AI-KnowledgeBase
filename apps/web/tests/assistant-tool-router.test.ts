import assert from "node:assert/strict";
import { describe, it, test } from "node:test";

import {
  answerModeForAssistantRequest,
  ragContextForAssistantRoute,
  routeAssistantMessage,
  routeAssistantMessageForRag
} from "../src/lib/assistant/assistant-tool-router";

test("generic browser mode uses the routed document answer mode", () => {
  const route = routeAssistantMessage("Kde najdu formulář pro zahraniční cestu?", "cs");

  assert.equal(answerModeForAssistantRequest(route, "ask"), "find_procedure");
  assert.equal(answerModeForAssistantRequest(route, undefined), "find_procedure");
});

test("explicit specialized API mode remains compatible", () => {
  const route = routeAssistantMessage("Shrň interní směrnici", "cs");

  assert.equal(answerModeForAssistantRequest(route, "summary"), "summary");
  assert.equal(answerModeForAssistantRequest(route, "audit_question"), "audit_question");
  assert.equal(answerModeForAssistantRequest(route, "unknown"), route.answerMode);
});

describe("assistant tool router", () => {
  it("routes public procurement rules to the governed rule catalog", () => {
    const route = routeAssistantMessage(
      "Jaký je limit pro veřejnou zakázku malého rozsahu podle směrnice č. 2/2023?",
      "cs",
    );

    assert.equal(route.tool, "controlled_rule_answer");
    assert.equal(route.reason, "controlled_rule_intent");
    assert.equal(route.controlledRuleIntent?.domain, "public_procurement");
    assert.equal(route.controlledRuleIntent?.validOn, null);
    assert.equal(route.queryPlan.intent, "controlled_rule_answer");
    assert.equal(route.queryPlan.quality_gates.citations_required, true);
  });

  it("keeps controlled-rule follow-ups in the governed domain", () => {
    const route = routeAssistantMessage("A jaké doklady jsou potřeba?", "cs", {
      answer_source: "controlled_rules",
      controlled_rule_domain: "public_procurement",
      controlled_rule_valid_on: "2026-08-03",
    });

    assert.equal(route.tool, "controlled_rule_answer");
    assert.equal(route.controlledRuleIntent?.validOn, "2026-08-03");
  });

  it("keeps a statutory-source follow-up in the governed domain", () => {
    const route = routeAssistantMessage("A co zákon?", "cs", {
      answer_source: "controlled_rules",
      controlled_rule_domain: "public_procurement",
      controlled_rule_valid_on: "2026-08-03",
    });

    assert.equal(route.tool, "controlled_rule_answer");
    assert.equal(route.controlledRuleIntent?.domain, "public_procurement");
    assert.equal(route.controlledRuleIntent?.validOn, "2026-08-03");
  });

  it("does not carry a procurement rule context into an explicit NIS2 question", () => {
    const route = routeAssistantMessage(
      "Co znamená NIS2 a jaké povinnosti ukládá? Uveď citovatelné zdroje.",
      "cs",
      {
        answer_source: "controlled_rules",
        controlled_rule_domain: "public_procurement",
        controlled_rule_valid_on: "2026-08-10",
      },
    );

    assert.equal(route.tool, "rag_document_answer");
    assert.equal(route.reason, "rag_document_task");
    assert.equal(route.controlledRuleIntent, null);
    assert.equal(route.documentKnowledge.intent, "obligation");
    assert.equal(route.documentKnowledge.inherited, false);
  });

  it("recognizes a governed procurement concept without requiring the formal domain name", () => {
    const route = routeAssistantMessage(
      "Jaký limit platí pro průzkum trhu a kolik nabídek je potřeba?",
      "cs",
    );

    assert.equal(route.tool, "controlled_rule_answer");
    assert.equal(route.controlledRuleIntent?.domain, "public_procurement");
  });

  it("routes an explicit procurement question despite inherited ArchFlow context", () => {
    const route = routeAssistantMessage(
      "Jaké jsou interní a zákonné limity pro veřejné zakázky?",
      "cs",
      {
        answer_source: "director_copilot_v2",
        stratos_query_state: {
          sources: ["archflow"],
        },
      },
    );

    assert.equal(route.tool, "controlled_rule_answer");
    assert.equal(route.controlledRuleIntent?.domain, "public_procurement");
  });

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

  it("routes contract-content questions to authorized document RAG", () => {
    const route = routeAssistantMessage(
      "Co stanoví smlouva k projektu Disky pro QNAP o ceně, termínu plnění a závazcích? Uveď zdroj.",
      "cs",
    );

    assert.equal(route.tool, "rag_document_answer");
    assert.equal(route.reason, "rag_grounded_answer");
    assert.equal(route.queryPlan.quality_gates.citations_required, true);
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
    assert.equal(route.reason, "rag_document_task");
    assert.equal(route.answerMode, "find_owner");
    assert.equal(route.queryPlan.intent, "owner_lookup");
    assert.match(route.answerFormatInstruction ?? "", /odpovědnou roli nebo kontakt/);
    const context = ragContextForAssistantRoute(originalContext, route);
    assert.equal(context.tenant_id, "tenant-1");
    assert.equal((context.assistant_query_plan as { intent?: string }).intent, "owner_lookup");
    assert.deepEqual(context.document_knowledge_state, {
      version: "document-knowledge-intent-1",
      intent: "owner",
      answer_mode: "find_owner",
      task_oriented: true,
      explicit: true,
      inherited: false,
    });
  });

  it("routes employee procedure and resource questions to task-aware RAG", () => {
    const procedure = routeAssistantMessage("Jak si nastavím dovolenou?", "cs");
    const resource = routeAssistantMessage("Kde najdu formulář na zahraniční cestu?", "cs");
    const support = routeAssistantMessage("Kde mám napsat problém s IT?", "cs");

    assert.equal(procedure.reason, "rag_document_task");
    assert.equal(procedure.answerMode, "find_procedure");
    assert.equal(procedure.queryPlan.intent, "procedure_lookup");
    assert.equal(resource.queryPlan.intent, "resource_location");
    assert.match(resource.answerFormatInstruction ?? "", /Odkaz či název souboru uveď jen/);
    assert.equal(support.queryPlan.intent, "support_channel");
    assert.match(support.answerFormatInstruction ?? "", /Nepředpokládej, že existuje Service Desk/);
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
