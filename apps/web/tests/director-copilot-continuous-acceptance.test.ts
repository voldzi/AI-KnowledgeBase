import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { routeAssistantMessage } from "../src/lib/assistant/assistant-tool-router";
import { classifyDirectorCopilotV2Intent } from "../src/lib/director-copilot-v2/intent-router";
import { pinnedDirectorCopilotV2CatalogForTests } from "../src/lib/director-copilot-v2/manifest-catalog";
import { buildDirectorCopilotV2Plan } from "../src/lib/director-copilot-v2/planner";
import type { DirectorCopilotIntent } from "../src/lib/director-copilot-v2/shared";
import { V2_TOOL_IDS, type DirectorCopilotV2ToolId } from "../src/lib/director-copilot-v2/contracts";
import {
  resolveConversationQuery,
  type QueryGrouping,
  type QueryOperation,
} from "../src/lib/director-copilot/query-state";
import type { ApiRequestContext } from "../src/lib/types";
import type {
  StratosSemanticMetric,
  StratosSemanticSource,
} from "../src/lib/director-copilot/semantic-types";

const NOW = new Date("2026-08-05T08:00:00.000Z");
const YEARS = [2024, 2025, 2026] as const;
const PREFIXES = ["", "Prosím, ", "Pro poradu vedení: "] as const;

interface LiveConcept {
  entity: string;
  metricPhrase: string;
  source: StratosSemanticSource;
  metric: StratosSemanticMetric;
  intent: DirectorCopilotIntent;
  tool: DirectorCopilotV2ToolId;
}

const LIVE_CONCEPTS: LiveConcept[] = [
  budgetConcept("schválený finanční plán", "budget.plan_amount"),
  budgetConcept("zaúčtovanou skutečnost a čerpání", "budget.actual_amount"),
  budgetConcept("předpokládaný finanční výhled", "budget.forecast_amount"),
  budgetConcept("otevřené finanční závazky", "budget.commitments_amount"),
  budgetConcept("odchylku od schváleného rozpočtového plánu", "budget.variance_amount"),
  {
    entity: "projektů",
    metricPhrase: "termínové zpoždění projektů",
    source: "projectflow",
    metric: "milestone.max_delay_days",
    intent: "project_portfolio_status",
    tool: V2_TOOL_IDS.projectflow,
  },
  {
    entity: "business potřeb v ArchFlow",
    metricPhrase: "připravenost business potřeb v ArchFlow",
    source: "archflow",
    metric: "archflow.need.readiness_score",
    intent: "archflow_demand_overview",
    tool: V2_TOOL_IDS.archflow,
  },
  {
    entity: "požadavků v ArchFlow",
    metricPhrase: "dopadové skóre požadavků v ArchFlow",
    source: "archflow",
    metric: "archflow.need.impact_score",
    intent: "archflow_demand_overview",
    tool: V2_TOOL_IDS.archflow,
  },
];

const OPERATION_TEMPLATES: Array<{
  operation: QueryOperation;
  render: (concept: LiveConcept, year: number) => string;
}> = [
  {
    operation: "summary",
    render: (concept, year) => `Připrav souhrn pro ${concept.metricPhrase} v roce ${year}.`,
  },
  {
    operation: "count",
    render: (concept, year) => `Kolik ${concept.entity} evidujeme pro ${concept.metricPhrase} v roce ${year}?`,
  },
  {
    operation: "list",
    render: (concept, year) => `Vypiš ${concept.entity} a ukaž ${concept.metricPhrase} v roce ${year}.`,
  },
  {
    operation: "rank",
    render: (concept, year) => `Které z ${concept.entity} mají nejvyšší ${concept.metricPhrase} v roce ${year}?`,
  },
];

