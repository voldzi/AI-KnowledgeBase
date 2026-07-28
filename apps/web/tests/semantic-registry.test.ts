import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyDirectorCopilotV2Intent } from "../src/lib/director-copilot-v2/intent-router";
import {
  normalizeSemanticText,
  semanticSourcesForText,
} from "../src/lib/director-copilot/semantic-catalog";
import {
  semanticRegistryMatches,
  semanticRegistryStatus,
} from "../src/lib/director-copilot/semantic-registry";

describe("local SSP semantic registry", () => {
  it("loads a complete versioned snapshot with approved bindings", () => {
    const status = semanticRegistryStatus();

    assert.equal(status.schema_version, "stratos-semantic-registry-snapshot-1");
    assert.match(status.snapshot_id, /^ssp-cz-[a-f0-9]{16}$/);
    assert.ok(status.concept_count >= 5_000);
    assert.equal(status.binding_count, 6);
    assert.match(status.content_sha256, /^[a-f0-9]{64}$/);
  });

  it("uses only approved SSP concepts to enrich STRATOS source routing", () => {
    const message = normalizeSemanticText(
      "Jaká je ekonomická a personální náročnost projektu?",
    );
    const matches = semanticRegistryMatches(message);

    assert.equal(matches.length, 1);
    assert.deepEqual(
      matches[0]?.targets,
      [
        { kind: "source", id: "budget" },
        { kind: "source", id: "projectflow" },
      ],
    );
    assert.deepEqual(semanticSourcesForText(message), ["projectflow", "budget"]);
    assert.equal(
      classifyDirectorCopilotV2Intent(
        "Jaká je ekonomická a personální náročnost projektu?",
      ),
      "portfolio_performance_overview",
    );
  });

  it("does not activate a bound concept on a partial word", () => {
    assert.deepEqual(semanticRegistryMatches("projektant upravil vykres"), []);
  });
});
