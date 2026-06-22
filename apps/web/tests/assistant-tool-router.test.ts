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
  });

  it("routes document list requests to registry metadata reports", () => {
    const route = routeAssistantMessage("Seznam smluv vytvoř do tabulky.", "cs");

    assert.equal(route.tool, "registry_document_report");
    assert.equal(route.registryReportKind, "document_list");
    assert.deepEqual(route.registryTopics, ["smlouvy"]);
    assert.equal(route.structuredOutput, true);
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
    assert.match(String(context.answer_format_instruction), /Nevracej jednosloupcový seznam/);
  });

  it("adds obligation-specific guidance for structured obligation answers", () => {
    const route = routeAssistantMessage("Vytvoř tabulku povinností podle citovaných zdrojů.", "cs");

    assert.equal(route.tool, "rag_document_answer");
    assert.equal(route.obligationOutput, true);
    assert.match(route.answerFormatInstruction ?? "", /U každého řádku povinnosti/);
  });

  it("keeps ordinary questions on the plain grounded RAG path", () => {
    const route = routeAssistantMessage("Kdo schvaluje výjimku ze směrnice?", "cs");
    const originalContext = { tenant_id: "tenant-1" };

    assert.equal(route.tool, "rag_document_answer");
    assert.equal(route.reason, "rag_grounded_answer");
    assert.equal(route.answerFormatInstruction, null);
    assert.equal(ragContextForAssistantRoute(originalContext, route), originalContext);
  });

  it("forces clarify-style continuation back to the RAG path", () => {
    const route = routeAssistantMessageForRag("Seznam smluv vytvoř do tabulky.", "cs");

    assert.equal(route.tool, "rag_document_answer");
    assert.equal(route.reason, "rag_structured_output");
    assert.equal(route.registryReportKind, null);
    assert.deepEqual(route.registryTopics, []);
    assert.match(route.answerFormatInstruction ?? "", /markdown tabulku/);
  });
});
