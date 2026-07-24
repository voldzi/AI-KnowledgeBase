import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { AklConfig } from "../src/lib/api/config";
import { DOMAIN_TOOL_IDS, type DomainToolRequest } from "../src/lib/director-copilot/contracts";
import { DirectorDomainToolClient } from "../src/lib/director-copilot/domain-tool-client";
import { DirectorCopilotTransportError } from "../src/lib/director-copilot/transport-error";
import type { ApiRequestContext } from "../src/lib/types";

const fixture = JSON.parse(readFileSync(
  new URL("../../../contracts/director-copilot/v1/fixtures/budget-complete.json", import.meta.url),
  "utf8",
)) as Record<string, unknown>;

describe("Director Copilot domain client", () => {
  it("sends independent service and actor credentials without capability headers", async () => {
    let captured: RequestInit | undefined;
    const client = new DirectorDomainToolClient({
      config: config(),
      serviceToken: async () => "service-token",
      fetcher: async (_input, init) => {
        captured = init;
        return Response.json({ ...fixture, tool_call_id: "call_aaaaaaaaaaaaaaaa" });
      },
    });

    const response = await client.execute("budget", request(), context());
    const headers = new Headers(captured?.headers);

    assert.equal(response.status, "complete");
    assert.equal(headers.get("authorization"), "Bearer service-token");
    assert.equal(headers.get("x-stratos-actor-authorization"), "Bearer actor-token");
    assert.equal(headers.has("x-stratos-capabilities"), false);
    assert.equal(headers.has("x-stratos-scopes"), false);
    assert.equal(headers.get("idempotency-key"), "call_aaaaaaaaaaaaaaaa");
  });

  it("rejects shared service and actor credentials", async () => {
    const client = new DirectorDomainToolClient({
      config: config(),
      serviceToken: async () => "actor-token",
      fetcher: async () => Response.json(fixture),
    });

    await assert.rejects(
      () => client.execute("budget", request(), context()),
      (error: unknown) => error instanceof DirectorCopilotTransportError
        && error.code === "DIRECTOR_COPILOT_TOKEN_SEPARATION_REQUIRED",
    );
  });

  it("maps a source contract violation to a bounded transport error", async () => {
    const invalid = structuredClone(fixture);
    invalid.debug = "must not cross the boundary";
    const client = new DirectorDomainToolClient({
      config: config(),
      serviceToken: async () => "service-token",
      fetcher: async () => Response.json({ ...invalid, tool_call_id: "call_aaaaaaaaaaaaaaaa" }),
    });

    await assert.rejects(
      () => client.execute("budget", request(), context()),
      (error: unknown) => error instanceof DirectorCopilotTransportError
        && error.code === "DIRECTOR_COPILOT_SOURCE_CONTRACT_INVALID",
    );
  });

  it("preserves a bounded upstream authorization reason code", async () => {
    const client = new DirectorDomainToolClient({
      config: config(),
      serviceToken: async () => "service-token",
      fetcher: async () => Response.json(
        { error: "PROJECTFLOW_LOCAL_MEMBERSHIP_REQUIRED", message: "detail is not propagated" },
        { status: 403 },
      ),
    });

    await assert.rejects(
      () => client.execute("projectflow", { ...request(), tool_id: DOMAIN_TOOL_IDS.projectflow }, context()),
      (error: unknown) => error instanceof DirectorCopilotTransportError
        && error.code === "PROJECTFLOW_LOCAL_MEMBERSHIP_REQUIRED"
        && error.outcome === "not_authorized"
        && error.status === 403,
    );
  });

  it("maps an unavailable upstream to a non-authorization outcome", async () => {
    const client = new DirectorDomainToolClient({
      config: config(),
      serviceToken: async () => "service-token",
      fetcher: async () => Response.json(
        { error: "PROJECTFLOW_DOMAIN_TOOL_UNAVAILABLE", message: "temporary outage" },
        { status: 503 },
      ),
    });

    await assert.rejects(
      () => client.execute("projectflow", { ...request(), tool_id: DOMAIN_TOOL_IDS.projectflow }, context()),
      (error: unknown) => error instanceof DirectorCopilotTransportError
        && error.code === "PROJECTFLOW_DOMAIN_TOOL_UNAVAILABLE"
        && error.outcome === "unavailable"
        && error.status === 503,
    );
  });

  it("cancels a chunked source response as soon as it exceeds the byte limit", async () => {
    const limitedConfig = config();
    limitedConfig.directorCopilot!.maxResponseBytes = 8;
    let cancelled = false;
    const client = new DirectorDomainToolClient({
      config: limitedConfig,
      serviceToken: async () => "service-token",
      fetcher: async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("12345678"));
          controller.enqueue(new TextEncoder().encode("9"));
        },
        cancel() {
          cancelled = true;
        },
      }), { headers: { "content-type": "application/json" } }),
    });

    await assert.rejects(
      () => client.execute("budget", request(), context()),
      (error: unknown) => error instanceof DirectorCopilotTransportError
        && error.code === "DIRECTOR_COPILOT_SOURCE_RESPONSE_TOO_LARGE",
    );
    assert.equal(cancelled, true);
  });
});

function request(): DomainToolRequest {
  return {
    schema_version: "director-copilot-1",
    tool_id: DOMAIN_TOOL_IDS.budget,
    tool_call_id: "call_aaaaaaaaaaaaaaaa",
    plan_id: "plan_bbbbbbbbbbbbbbbb",
    organization_id: "org_stratos",
    actor: { type: "person", subject_id: "user-001" },
    requested_at: "2026-07-21T10:00:00Z",
    requested_scopes: [{ type: "project", id: "project-001" }],
    parameters: { as_of: "2026-07-21T10:00:00Z", limit: 100 },
  };
}

function context(): ApiRequestContext {
  return {
    subjectId: "user-001",
    authorizationSource: "stratos_projection",
    accessToken: "actor-token",
    requestId: "request-001",
    correlationId: "correlation-001",
  };
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
      clientId: "svc-akb-director-copilot",
      budgetBaseUrl: "https://budget.example",
      projectflowBaseUrl: "https://project.example",
      timeoutMs: 1_000,
      maxResponseBytes: 262_144,
    },
  };
}