describe("continuous Czech assistant acceptance", () => {
  it("plans more than 300 realistic live-data questions with bounded latency", () => {
    const catalog = pinnedDirectorCopilotV2CatalogForTests();
    const context = projectedContext();
    const latencies: number[] = [];
    let evaluated = 0;

    for (const concept of LIVE_CONCEPTS) {
      for (const year of YEARS) {
        for (const template of OPERATION_TEMPLATES) {
          for (const prefix of PREFIXES) {
            const message = `${prefix}${template.render(concept, year)}`;
            const startedAt = performance.now();
            const resolved = resolveConversationQuery({ message, now: NOW });
            const intent = classifyDirectorCopilotV2Intent(message);

            assert.equal(resolved.recognized, true, message);
            assert.equal(resolved.clarification, null, message);
            assert.deepEqual(resolved.state.sources, [concept.source], message);
            assert.ok(resolved.state.metrics.includes(concept.metric), message);
            assert.equal(resolved.state.period.fiscal_year, year, message);
            assert.equal(resolved.state.operation, template.operation, message);
            assert.equal(intent, concept.intent, message);

            const plan = buildDirectorCopilotV2Plan({
              message,
              language: "cs",
              context,
              intent: concept.intent,
              queryState: resolved.state,
              catalog,
              now: NOW,
            });
            assert.deepEqual(plan.nodes.map((node) => node.tool_id), [concept.tool], message);
            assert.ok(plan.nodes.every((node) => (
              node.access.authorized
              && node.request !== null
              && node.planning_error_code === null
            )), message);
            latencies.push(performance.now() - startedAt);
            evaluated += 1;
          }
        }
      }
    }

    const groupingCases: Array<{
      message: string;
      source: StratosSemanticSource;
      group: QueryGrouping;
      tool: DirectorCopilotV2ToolId;
    }> = [
      {
        message: "Rozděl schválený finanční plán podle portfolií",
        source: "budget" as const,
        group: "portfolio",
        tool: V2_TOOL_IDS.budgetOrganization,
      },
      {
        message: "Rozděl projekty podle stavu harmonogramu",
        source: "projectflow" as const,
        group: "schedule_status",
        tool: V2_TOOL_IDS.projectflow,
      },
      {
        message: "Rozděl připravenost business potřeb v ArchFlow podle organizačních jednotek",
        source: "archflow" as const,
        group: "organization_unit",
        tool: V2_TOOL_IDS.archflow,
      },
    ];
    for (const grouping of groupingCases) {
      for (const year of YEARS) {
        for (const prefix of ["", "Prosím, ", "Pro vedení: ", "Pro měsíční poradu: "] as const) {
          const message = `${prefix}${grouping.message} za rok ${year}.`;
          const startedAt = performance.now();
          const resolved = resolveConversationQuery({ message, now: NOW });
          const intent = classifyDirectorCopilotV2Intent(message);
          assert.equal(resolved.recognized, true, message);
          assert.deepEqual(resolved.state.sources, [grouping.source], message);
          assert.ok(resolved.state.group_by.includes(grouping.group), message);
          assert.ok(intent, message);
          const plan = buildDirectorCopilotV2Plan({
            message,
            language: "cs",
            context,
            intent: intent!,
            queryState: resolved.state,
            catalog,
            now: NOW,
          });
          assert.deepEqual(plan.nodes.map((node) => node.tool_id), [grouping.tool], message);
          assert.ok(plan.nodes.every((node) => node.request !== null && node.access.authorized), message);
          latencies.push(performance.now() - startedAt);
          evaluated += 1;
        }
      }
    }

    latencies.sort((left, right) => left - right);
    const p95 = latencies[Math.floor((latencies.length - 1) * 0.95)] ?? Infinity;
    assert.ok(evaluated >= 300, `evaluated only ${evaluated} questions`);
    assert.ok(p95 < 50, `deterministic planner p95 ${p95.toFixed(2)} ms exceeded 50 ms`);
  });

  it("keeps operation, year, metric and grouping in follow-up context", () => {
    const first = resolveConversationQuery({
      message: "Vypiš rozpočtové položky a ukaž schválený finanční plán za rok 2025.",
      now: NOW,
    });
    const count = resolveConversationQuery({
      message: "A kolik jich je?",
      context: { stratos_query_state: first.state },
      now: NOW,
    });
    const grouped = resolveConversationQuery({
      message: "Rozděl je podle portfolií.",
      context: { stratos_query_state: count.state },
      now: NOW,
    });

    assert.equal(count.inherited, true);
    assert.equal(count.state.operation, "count");
    assert.equal(count.state.period.fiscal_year, 2025);
    assert.deepEqual(count.state.metrics, ["budget.plan_amount"]);
    assert.deepEqual(grouped.state.group_by, ["portfolio"]);
    assert.deepEqual(grouped.state.sources, ["budget"]);
  });

  it("fails closed when the projection does not authorize a selected tool", () => {
    const message = "Kolik rozpočtových položek evidujeme v plánu na rok 2025?";
    const resolved = resolveConversationQuery({ message, now: NOW });
    const plan = buildDirectorCopilotV2Plan({
      message,
      language: "cs",
      context: projectedContext({ budgetRead: false }),
      intent: "budget_portfolio_status",
      queryState: resolved.state,
      catalog: pinnedDirectorCopilotV2CatalogForTests(),
      now: NOW,
    });

    assert.equal(plan.nodes.length, 1);
    assert.equal(plan.nodes[0]?.access.authorized, false);
    assert.equal(plan.nodes[0]?.request, null);
  });

  it("keeps governed rules and document answers behind citation gates", () => {
    const governedQuestions = [
      "Jaké jsou limity pro VZMR?",
      "Jaký limit platí pro průzkum trhu?",
      "Kolik nabídek požaduje směrnice pro veřejné zakázky?",
      "Jaké doklady vyžadují pravidla veřejných zakázek?",
      "Co stanoví zákon pro veřejné zakázky malého rozsahu?",
    ];
    const documentQuestions = [
      "Co stanoví interní směrnice o řízení projektů?",
      "Shrň povinnosti z metodiky informační bezpečnosti.",
      "Kdo podle dokumentu schvaluje výjimku?",
      "Jaké termíny jsou uvedené ve smlouvě?",
      "Vysvětli obsah přiloženého předpisu.",
    ];
    const registryQuestions = [
      "Kolik máme dokumentů na téma bezpečnost?",
      "Vypiš seznam interních směrnic.",
      "Kolik evidujeme smluv?",
      "Jaké typy dokumentů máme v registru?",
      "Vytvoř přehled dokumentů k projektům.",
    ];
    let evaluated = 0;

    for (const prefix of ["", "Prosím, ", "Pro audit: ", "Pro vedení: "] as const) {
      for (const message of governedQuestions) {
        const route = routeAssistantMessage(`${prefix}${message}`, "cs");
        assert.equal(route.tool, "controlled_rule_answer", message);
        assert.equal(route.queryPlan.quality_gates.citations_required, true, message);
        evaluated += 1;
      }
      for (const message of documentQuestions) {
        const route = routeAssistantMessage(`${prefix}${message}`, "cs");
        assert.equal(route.tool, "rag_document_answer", message);
        assert.equal(route.queryPlan.quality_gates.citations_required, true, message);
        evaluated += 1;
      }
      for (const message of registryQuestions) {
        const route = routeAssistantMessage(`${prefix}${message}`, "cs");
        assert.equal(route.tool, "registry_document_report", message);
        assert.equal(
          route.queryPlan.quality_gates.registry_metadata_without_chunk_citations_allowed,
          true,
          message,
        );
        evaluated += 1;
      }
    }

    assert.equal(evaluated, 60);
  });
});

function budgetConcept(
  metricPhrase: string,
  metric: StratosSemanticMetric,
): LiveConcept {
  return {
    entity: "rozpočtových položek",
    metricPhrase,
    source: "budget",
    metric,
    intent: "budget_portfolio_status",
    tool: V2_TOOL_IDS.budgetOrganization,
  };
}

function projectedContext(options: { budgetRead?: boolean } = {}): ApiRequestContext {
  return {
    subjectId: "acceptance-user",
    organizationId: "org_stratos",
    identityActive: true,
    membershipActive: true,
    applicationAccessActive: true,
    authorizationSource: "stratos_projection",
    accessToken: "actor-token",
    requestId: "acceptance-request",
    correlationId: "acceptance-correlation",
    applicationAccess: [
      access("budget", options.budgetRead === false
        ? ["budget:access"]
        : ["budget:access", "budget:read"]),
      access("projectflow", ["projectflow:access", "projectflow:read"]),
      access("archflow", ["archflow:access", "archflow:read_organization"]),
    ],
  };
}

function access(application: string, capabilities: string[]) {
  return {
    application,
    capabilities,
    scopes: ["organization:org_stratos"],
    effectiveScopes: ["organization:org_stratos"],
    validUntil: null,
  };
}
