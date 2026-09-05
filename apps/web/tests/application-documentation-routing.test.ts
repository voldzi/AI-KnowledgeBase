import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveApplicationDocumentationRequest } from "../src/lib/assistant/application-documentation-intent";
import { ragContextForAssistantRoute, routeAssistantMessage } from "../src/lib/assistant/assistant-tool-router";
import { resolveConversationQuery } from "../src/lib/director-copilot/query-state";
import { classifyDirectorCopilotV2Intent } from "../src/lib/director-copilot-v2/intent-router";

const DOCUMENT_QUESTIONS = [
  "Co je STRATOS a jaké aplikace obsahuje?",
  "Co umí AKB a Budget?",
  "Co všechno STRATOS umí?",
  "Jaké výhody a omezení má ProjectFlow?",
  "Je Budget bezpečný?",
  "Jaké jsou možnosti aplikace ArchFlow?",
  "Jak funguje ProjectFlow?",
  "K čemu slouží ArchFlow?",
  "Jaké jsou požadavky na infrastrukturu pro AKB a STRATOS?",
  "Jak je zabezpečený Budget?",
  "Jak chat odpovídá na dotazy uživatelů?",
  "Kde najdu manuál ProjectFlow?",
  "Jak nainstaluji Budget?",
  "Jak se v aplikaci Budget nastavuje rozpočet?",
  "Jaké porty a certifikáty potřebujeme pro instalaci?",
  "Potřebuje AKB GPU, kolik RAM doporučuje instalační příručka?",
  "Je možné nasazení pouze ve vnitřní síti bez internetu?",
  "Jak funguje SSO a autorizace v AKB?",
  "Jak obnovím AKB ze zálohy?",
  "Jaké RPO a RTO máme garantované?",
  "Jak vypadá retenční politika pro dokumenty?",
  "Srovnej bezpečnost AKB a STRATOS.",
  "What does Budget do and how does ProjectFlow work?",
  "Describe the infrastructure requirements for AKB.",
  "Where is the ProjectFlow user guide?",
];

const LIVE_QUESTIONS = [
  "Jaký má IT rozpočet na rok 2025?",
  "Kolik akcí má plán na rok 2025?",
  "Jaká je největší akce plánovaná v roce 2025?",
  "Jaký je aktuální stav projektů?",
  "Které projekty v ProjectFlow řeší obnovu infrastruktury?",
  "Jaká je nejdražší akce obnovy infrastruktury v plánu roku 2025?",
  "Kolik potřeb čeká v ArchFlow?",
  "What is this year's budget forecast?",
  "Jak je možno vylepšit finanční plán?",
  "Jaké jsou možnosti snížení výdajů v Budget?",
  "Zhodnoť finanční plán, stav projektového portfolia a potřeby ArchFlow a navrhni zlepšení.",
];

describe("recipient documentation and operational source boundaries", () => {
  for (const message of DOCUMENT_QUESTIONS) {
    it(`retrieves documentation: ${message}`, () => {
      const route = routeAssistantMessage(message, "cs");
      assert.equal(classifyDirectorCopilotV2Intent(message), null);
      assert.equal(resolveConversationQuery({ message }).recognized, false);
      assert.equal(route.tool, "rag_document_answer");
      assert.ok(route.documentKnowledge.applicationDocumentation);
      assert.ok(!route.documentKnowledge.retrievalHints.includes("IT podpora"));
      assert.match(route.answerFormatInstruction ?? "", /RPO/);
    });
  }

  for (const message of LIVE_QUESTIONS) {
    it(`keeps governed live data: ${message}`, () => {
      assert.equal(resolveApplicationDocumentationRequest(message), null);
      assert.ok(classifyDirectorCopilotV2Intent(message));
    });
  }

  it("does not carry a previous financial entity into a new documentation question", () => {
    const financial = resolveConversationQuery({ message: "Jaký má IT rozpočet na rok 2025?" });
    const context = { stratos_query_state: financial.state };
    const message = "A jaké jsou požadavky na infrastrukturu pro AKB?";
    const resolved = resolveConversationQuery({ message, context });
    assert.equal(classifyDirectorCopilotV2Intent(message, context), null);
    assert.deepEqual(resolved.state.sources, []);
    assert.deepEqual(resolved.state.metrics, []);
    assert.equal(resolved.inherited, false);
    const route = routeAssistantMessage(message, "cs", context);
    assert.equal(ragContextForAssistantRoute(context, route).stratos_query_state, null);
  });

  it("does not reinterpret an ambiguous live infrastructure query as installation documentation", () => {
    for (const message of ["Které projekty řeší obnovu infrastruktury?", "Jaká je nejdražší akce obnovy infrastruktury?"]) {
      assert.equal(resolveApplicationDocumentationRequest(message), null);
    }
  });

  it("preserves documentation continuity but not across an explicit new live query", () => {
    const route = routeAssistantMessage("Jak funguje ProjectFlow?", "cs");
    const context = ragContextForAssistantRoute({}, route);
    assert.equal(classifyDirectorCopilotV2Intent("A jak se to nastavuje?", context), null);
    assert.equal(classifyDirectorCopilotV2Intent("Kolik akcí má plán na rok 2025?", context), "budget_portfolio_status");
  });

  it("splits an explicit compound question into independently authorized source requests", () => {
    const message = "Popiš infrastrukturu AKB a kolik akcí má plán na rok 2025?";
    const request = resolveApplicationDocumentationRequest(message);
    assert.equal(request?.documentMessage, "Popiš infrastrukturu AKB");
    assert.equal(request?.liveMessage, "kolik akcí má plán na rok 2025");
    assert.equal(classifyDirectorCopilotV2Intent(message), "budget_portfolio_status");
    const state = resolveConversationQuery({ message }).state;
    assert.deepEqual(state.sources, ["budget"]);
    assert.equal(state.operation, "count");
    assert.equal(state.period.fiscal_year, 2025);
  });

  it("does not turn a PDF resource request into a new report", () => {
    const route = routeAssistantMessage("Kde najdu PDF manuál ProjectFlow?", "cs");
    assert.equal(route.structuredOutput, false);
    assert.equal(route.documentKnowledge.intent, "resource");
    assert.ok(!route.documentKnowledge.retrievalHints.includes("žádost"));
  });

  it("keeps legal decisions on the controlled rule path", () => {
    const route = routeAssistantMessage("Jaké jsou zákonné limity pro VZMR?", "cs");
    assert.equal(route.tool, "controlled_rule_answer");
  });
});
