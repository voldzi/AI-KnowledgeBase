import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { classifyDirectorCopilotV2Intent } from "../src/lib/director-copilot-v2/intent-router";
import {
  resolveConversationQuery,
  type ConversationQueryState,
} from "../src/lib/director-copilot/query-state";

interface EvalTurn {
  message: string;
  sources: string[];
  metrics: string[];
  pending_sources?: string[];
  recognized?: boolean;
  intent: string | null;
  fiscal_year?: number;
  granularity?: string;
}

interface EvalCase {
  id: string;
  turns: EvalTurn[];
}

const dataset = JSON.parse(readFileSync(
  new URL("./fixtures/director-copilot-czech-routing-eval.json", import.meta.url),
  "utf8",
)) as { schema_version: string; cases: EvalCase[] };

describe("Director Copilot Czech routing evaluation", () => {
  it("keeps the dataset versioned, bounded and sufficiently broad", () => {
    assert.equal(dataset.schema_version, "director-copilot-czech-routing-eval-1");
    assert.ok(dataset.cases.length >= 20);
    assert.equal(new Set(dataset.cases.map((item) => item.id)).size, dataset.cases.length);
  });

  for (const evalCase of dataset.cases) {
    it(evalCase.id, () => {
      let previous: ConversationQueryState | null = null;
      for (const turn of evalCase.turns) {
        const context: Record<string, unknown> = previous
          ? { stratos_query_state: previous }
          : {};
        const resolved = resolveConversationQuery({
          message: turn.message,
          context,
          now: new Date("2026-07-25T12:00:00Z"),
        });
        assert.deepEqual(
          [...resolved.state.sources].sort(),
          [...turn.sources].sort(),
          `${evalCase.id}: sources`,
        );
        assert.deepEqual(
          [...resolved.state.metrics].sort(),
          [...turn.metrics].sort(),
          `${evalCase.id}: metrics`,
        );
        assert.deepEqual(
          [...resolved.pending_sources].sort(),
          [...(turn.pending_sources ?? [])].sort(),
          `${evalCase.id}: pending sources`,
        );
        assert.equal(
          resolved.recognized,
          turn.recognized ?? true,
          `${evalCase.id}: recognized`,
        );
        assert.equal(
          classifyDirectorCopilotV2Intent(turn.message, context),
          turn.intent,
          `${evalCase.id}: intent`,
        );
        if (turn.fiscal_year !== undefined) {
          assert.equal(resolved.state.period.fiscal_year, turn.fiscal_year);
        }
        if (turn.granularity !== undefined) {
          assert.equal(resolved.state.granularity, turn.granularity);
        }
        previous = resolved.state;
      }
    });
  }
});
