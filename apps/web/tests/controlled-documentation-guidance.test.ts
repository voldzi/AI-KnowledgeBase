import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const workbench = readFileSync(
  new URL(
    "../src/features/controlled-documentation/controlled-documentation-workbench.tsx",
    import.meta.url,
  ),
  "utf8",
);
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

describe("controlled documentation guidance", () => {
  it("guides the user from an approved release to verified rules", () => {
    assert.match(workbench, /Od vydání k platným pravidlům/);
    assert.match(workbench, /Navrhnout pravidla/);
    assert.match(workbench, /Ověřit návrhy/);
    assert.match(workbench, /Vyhlásit jako platné/);
    assert.match(workbench, /<PackageWorkflow progress=\{ruleProgress\} status=\{item\.status\}/);
  });

  it("shows human document names and keeps identifiers in technical details", () => {
    assert.match(workbench, /documentTitle\(member\.document_id, documents\)/);
    assert.doesNotMatch(workbench, /<small>verze \{shortId/);
    assert.match(workbench, /<PackageTechnicalDetails item=\{item\}/);
    assert.match(workbench, /<RuleTechnicalDetails rule=\{rule\}/);
  });

  it("links every extracted rule to its cited source", () => {
    assert.match(workbench, /Otevřít citované místo/);
    assert.match(workbench, /tab=viewer&chunk_id=/);
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
