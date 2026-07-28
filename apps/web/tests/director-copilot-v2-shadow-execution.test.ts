import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scheduleIndependentShadowExecution } from "../src/lib/director-copilot-v2/shadow-execution";

describe("Director Copilot V2 shadow execution", () => {
  it("starts immediately and only delegates completion to the background scheduler", async () => {
    let started = false;
    let complete: (() => void) | undefined;
    let scheduledTask: (() => Promise<void>) | undefined;
    const execution = new Promise<void>((resolve) => {
      complete = resolve;
    });

    scheduleIndependentShadowExecution({
      execute: () => {
        started = true;
        return execution;
      },
      onFailure: async () => undefined,
      schedule: (task) => {
        scheduledTask = task;
      },
    });

    assert.equal(started, true);
    assert.ok(scheduledTask);
    complete?.();
    await scheduledTask();
  });

  it("records a shadow failure without rejecting the scheduled task", async () => {
    const failure = new Error("shadow source unavailable");
    let recorded: unknown;
    let scheduledTask: (() => Promise<void>) | undefined;

    scheduleIndependentShadowExecution({
      execute: async () => {
        throw failure;
      },
      onFailure: async (error) => {
        recorded = error;
      },
      schedule: (task) => {
        scheduledTask = task;
      },
    });

    assert.ok(scheduledTask);
    await scheduledTask();
    assert.equal(recorded, failure);
  });
});
