import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AKB_STRATOS_APP_IDS,
  applyAkbStratosAppsVisibility,
} from "../src/lib/stratos-app-switcher";

const directoryIds = [
  ...AKB_STRATOS_APP_IDS,
  "retired-application",
  "future-unapproved-application",
];

describe("AKB STRATOS application switcher", () => {
  it("does not hide any current STRATOS destination", () => {
    const availability = applyAkbStratosAppsVisibility({}, directoryIds);

    assert.notEqual(availability["budget-contract"]?.visible, false);
    assert.notEqual(availability.projectflow?.visible, false);
    assert.notEqual(availability.akb?.visible, false);
    assert.notEqual(availability.archflow?.visible, false);
  });

  it("keeps every destination outside the current suite hidden", () => {
    const availability = applyAkbStratosAppsVisibility(
      Object.fromEntries(
        directoryIds.map((id) => [id, { access: "granted" }]),
      ),
      directoryIds,
    );
    const allowed = new Set<string>(AKB_STRATOS_APP_IDS);

    for (const id of directoryIds) {
      if (allowed.has(id)) {
        assert.notEqual(availability[id]?.visible, false);
      } else {
        assert.equal(availability[id]?.visible, false);
      }
    }
  });
});
