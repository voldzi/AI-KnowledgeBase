import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const detail = readFileSync(
  new URL("../src/features/documents/document-detail.tsx", import.meta.url),
  "utf8",
);

describe("guided document detail", () => {
  it("keeps five human workflow steps separate from technical views", () => {
    for (const tab of ["overview", "viewer", "insights", "checks", "workflow"]) {
      assert.match(detail, new RegExp(`tab: "${tab}" as const`));
    }
    assert.match(detail, /copy\.moreInformationDetail/);
    assert.doesNotMatch(detail, /<StratosViewTabs/);
  });

  it("renders controlled packages, attachments and verified rules", () => {
    assert.match(detail, /<ControlledPackageRelations/);
    assert.match(detail, /<ControlledRuleCard/);
    assert.match(detail, /copy\.controlledConsumerEligible/);
    assert.match(detail, /api\/controlled-documentation\/extract/);
  });

  it("keeps identifiers and file fingerprints in collapsed technical details", () => {
    assert.match(
      detail,
      /<details className="technical-details technical-details--compact">[\s\S]*copy\.sourceHash[\s\S]*<\/details>/,
    );
    assert.match(detail, /copy\.technicalDetailsHint/);
  });

  it("provides visible hover, focus and mobile step navigation", () => {
    assert.match(
      css,
      /\.document-guide__step:hover\s*\{[^}]*background:[^}]*box-shadow:/s,
    );
    assert.match(
      css,
      /\.document-guide__step:focus-visible\s*\{[^}]*outline:/s,
    );
    assert.match(
      css,
      /@media \(max-width: 680px\)[\s\S]*\.document-guide__steps\s*\{[^}]*display:\s*flex;[^}]*overflow-x:\s*auto;/s,
    );
  });
});
