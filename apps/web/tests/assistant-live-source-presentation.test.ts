import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assistantLiveSourceApplicationLabel,
  assistantLiveSources,
  assistantLiveSourceStatusLabel,
} from "../src/lib/assistant/live-source-presentation";

describe("assistant live source presentation", () => {
  it("presents authorized Director Copilot outcomes without business payloads", () => {
    const sources = assistantLiveSources({
      director_copilot_v2_snapshot: {
        outcomes: [{
          application: "budget",
          status: "complete",
          as_of: "2026-08-03T08:00:00.000Z",
          generated_at: "2026-08-03T08:00:01.000Z",
          items: [{ title: "Must not leave the snapshot parser" }],
        }],
      },
    });

    assert.deepEqual(sources, [{
      application: "budget",
      status: "complete",
      as_of: "2026-08-03T08:00:00.000Z",
      generated_at: "2026-08-03T08:00:01.000Z",
      item_count: 1,
    }]);
    assert.equal(assistantLiveSourceApplicationLabel(sources[0]!), "Budget");
    assert.equal(assistantLiveSourceStatusLabel(sources[0]!, "cs"), "Aktuální data");
  });

  it("loads the same compact presentation from persisted history metadata", () => {
    const sources = assistantLiveSources({
      live_sources: [{
        application: "projectflow",
        status: "partial",
        as_of: null,
        generated_at: "2026-08-03T08:00:01.000Z",
        item_count: 3,
        ignored_business_value: "secret",
      }],
    });

    assert.deepEqual(sources, [{
      application: "projectflow",
      status: "partial",
      as_of: null,
      generated_at: "2026-08-03T08:00:01.000Z",
      item_count: 3,
    }]);
  });

  it("ignores unknown applications and statuses fail closed", () => {
    assert.deepEqual(assistantLiveSources({
      live_sources: [
        { application: "servicedesk", status: "complete" },
        { application: "budget", status: "invented" },
      ],
    }), []);
  });
});
