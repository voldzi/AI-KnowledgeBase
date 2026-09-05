import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  answerModeForAssistantGoal,
  isAnalyticalAssistantGoal,
  queryStateForAssistantGoal,
  resolveAssistantUserGoal,
} from "../src/lib/assistant/user-goal";
import { resolveConversationQuery } from "../src/lib/director-copilot/query-state";

describe("assistant user goal", () => {
  it("distinguishes a recommendation from an ordinary financial lookup", () => {
    const recommendation = resolveAssistantUserGoal(
      "Jak je možno vylepšit finanční plán?",
    );
    const lookup = resolveAssistantUserGoal(
      "Jaký je finanční plán na rok 2026?",
    );

    assert.equal(recommendation.goal, "recommend");
    assert.equal(isAnalyticalAssistantGoal(recommendation.goal), true);
    assert.equal(answerModeForAssistantGoal(recommendation.goal), "manager_brief");
    assert.equal(lookup.goal, "lookup");
    assert.equal(isAnalyticalAssistantGoal(lookup.goal), false);
  });

  it("recognizes explain, compare, diagnose, and scenario goals", () => {
    assert.equal(resolveAssistantUserGoal("Vysvětli, jak funguje schválení.").goal, "explain");
    assert.equal(resolveAssistantUserGoal("Porovnej plán se skutečností.").goal, "compare");
    assert.equal(resolveAssistantUserGoal("Jak se liší plán od skutečnosti?").goal, "compare");
    assert.equal(resolveAssistantUserGoal("Proč je projekt zpožděný?").goal, "diagnose");
    assert.equal(resolveAssistantUserGoal("Co kdyby se rozpočet snížil o deset procent?").goal, "scenario");
    assert.equal(resolveAssistantUserGoal("Pokud bych snížil plán, jak by se změnil výsledek?").goal, "scenario");
    assert.equal(resolveAssistantUserGoal("Co mám udělat pro zlepšení plánu?").goal, "recommend");
  });

  it("enriches analytical budget facts without changing period or scope", () => {
    const state = resolveConversationQuery({
      message: "Jak je možno vylepšit finanční plán na rok 2026?",
      now: new Date("2026-08-25T08:00:00.000Z"),
    }).state;
    const enriched = queryStateForAssistantGoal(state, "recommend");

    assert.deepEqual(enriched.metrics, [
      "budget.plan_amount",
      "budget.actual_amount",
      "budget.forecast_amount",
      "budget.commitments_amount",
      "budget.variance_amount",
    ]);
    assert.equal(enriched.period.fiscal_year, 2026);
    assert.equal(enriched.granularity, state.granularity);
    assert.deepEqual(enriched.entity_filters, state.entity_filters);
  });

  it("does not broaden a lookup query", () => {
    const state = resolveConversationQuery({
      message: "Jaký je finanční plán na rok 2026?",
      now: new Date("2026-08-25T08:00:00.000Z"),
    }).state;

    assert.equal(queryStateForAssistantGoal(state, "lookup"), state);
    assert.deepEqual(state.metrics, ["budget.plan_amount"]);
  });
});
