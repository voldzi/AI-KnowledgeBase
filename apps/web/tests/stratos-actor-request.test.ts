import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  getStratosActorRequestContext,
  requireStratosActorSubjectMatch,
} from "../src/lib/stratos/actor-authorization";
import { resetAccessProjectionCacheForTests } from "../src/lib/auth/access-projection";
import { ApiClientError } from "../src/lib/types";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  resetAccessProjectionCacheForTests();
  Object.assign(process.env, {
    AKL_ENV: "test",
    AKL_API_CLIENT_MODE: "production",
    AKL_AUTH_MODE: "oidc",
    AKL_REGISTRY_API_BASE_URL: "http://registry.test/api/v1",
    AKL_INGESTION_API_BASE_URL: "http://ingestion.test/api/v1",
    AKL_RAG_API_BASE_URL: "http://rag.test/api/v1",
    AKL_GOVERNANCE_API_BASE_URL: "http://governance.test/api/v1",
    AKL_EVALUATION_API_BASE_URL: "http://evaluation.test/api/v1",
    AKL_WEB_PUBLIC_BASE_URL: "https://stratos.example/akb",
    AKL_WEB_OIDC_ISSUER: "https://login.example/realms/stratos",
    AKL_WEB_OIDC_CLIENT_ID: "akl-web",
    AKL_WEB_OIDC_CLIENT_SECRET: "test-only-secret",
    AKL_WEB_SESSION_SECRET: "test-only-session-secret-that-is-long-enough",
    AKL_WEB_STRATOS_AUTH_ME_URL: "http://stratos.test/api/v1/auth/me",
    AKL_WEB_ACCESS_PROJECTION_CACHE_TTL_MS: "0",
  });
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assert.equal(url, "http://stratos.test/api/v1/auth/me");
    assert.match(new Headers(init?.headers).get("Authorization") ?? "", /^Bearer /);
    return Response.json({
      tenantId: "org_stratos",
      applicationAccess: [{
        application: "AKB",
        capabilities: ["akb:ingest_document"],
        scopes: [],
        effectiveScopes: [{ type: "budget_scope", id: "budget:sekce-it" }],
      }],
    });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

describe("STRATOS actor authorization", () => {
  it("uses only the independent actor bearer and verifies its projected subject", async () => {
    const token = jwt({
      sub: "subject-budget-123",
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const request = new Request("https://stratos.example/akb/api/stratos/upload/preflight", {
      headers: {
        "X-STRATOS-Actor": "attacker-controlled-display-value",
        "X-STRATOS-Actor-Authorization": `Bearer ${token}`,
      },
    });

    const context = await getStratosActorRequestContext(request);
    assert.equal(context.subjectId, "subject-budget-123");
    assert.equal(context.authorizationSource, "stratos_projection");
    assert.doesNotThrow(() => requireStratosActorSubjectMatch(context, "subject-budget-123"));
    assert.throws(
      () => requireStratosActorSubjectMatch(context, "subject-budget-other"),
      (error: unknown) =>
        error instanceof ApiClientError
        && error.status === 403
        && error.code === "STRATOS_ACTOR_SUBJECT_MISMATCH",
    );
  });

  it("does not accept the plain X-STRATOS-Actor header as authority", async () => {
    const request = new Request("https://stratos.example/akb/api/stratos/upload/preflight", {
      headers: { "X-STRATOS-Actor": "subject-budget-123" },
    });

    await assert.rejects(
      () => getStratosActorRequestContext(request),
      (error: unknown) =>
        error instanceof ApiClientError
        && error.status === 401
        && error.code === "STRATOS_ACTOR_AUTH_REQUIRED",
    );
  });
});

function jwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "",
  ].join(".");
}
