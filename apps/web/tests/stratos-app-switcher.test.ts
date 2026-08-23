import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyAkbStratosAppsVisibility } from "../src/lib/stratos-app-switcher";

describe("AKB STRATOS application switcher", () => {
  it("does not hide any current STRATOS destination", () => {
    const availability = applyAkbStratosAppsVisibility({});

    assert.notEqual(availability["budget-contract"]?.visible, false);
    assert.notEqual(availability.projectflow?.visible, false);
    assert.notEqual(availability.archflow?.visible, false);
  });

  it("keeps retired applications hidden even when access is projected", () => {
    const availability = applyAkbStratosAppsVisibility({
      "security-preflight": { access: "granted" },
      aiip: { access: "granted" },
      processforge: { access: "granted" },
    });

    assert.equal(availability["security-preflight"]?.visible, false);
    assert.equal(availability.aiip?.visible, false);
    assert.equal(availability.processforge?.visible, false);
  });
});
