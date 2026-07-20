import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";

import { NextRequest } from "next/server";

import {
  authenticateAiipDocumentServiceJsonRequest,
  authenticateAiipServiceJsonRequest,
  authenticateStratosDocumentServiceJsonRequest,
  authenticateStratosDocumentServiceRequest,
  requireStratosDocumentSourceAllowed,
  handleAiipApplicationRequest
} from "../src/lib/aiip/application-api";
import { ApiClientError } from "../src/lib/types";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

type FetchState = {
  upstreamCalls: number;
  replay: boolean;
  roles: string[];
  audience: string[];
  active: boolean;
  clientId: string;
};

let state: FetchState;

function request(
  body: Record<string, unknown>,
  options: { token?: string; headers?: Record<string, string> } = {},
): NextRequest {
  return new NextRequest("https://stratos.example/akb/api/integrations/aiip/v1/harmonize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.token ?? "valid-token"}`,
      "Content-Type": "application/json",
      "X-Request-ID": "req-aiip-test-0001",
      "X-Correlation-ID": "corr-aiip-test-0001",
      "Idempotency-Key": "idem-aiip-test-0001",
      ...options.headers,
    },
    body: JSON.stringify(body),
  });
}

function harmonizeBody(classification = "internal"): Record<string, unknown> {
  return {
    schema_version: "1.0",
    tenant_id: "tenant-test",
    classification,
    record: {
      external_ref: "aiip:idea:test",
      title: "Automatizace kontroly podkladů",
      description: "Kontrola úplnosti podkladů před schválením.",
    },
  };
}

beforeEach(() => {
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
  });
  state = {
    upstreamCalls: 0,
    replay: false,
    roles: ["service_aiip"],
    audience: ["akb-api"],
    active: true,
    clientId: "aiip-service",
  };
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/protocol/openid-connect/token/introspect")) {
      const token = init?.body instanceof URLSearchParams ? init.body.get("token") : "unknown";
      return Response.json({
        active: state.active,
        client_id: state.clientId,
        azp: state.clientId,
        sub: `service-subject-${token}`,
        preferred_username: `service-account-${state.clientId}`,
        aud: state.audience,
        realm_access: { roles: state.roles },
      });
    }
    assert.equal(url, "http://rag.test/api/v1/integrations/aiip/harmonize");
    state.upstreamCalls += 1;
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("X-AKL-Subject"), null);
    assert.equal(headers.get("X-AKL-Roles"), null);
    assert.equal(headers.get("X-STRATOS-Capabilities"), null);
    return Response.json(
      {
        schema_version: "1.0",
        request_id: headers.get("X-Request-ID"),
        correlation_id: headers.get("X-Correlation-ID"),
        result: { suggestions: [] },
      },
      { headers: state.replay ? { "Idempotency-Replayed": "true" } : undefined },
    );
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

