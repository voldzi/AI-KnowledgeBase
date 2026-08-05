import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyDirectorCopilotV2Intent } from "../src/lib/director-copilot-v2/intent-router";
import { resolveConversationQuery } from "../src/lib/director-copilot/query-state";
import type {
  StratosSemanticMetric,
  StratosSemanticSource,
} from "../src/lib/director-copilot/semantic-types";

const NOW = new Date("2026-07-29T08:00:00Z");

const CONCEPTS: Array<{
  phrase: string;
  metric: StratosSemanticMetric;
  source: StratosSemanticSource;
  intent: string;
}> = [
  {
    phrase: "schváleném finančním plánu",
    metric: "budget.plan_amount",
    source: "budget",
    intent: "budget_portfolio_status",
  },
  {
    phrase: "zaúčtované skutečnosti a čerpání",
    metric: "budget.actual_amount",
    source: "budget",
    intent: "budget_portfolio_status",
  },
  {
    phrase: "předpokládaných nákladech",
    metric: "budget.forecast_amount",
    source: "budget",
    intent: "budget_portfolio_status",
  },
  {
    phrase: "otevřených finančních závazcích",
    metric: "budget.commitments_amount",
    source: "budget",
    intent: "budget_portfolio_status",
  },
  {
    phrase: "úspoře proti schválenému plánu",
    metric: "budget.variance_amount",
    source: "budget",
    intent: "budget_portfolio_status",
  },
  {
    phrase: "termínovém skluzu projektů",
    metric: "milestone.max_delay_days",
    source: "projectflow",
    intent: "project_portfolio_status",
  },
  {
    phrase: "následujících milnících",
    metric: "milestone.next_due_date",
    source: "projectflow",
    intent: "project_portfolio_status",
  },
  {
    phrase: "připravenosti business potřeb",
    metric: "archflow.need.readiness_score",
    source: "archflow",
    intent: "archflow_demand_overview",
  },
  {
    phrase: "dopadovém skóre požadavků",
    metric: "archflow.need.impact_score",
    source: "archflow",
    intent: "archflow_demand_overview",
  },
  {
    phrase: "stavu AI podnětů",
    metric: "archflow.need.status",
    source: "archflow",
    intent: "archflow_demand_overview",
  },
];

const WRAPPERS = [
  (phrase: string) => `Co víme o ${phrase}?`,
  (phrase: string) => `Připrav mi přehled o ${phrase}.`,
  (phrase: string) => `Potřebuji informace k ${phrase}.`,
  (phrase: string) => `Ukaž současný pohled na ${phrase}.`,
] as const;

describe("Director Copilot compositional semantic routing", () => {
  it("combines domain concepts with varied sentence forms and Czech inflection", () => {
    let evaluated = 0;
    for (const concept of CONCEPTS) {
      for (const wrap of WRAPPERS) {
        const message = wrap(concept.phrase);
        const resolved = resolveConversationQuery({ message, now: NOW });
        assert.equal(resolved.recognized, true, message);
        assert.deepEqual(resolved.state.sources, [concept.source], message);
        assert.ok(resolved.state.metrics.includes(concept.metric), message);
        assert.equal(classifyDirectorCopilotV2Intent(message), concept.intent, message);
        evaluated += 1;
      }
    }
    assert.equal(evaluated, CONCEPTS.length * WRAPPERS.length);
  });

  it("composes ranking and item granularity independently from the financial metric", () => {
    const messages = [
      "Který řádek rozpočtu má nejvyšší schválený plán?",
      "Ukaž nejdražší rozpočtovou kapitolu podle plánované částky.",
      "Která nákladová položka má maximální finanční plán?",
    ];
    for (const message of messages) {
      const resolved = resolveConversationQuery({ message, now: NOW });
      assert.deepEqual(resolved.state.sources, ["budget"], message);
      assert.ok(resolved.state.metrics.includes("budget.plan_amount"), message);
      assert.equal(resolved.state.granularity, "item", message);
      assert.deepEqual(
        resolved.state.sort,
        { metric: "budget.plan_amount", direction: "desc" },
        message,
      );
    }
  });

  it("keeps every detected live domain in a cross-application question", () => {
    const message = "Které potřeby mají navázané projekty, jaký mají plán a které jsou zpožděné?";
    const resolved = resolveConversationQuery({ message, now: NOW });

    assert.deepEqual(
      new Set(resolved.state.sources),
      new Set(["budget", "projectflow", "archflow"]),
    );
    assert.equal(
      classifyDirectorCopilotV2Intent(message),
      "portfolio_performance_overview",
    );
  });

  it("does not turn unrelated conversation into a live STRATOS data request", () => {
    const messages = [
      "Jak se dnes máš?",
      "Napiš krátké poděkování kolegům.",
      "Co říká tato metodika o plánování?",
      "Vysvětli mi obecně pojem inovace.",
    ];
    for (const message of messages) {
      assert.equal(classifyDirectorCopilotV2Intent(message), null, message);
    }
  });
});
