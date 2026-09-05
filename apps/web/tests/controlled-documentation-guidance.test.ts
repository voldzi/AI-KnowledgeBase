import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { canReviewControlledDocumentation } from "../src/lib/controlled-documentation/contract";

const workbench = readFileSync(
  new URL(
    "../src/features/controlled-documentation/controlled-documentation-workbench.tsx",
    import.meta.url,
  ),
  "utf8",
);
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const page = readFileSync(
  new URL("../src/app/controlled-documentation/page.tsx", import.meta.url),
  "utf8",
);

describe("controlled documentation guidance", () => {
  it("guides the user from an approved release to verified rules", () => {
    assert.match(workbench, /Od vydání k platným pravidlům/);
    assert.match(workbench, /Navrhnout pravidla/);
    assert.match(workbench, /Ověřit návrhy/);
    assert.match(workbench, /Vyhlásit jako platné/);
    assert.match(workbench, /<PackageWorkflow progress=\{ruleProgress\} status=\{item\.status\}/);
  });

  it("shows human document names and keeps identifiers in technical details", () => {
    assert.match(workbench, /documentTitle\(member, documents\)/);
    assert.match(workbench, /\?\? member\.label/);
    assert.doesNotMatch(workbench, /<small>verze \{shortId/);
    assert.match(workbench, /<PackageTechnicalDetails item=\{item\}/);
    assert.match(workbench, /<RuleTechnicalDetails rule=\{rule\}/);
  });

  it("loads large registries on demand and renders long histories progressively", () => {
    assert.doesNotMatch(page, /registry\.listDocuments\(context\)/);
    assert.match(page, /\.filter\(\(member\) => !member\.label\)/);
    assert.match(page, /\]\.slice\(0, 50\)/);
    assert.match(workbench, /\/api\/documents\?\$\{params\.toString\(\)\}/);
    assert.match(workbench, /slice\(0, visiblePackageCount\)/);
    assert.match(workbench, /slice\(0, visibleRuleCount\)/);
    assert.match(workbench, /Zobrazit další vydání/);
    assert.match(workbench, /Zobrazit další pravidla/);
  });

  it("links every extracted rule to its cited source", () => {
    assert.match(workbench, /Otevřít citované místo/);
    assert.match(workbench, /documentCitationHref\(rule\.proposal\.citation/);
    assert.match(workbench, /origin: "controlled_documentation"/);
    assert.match(workbench, /returnTo/);
  });

  it("does not expose unverified proposals as ordinary reader data", () => {
    assert.equal(canReviewControlledDocumentation({ can_update: false, can_publish: false }), false);
    assert.equal(canReviewControlledDocumentation({ can_update: true, can_publish: false }), true);
    assert.equal(canReviewControlledDocumentation({ can_update: false, can_publish: true }), true);
    assert.match(page, /approvedOnly: !canReview/);
    assert.match(page, /includeInactive: authorization\.can_update/);
    const route = readFileSync(new URL("../src/app/api/controlled-documentation/rules/route.ts", import.meta.url), "utf8");
    assert.match(route, /registry\.getAuthorizationHints\(context\)/);
    assert.match(route, /!canReview \|\| request\.nextUrl\.searchParams\.get\("approved_only"\)/);
    assert.match(route, /authorization\.can_update && request\.nextUrl\.searchParams\.get\("include_inactive"\)/);
    assert.match(workbench, /Ověřená pravidla a limity/);
    assert.match(workbench, /odmítnuto gestorem/);
  });

  it("provides visible help and interaction feedback", () => {
    assert.match(workbench, /function WorkbenchHelpHint/);
    assert.match(
      css,
      /\.controlled-docs__member-list a:hover,[\s\S]*background:[^;}]+;[\s\S]*border-color:/,
    );
    assert.match(
      css,
      /\.controlled-docs__citation-link:hover,[\s\S]*text-decoration: underline/,
    );
  });
});
