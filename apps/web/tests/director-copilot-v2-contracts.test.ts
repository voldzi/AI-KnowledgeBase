import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  assertDirectorCopilotV2Request,
  parseDirectorCopilotV2Error,
  parseDirectorCopilotV2Response,
  pinnedDirectorCopilotV2Manifest,
  pinnedDirectorCopilotV2ManifestBundle,
  type DirectorCopilotV2ToolId,
} from "../src/lib/director-copilot-v2/contracts";

const FIXTURES = [
  "aiip-idea-portfolio-overview.json",
  "archflow-need-portfolio-overview.json",
  "budget-organization-financial-summary.json",
  "budget-project-financial-snapshot.json",
  "projectflow-portfolio-delivery-overview.json",
];

describe("Director Copilot V2 pinned contracts", () => {
  it("validates every source fixture and all closed error envelopes", () => {
    assert.equal(pinnedDirectorCopilotV2ManifestBundle().manifests.length, 5);
    for (const name of FIXTURES) {
      const fixture = readFixture(name);
      const toolId = fixture.tool_id as DirectorCopilotV2ToolId;
      const manifest = pinnedDirectorCopilotV2Manifest(toolId);
      assertDirectorCopilotV2Request(fixture.request);
      for (const response of Object.values(fixture.responses)) {
        assert.equal(
          parseDirectorCopilotV2Response(response, {
            manifest,
            toolCallId: fixture.request.tool_call_id,
            nowMs: Date.parse("2026-07-25T10:01:00.000Z"),
          }).tool_id,
          toolId,
        );
      }
      for (const [status, envelope] of Object.entries(fixture.errors)) {
        assert.equal(
          parseDirectorCopilotV2Error(envelope, {
            status: Number(status),
            manifest,
            toolCallId: fixture.request.tool_call_id,
          }).http_status,
          Number(status),
        );
      }
    }
  });

  it("fails closed for unknown facts, links and reason codes", () => {
    const fixture = readFixture("projectflow-portfolio-delivery-overview.json");
    const manifest = pinnedDirectorCopilotV2Manifest(fixture.tool_id as DirectorCopilotV2ToolId);
    const unknownFact = structuredClone(fixture.responses.complete);
    unknownFact.items[0].facts[0].key = "project.secret_internal_metric";
    assert.throws(
      () => parseDirectorCopilotV2Response(unknownFact, {
        manifest,
        toolCallId: fixture.request.tool_call_id,
        nowMs: Date.parse("2026-07-25T10:01:00.000Z"),
      }),
      /Unknown or incompatible fact/,
    );

    const unknownLink = structuredClone(fixture.responses.complete);
    unknownLink.items[0].links[0].key = "projectflow.project.unknown";
    assert.throws(
      () => parseDirectorCopilotV2Response(unknownLink, {
        manifest,
        toolCallId: fixture.request.tool_call_id,
        nowMs: Date.parse("2026-07-25T10:01:00.000Z"),
      }),
      /Unknown or incompatible link/,
    );

    const unknownReason = structuredClone(fixture.responses.complete);
    unknownReason.warnings = ["PROJECTFLOW_UNKNOWN_REASON"];
    assert.throws(
      () => parseDirectorCopilotV2Response(unknownReason, {
        manifest,
        toolCallId: fixture.request.tool_call_id,
        nowMs: Date.parse("2026-07-25T10:01:00.000Z"),
      }),
      /Unknown reason code/,
    );
  });

  it("fails closed for broken policy lineage and unsafe deep links", () => {
    const fixture = readFixture("projectflow-portfolio-delivery-overview.json");
    const manifest = pinnedDirectorCopilotV2Manifest(fixture.tool_id as DirectorCopilotV2ToolId);
    const brokenLineage = structuredClone(fixture.responses.complete);
    brokenLineage.items[0].policy_lineage[0].hash =
      `sha256:${"f".repeat(64)}`;
    assert.throws(
      () => parseDirectorCopilotV2Response(brokenLineage, {
        manifest,
        toolCallId: fixture.request.tool_call_id,
        nowMs: Date.parse("2026-07-25T10:01:00.000Z"),
      }),
      /does not bind its policy/,
    );

    const unsafeLink = structuredClone(fixture.responses.complete);
    unsafeLink.items[0].deep_link = "javascript:alert(1)";
    assert.throws(
      () => parseDirectorCopilotV2Response(unsafeLink, {
        manifest,
        toolCallId: fixture.request.tool_call_id,
        nowMs: Date.parse("2026-07-25T10:01:00.000Z"),
      }),
      /deep_link|safe HTTPS deep link/,
    );
  });
});

interface Fixture {
  tool_id: string;
  request: {
    tool_call_id: string;
    [key: string]: unknown;
  };
  responses: Record<string, any>;
  errors: Record<string, any>;
}

function readFixture(name: string): Fixture {
  return JSON.parse(readFileSync(
    new URL(`./fixtures/director-copilot-v2/${name}`, import.meta.url),
    "utf8",
  )) as Fixture;
}