describe("AIIP application API bridge", () => {
  it("authenticates before reading and bounds governed upload JSON", async () => {
    const valid = await authenticateAiipServiceJsonRequest(request({ external_ref: "aiip:test" }));
    assert.equal(valid.principal.roles[0], "service_aiip");
    assert.equal(valid.body.external_ref, "aiip:test");

    await assert.rejects(
      () =>
        authenticateAiipServiceJsonRequest(
          request(
            { external_ref: "aiip:test" },
            { token: "oversized-json-token", headers: { "Content-Length": "65537" } }
          )
        ),
      (error: unknown) =>
        error instanceof ApiClientError &&
        error.status === 413 &&
        error.code === "PAYLOAD_TOO_LARGE"
    );
  });

  it("keeps the document transport identity separate from AI assistance", async () => {
    state.clientId = "aiip-document-service";
    state.roles = ["service_aiip_document"];
    state.audience = ["akl-api"];

    const valid = await authenticateAiipDocumentServiceJsonRequest(
      request({ external_ref: "aiip:test" }, { token: "document-transport-token" }),
    );
    assert.equal(valid.principal.roles[0], "service_aiip_document");
    assert.equal(valid.body.external_ref, "aiip:test");

    state.roles = ["service_aiip"];
    await assert.rejects(
      () =>
        authenticateAiipDocumentServiceJsonRequest(
          request({ external_ref: "aiip:test" }, { token: "wrong-document-role" }),
        ),
      (error: unknown) =>
        error instanceof ApiClientError &&
        error.status === 403 &&
        error.code === "AUTH_ROLE_REQUIRED",
    );

    state.roles = ["service_aiip_document"];
    state.audience = ["akb-api"];
    await assert.rejects(
      () =>
        authenticateAiipDocumentServiceJsonRequest(
          request({ external_ref: "aiip:test" }, { token: "wrong-document-audience" }),
        ),
      (error: unknown) =>
        error instanceof ApiClientError &&
        error.status === 403 &&
        error.code === "AUTH_AUDIENCE_INVALID",
    );

    state.clientId = "aiip-service";
    state.roles = ["service_aiip"];
    state.audience = ["akb-api"];
    await assert.rejects(
      () =>
        authenticateAiipDocumentServiceJsonRequest(
          request({ external_ref: "aiip:test" }, { token: "assistance-token" }),
        ),
      (error: unknown) =>
        error instanceof ApiClientError &&
        error.status === 403 &&
        error.code === "AUTH_FORBIDDEN",
    );
  });

  it("binds the Budget document bridge to its exact service identity and source", async () => {
    state.clientId = "stratos-akb-service";
    state.roles = ["service_ingestion"];
    state.audience = ["akl-api"];

    const valid = await authenticateStratosDocumentServiceJsonRequest(
      request({ external_system: "STRATOS_BUDGET" }, { token: "budget-document-token" }),
    );
    assert.equal(valid.principal.clientId, "stratos-akb-service");
    assert.deepEqual(valid.principal.roles, ["service_ingestion"]);
    assert.deepEqual(valid.principal.allowedSourceSystems, ["STRATOS_BUDGET"]);
    assert.equal(
      requireStratosDocumentSourceAllowed(valid.principal, "STRATOS_BUDGET"),
      "STRATOS_BUDGET",
    );
    assert.throws(
      () => requireStratosDocumentSourceAllowed(valid.principal, "STRATOS_AIIP"),
      (error: unknown) =>
        error instanceof ApiClientError
        && error.status === 403
        && error.code === "SOURCE_SYSTEM_NOT_ALLOWED",
    );

    state.roles = ["service_aiip_document"];
    await assert.rejects(
      () => authenticateStratosDocumentServiceJsonRequest(
        request({ external_system: "STRATOS_BUDGET" }, { token: "budget-wrong-role" }),
      ),
      (error: unknown) =>
        error instanceof ApiClientError
        && error.status === 403
        && error.code === "AUTH_ROLE_REQUIRED",
    );

    state.roles = ["service_ingestion"];
    state.audience = ["akb-api"];
    await assert.rejects(
      () => authenticateStratosDocumentServiceJsonRequest(
        request({ external_system: "STRATOS_BUDGET" }, { token: "budget-wrong-audience" }),
      ),
      (error: unknown) =>
        error instanceof ApiClientError
        && error.status === 403
        && error.code === "AUTH_AUDIENCE_INVALID",
    );
  });

  it("uses a bounded dedicated rate window for the historical Budget runner", async () => {
    state.clientId = "stratos-akb-service";
    state.roles = ["service_ingestion"];
    state.audience = ["akl-api"];
    process.env.AKL_WEB_STRATOS_BUDGET_SERVICE_RATE_LIMIT = "2";
    process.env.AKL_WEB_STRATOS_BUDGET_SERVICE_RATE_WINDOW_SECONDS = "60";
    const makeRequest = () => request(
      { external_system: "STRATOS_BUDGET" },
      { token: "budget-rate-profile-token" },
    );

    await authenticateStratosDocumentServiceJsonRequest(
      makeRequest(),
      { rateLimitProfile: "stratos-budget-upload" },
    );
    await authenticateStratosDocumentServiceJsonRequest(
      makeRequest(),
      { rateLimitProfile: "stratos-budget-upload" },
    );
    await assert.rejects(
      () => authenticateStratosDocumentServiceJsonRequest(
        makeRequest(),
        { rateLimitProfile: "stratos-budget-upload" },
      ),
      (error: unknown) =>
        error instanceof ApiClientError
        && error.status === 429
        && error.code === "RATE_LIMIT_EXCEEDED",
    );
  });

  it("rejects caller-authored AKB internal headers on every STRATOS document bridge request", async () => {
    state.clientId = "stratos-akb-service";
    state.roles = ["service_ingestion"];
    state.audience = ["akl-api"];

    await assert.rejects(
      () => authenticateStratosDocumentServiceRequest(
        request(
          { external_system: "STRATOS_BUDGET" },
          { token: "budget-forged-internal-header", headers: { "X-AKL-Subject": "attacker" } },
        ),
      ),
      (error: unknown) =>
        error instanceof ApiClientError
        && error.status === 400
        && error.code === "INTERNAL_HEADER_FORBIDDEN",
    );
  });

  it("cancels an oversized chunked JSON stream without buffering the complete body", async () => {
    let producedChunks = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        producedChunks += 1;
        controller.enqueue(new Uint8Array(16 * 1024).fill(0x20));
        if (producedChunks >= 20) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const streamedRequest = new Request(
      "https://stratos.example/akb/api/stratos/upload/preflight",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer streamed-json-token",
          "Content-Type": "application/json",
        },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    );

    await assert.rejects(
      () => authenticateAiipServiceJsonRequest(streamedRequest),
      (error: unknown) =>
        error instanceof ApiClientError &&
        error.status === 413 &&
        error.code === "PAYLOAD_TOO_LARGE",
    );
    assert.equal(cancelled, true);
    assert.ok(producedChunks < 20);
  });

  it("authenticates aiip-service and forwards bearer identity without internal authorization headers", async () => {
    const response = await handleAiipApplicationRequest(request(harmonizeBody()), "harmonize");

    assert.equal(response.status, 200);
    assert.equal(state.upstreamCalls, 1);
    assert.equal(response.headers.get("X-Request-ID"), "req-aiip-test-0001");
  });

  it("validates a signed service JWT through JWKS when the web OIDC client is public", async () => {
    process.env.AKL_WEB_OIDC_CLIENT_SECRET = "";
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicJwk = publicKey.export({ format: "jwk" });
    const encodedHeader = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" })).toString("base64url");
    const encodedClaims = Buffer.from(JSON.stringify({
      iss: "https://login.example/realms/stratos",
      sub: "e9c66f56-832d-47d4-8d15-5ee74940b7a0",
      azp: "aiip-service",
      client_id: "aiip-service",
      preferred_username: "service-account-aiip-service",
      aud: ["akb-api"],
      exp: Math.floor(Date.now() / 1000) + 300,
      realm_access: { roles: ["service_aiip"] },
    })).toString("base64url");
    const signingInput = `${encodedHeader}.${encodedClaims}`;
    const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey).toString("base64url");
    const token = `${signingInput}.${signature}`;
    const bridgeFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/protocol/openid-connect/certs")) {
        return Response.json({ keys: [{ ...publicJwk, kid: "test-key", alg: "RS256", use: "sig" }] });
      }
      return bridgeFetch(input, init);
    };

    const response = await handleAiipApplicationRequest(
      request(harmonizeBody(), { token }),
      "harmonize",
    );

    assert.equal(response.status, 200);
    assert.equal(state.upstreamCalls, 1);
  });

  it("propagates an exact idempotent replay marker", async () => {
    state.replay = true;
    const response = await handleAiipApplicationRequest(
      request(harmonizeBody(), { token: "replay-token" }),
      "harmonize",
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Idempotency-Replayed"), "true");
  });

  it("rejects a missing role or audience before calling RAG", async () => {
    state.roles = [];
    let response = await handleAiipApplicationRequest(
      request(harmonizeBody(), { token: "missing-role" }),
      "harmonize",
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "AUTH_ROLE_REQUIRED");

    state.roles = ["service_aiip"];
    state.audience = ["another-api"];
    response = await handleAiipApplicationRequest(
      request(harmonizeBody(), { token: "wrong-audience" }),
      "harmonize",
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "AUTH_AUDIENCE_INVALID");
    assert.equal(state.upstreamCalls, 0);
  });

  it("rejects an inactive token and a different client identity", async () => {
    state.active = false;
    let response = await handleAiipApplicationRequest(
      request(harmonizeBody(), { token: "inactive-token" }),
      "harmonize",
    );
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "AUTH_INVALID");

    state.active = true;
    state.clientId = "another-service";
    response = await handleAiipApplicationRequest(
      request(harmonizeBody(), { token: "wrong-client" }),
      "harmonize",
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "AUTH_FORBIDDEN");
    assert.equal(state.upstreamCalls, 0);
  });

  it("rejects restricted data and caller-supplied internal identity", async () => {
    for (const classification of ["restricted", "confidential"]) {
      const classified = await handleAiipApplicationRequest(
        request(harmonizeBody(classification), { token: `${classification}-token` }),
        "harmonize",
      );
      assert.equal(classified.status, 403);
      assert.equal((await classified.json()).error.code, "CLASSIFICATION_NOT_ALLOWED");
    }

    const response = await handleAiipApplicationRequest(
      request(harmonizeBody(), {
        token: "forged-header",
        headers: { "X-AKL-Roles": "admin" },
      }),
      "harmonize",
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INTERNAL_HEADER_FORBIDDEN");
    assert.equal(state.upstreamCalls, 0);
  });

  it("rejects bodies over 64 kB after authentication and before forwarding", async () => {
    const response = await handleAiipApplicationRequest(
      request({ ...harmonizeBody(), padding: "x".repeat(65 * 1024) }, { token: "large-body" }),
      "harmonize",
    );

    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, "PAYLOAD_TOO_LARGE");
    assert.equal(state.upstreamCalls, 0);
  });

  it("enforces 30 requests per minute for one service subject", async () => {
    for (let index = 0; index < 30; index += 1) {
      const response = await handleAiipApplicationRequest(
        request(harmonizeBody(), {
          token: "rate-limit-token",
          headers: { "Idempotency-Key": `idem-rate-limit-${String(index).padStart(4, "0")}` },
        }),
        "harmonize",
      );
      assert.equal(response.status, 200);
    }
    const rejected = await handleAiipApplicationRequest(
      request(harmonizeBody(), {
        token: "rate-limit-token",
        headers: { "Idempotency-Key": "idem-rate-limit-overflow" },
      }),
      "harmonize",
    );

    assert.equal(rejected.status, 429);
    assert.equal((await rejected.json()).error.code, "RATE_LIMIT_EXCEEDED");
    assert.equal(rejected.headers.get("Retry-After"), "60");
  });
});
