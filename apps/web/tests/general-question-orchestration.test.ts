import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { routeAssistantMessage } from "../src/lib/assistant/assistant-tool-router";
import { queryStateForAssistantGoal } from "../src/lib/assistant/user-goal";
import { resolveConversationQuery } from "../src/lib/director-copilot/query-state";
import { classifyDirectorCopilotV2Intent } from "../src/lib/director-copilot-v2/intent-router";

describe("general question orchestration", () => {
  it("plans the reported financial-improvement question as governed mixed evidence", () => {
    const message = "Jak je možno vylepšit finanční plán?";
    const route = routeAssistantMessage(message, "cs");
    const query = resolveConversationQuery({
      message,
      now: new Date("2026-08-25T08:00:00.000Z"),
    });
    const enriched = queryStateForAssistantGoal(query.state, route.queryPlan.goal);

    assert.equal(route.queryPlan.goal, "recommend");
    assert.equal(route.queryPlan.intent, "recommendation");
    assert.equal(classifyDirectorCopilotV2Intent(message), "budget_portfolio_status");
    assert.deepEqual(enriched.sources, ["budget"]);
    assert.deepEqual(enriched.metrics, [
      "budget.plan_amount",
      "budget.actual_amount",
      "budget.forecast_amount",
      "budget.commitments_amount",
      "budget.variance_amount",
    ]);
  });

  it("keeps the reported year-specific question as a narrow factual lookup", () => {
    const message = "Jaký je finanční plán na rok 2026?";
    const route = routeAssistantMessage(message, "cs");
    const query = resolveConversationQuery({
      message,
      now: new Date("2026-08-25T08:00:00.000Z"),
    });
    const planned = queryStateForAssistantGoal(query.state, route.queryPlan.goal);

    assert.equal(route.queryPlan.goal, "lookup");
    assert.equal(classifyDirectorCopilotV2Intent(message), "budget_portfolio_status");
    assert.equal(planned.period.fiscal_year, 2026);
    assert.deepEqual(planned.metrics, ["budget.plan_amount"]);
  });
});
