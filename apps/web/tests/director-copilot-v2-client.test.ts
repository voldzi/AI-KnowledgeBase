import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";

import type { AklConfig } from "../src/lib/api/config";
import type { ApiRequestContext } from "../src/lib/types";
import { DirectorCopilotTransportError } from "../src/lib/director-copilot/transport-error";
import {
  pinnedDirectorCopilotV2ManifestBundle,
  type DirectorCopilotV2Request,
} from "../src/lib/director-copilot-v2/contracts";
import { DirectorCopilotV2DomainToolClient } from "../src/lib/director-copilot-v2/domain-tool-client";
import {
  loadDirectorCopilotV2ManifestCatalog,
  pinnedDirectorCopilotV2CatalogForTests,
  resetDirectorCopilotV2ManifestCacheForTests,
} from "../src/lib/director-copilot-v2/manifest-catalog";

const projectFixture = fixture("projectflow-portfolio-delivery-overview.json");

describe("Director Copilot V2 manifest and execute client", () => {
  afterEach(() => resetDirectorCopilotV2ManifestCacheForTests());

  it("loads the exact pinned manifest subset with a target-specific service token", async () => {
    const applications: string[] = [];
    const catalog = await loadDirectorCopilotV2ManifestCatalog({
      config: config(),
      serviceToken: async (application) => {
        applications.push(application);
        return `service-${application}`;
      },
      fetcher: async (input, init) => {
        const application = applicationFromUrl(String(input));
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          `Bearer service-${application}`,
        );
        const audience = {
          budget: "budget-api",
          projectflow: "projectflow-api",
          archflow: "archflow-api",
          aiip: "aiip-api",
        }[application];
        return Response.json({
          schema_version: "director-copilot-2",
          manifests: pinnedDirectorCopilotV2ManifestBundle().manifests.filter(
            (manifest) => manifest.audience === audience,
          ),
        });
      },
    });

    assert.equal(catalog.contractRevision, "2.0.3");
    assert.equal(catalog.manifests.length, 5);
    assert.deepEqual(applications.sort(), ["aiip", "archflow", "budget", "projectflow"]);
  });

  it("sends independent credentials and the V2 contract header", async () => {
    let captured: RequestInit | undefined;
    const client = new DirectorCopilotV2DomainToolClient({
      config: config(),
      catalog: pinnedDirectorCopilotV2CatalogForTests(),
      serviceToken: async () => "service-token",
      fetcher: async (_input, init) => {
        captured = init;
        const request = JSON.parse(String(init?.body)) as DirectorCopilotV2Request;
        return Response.json({
          ...structuredClone(projectFixture.responses.complete),
          tool_call_id: request.tool_call_id,
        });
      },
    });
    const response = await client.execute(
      "projectflow",
      projectFixture.request,
      context(),
    );
    const headers = new Headers(captured?.headers);

    assert.equal(response.status, "complete");
    assert.equal(headers.get("authorization"), "Bearer service-token");
    assert.equal(headers.get("x-stratos-actor-authorization"), "Bearer actor-token");
    assert.equal(headers.get("x-akb-domain-tool-contract"), "director-copilot-2");
    assert.equal(headers.has("x-stratos-capabilities"), false);
    assert.equal(headers.has("x-stratos-scopes"), false);
  });

  it("rejects runtime manifest drift before any execute request", async () => {
    await assert.rejects(
      () => loadDirectorCopilotV2ManifestCatalog({
        config: config(),
        force: true,
        serviceToken: async (application) => `service-${application}`,
        fetcher: async (input) => {
          const application = applicationFromUrl(String(input));
          const audience = {
            budget: "budget-api",
            projectflow: "projectflow-api",
            archflow: "archflow-api",
            aiip: "aiip-api",
          }[application];
          const manifests = pinnedDirectorCopilotV2ManifestBundle().manifests
            .filter((manifest) => manifest.audience === audience);
          if (application === "projectflow") {
            manifests[0]!.schema_revision = "projectflow-drifted";
          }
          return Response.json({
            schema_version: "director-copilot-2",
            manifests,
          });
        },
      }),
      /differs from the pinned contract/,
    );
  });

  it("reports only safe schema diagnostics when a source response violates the contract", async () => {
    const originalConsoleError = console.error;
    const records: string[] = [];
    console.error = (value?: unknown) => {
      records.push(String(value ?? ""));
    };
    try {
      const invalidResponse = structuredClone(projectFixture.responses.complete);
      invalidResponse.items[0].facts[0].quality = 2;
      const client = new DirectorCopilotV2DomainToolClient({
        config: config(),
        catalog: pinnedDirectorCopilotV2CatalogForTests(),
        serviceToken: async () => "service-token",
        fetcher: async (_input, init) => {
          const request = JSON.parse(String(init?.body)) as DirectorCopilotV2Request;
          return Response.json({
            ...invalidResponse,
            tool_call_id: request.tool_call_id,
          });
        },
      });

      await assert.rejects(
        () => client.execute(
          "projectflow",
          projectFixture.request,
          context(),
        ),
        (error: unknown) => {
          assert.ok(error instanceof DirectorCopilotTransportError);
          assert.equal(error.code, "DIRECTOR_COPILOT_V2_SOURCE_CONTRACT_INVALID");
          assert.equal(error.diagnosticCode, "DIRECTOR_COPILOT_V2_RESPONSE_INVALID");
          assert.deepEqual(error.diagnosticPaths, ["/items/0/facts/0/quality:maximum"]);
          return true;
        },
      );

      assert.equal(records.length, 1);
      const log = JSON.parse(records[0]!) as Record<string, unknown>;
      assert.equal(log.error_code, "DIRECTOR_COPILOT_V2_SOURCE_CONTRACT_INVALID");
      assert.equal(log.diagnostic_code, "DIRECTOR_COPILOT_V2_RESPONSE_INVALID");
      assert.deepEqual(log.diagnostic_paths, ["/items/0/facts/0/quality:maximum"]);
      assert.equal(records[0]!.includes('"quality":2'), false);
    } finally {
      console.error = originalConsoleError;
    }
  });
});

