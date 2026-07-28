import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { AklConfig } from "../src/lib/api/config";
import {
  DIRECTOR_COPILOT_AUDIT_TARGET,
  directorCopilotServiceToken,
  resetDirectorCopilotServiceTokenCacheForTests,
} from "../src/lib/director-copilot/service-identity";
import { DirectorCopilotTransportError } from "../src/lib/director-copilot/transport-error";
import { DIRECTOR_COPILOT_V2_TARGETS } from "../src/lib/director-copilot-v2/manifest-catalog";

describe("Director Copilot V2 service identity", () => {
  afterEach(() => resetDirectorCopilotServiceTokenCacheForTests());

  it("requests and caches a separate exact-audience token for every source", async () => {
    const scopes: string[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      const body = new URLSearchParams(String(init?.body));
      const scope = body.get("scope") ?? "";
      scopes.push(scope);
      const audience = scope.replace("director-copilot-", "");
      return Response.json({
        access_token: jwt({ aud: audience }),
        expires_in: 300,
      });
    };

    const budget = await directorCopilotServiceToken(
      config(),
      fetcher,
      DIRECTOR_COPILOT_V2_TARGETS.budget,
    );
    const projectflow = await directorCopilotServiceToken(
      config(),
      fetcher,
      DIRECTOR_COPILOT_V2_TARGETS.projectflow,
    );
    const audit = await directorCopilotServiceToken(
      config(),
      fetcher,
      DIRECTOR_COPILOT_AUDIT_TARGET,
    );
    const budgetCached = await directorCopilotServiceToken(
      config(),
      fetcher,
      DIRECTOR_COPILOT_V2_TARGETS.budget,
    );

    assert.notEqual(budget, projectflow);
    assert.notEqual(audit, budget);
    assert.equal(budgetCached, budget);
    assert.deepEqual(scopes, [
      "director-copilot-budget-api",
      "director-copilot-projectflow-api",
      "director-copilot-akl-api",
    ]);
  });

  it("rejects a multi-audience token before it reaches a source", async () => {
    await assert.rejects(
      () => directorCopilotServiceToken(
        config(),
        async () => Response.json({
          access_token: jwt({ aud: ["budget-api", "projectflow-api"] }),
          expires_in: 300,
        }),
        DIRECTOR_COPILOT_V2_TARGETS.budget,
      ),
      (error: unknown) => error instanceof DirectorCopilotTransportError
        && error.code === "DIRECTOR_COPILOT_TRANSPORT_AUDIENCE_INVALID",
    );
  });
});

function jwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}

function config(): AklConfig {
  return {
    environment: "test",
    apiClientMode: "mock",
    authMode: "oidc",
    serviceBaseUrls: {
      registry: "http://registry",
      ingestion: "http://ingestion",
      rag: "http://rag",
      governance: "http://governance",
      evaluation: "http://evaluation",
    },
    directorCopilot: {
      enabled: true,
      v2ManifestCacheTtlMs: 300_000,
      tokenUrl: "https://identity.example/token",
      clientId: "svc-akb-director-copilot",
      clientSecret: "test-secret",
      budgetBaseUrl: "https://budget.example",
      projectflowBaseUrl: "https://projectflow.example",
      archflowBaseUrl: "https://archflow.example",
      aiipBaseUrl: "https://aiip.example",
      timeoutMs: 1_000,
      maxResponseBytes: 262_144,
    },
  };
}