function applicationFromUrl(
  url: string,
): "budget" | "projectflow" | "archflow" | "aiip" {
  if (url.includes("projectflow")) return "projectflow";
  if (url.includes("archflow")) return "archflow";
  if (url.includes("aiip")) return "aiip";
  return "budget";
}

function fixture(name: string): {
  request: DirectorCopilotV2Request;
  responses: Record<string, any>;
} {
  return JSON.parse(readFileSync(
    new URL(`./fixtures/director-copilot-v2/${name}`, import.meta.url),
    "utf8",
  )) as {
    request: DirectorCopilotV2Request;
    responses: Record<string, any>;
  };
}

function context(): ApiRequestContext {
  return {
    subjectId: "fixture-subject",
    authorizationSource: "stratos_projection",
    accessToken: "actor-token",
    requestId: "request-v2",
    correlationId: "correlation-v2",
  };
}

function config(): AklConfig {
  return {
    environment: "test",
    apiClientMode: "mock",
    authMode: "mock",
    serviceBaseUrls: {
      registry: "mock://registry",
      ingestion: "mock://ingestion",
      rag: "mock://rag",
      governance: "mock://governance",
      evaluation: "mock://evaluation",
    },
    directorCopilot: {
      enabled: true,
      v2ManifestCacheTtlMs: 300_000,
      clientId: "svc-akb-director-copilot",
      budgetBaseUrl: "https://budget.example",
      projectflowBaseUrl: "https://projectflow.example",
      archflowBaseUrl: "https://archflow.example",
      aiipBaseUrl: "https://aiip.example",
      timeoutMs: 1_000,
      maxResponseBytes: 262_144,
    },
  };
}
