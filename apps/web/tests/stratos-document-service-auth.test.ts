import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";

import { NextRequest } from "next/server";

import {
  authenticateStratosDocumentServiceJsonRequest,
  authenticateStratosDocumentServiceRequest,
  requireStratosDocumentSourceAllowed,
} from "../src/lib/stratos/document-service-auth";
import { ApiClientError } from "../src/lib/types";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

type FetchState = {
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
  return new NextRequest("https://stratos.example/akb/api/stratos/budget-upload/preflight", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.token ?? "valid-budget-token"}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: JSON.stringify(body),
  });
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
    roles: ["service_ingestion"],
    audience: ["akl-api"],
    active: true,
    clientId: "stratos-akb-service",
  };
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assert.ok(url.endsWith("/protocol/openid-connect/token/introspect"));
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
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

describe("STRATOS document service authentication", () => {
  it("binds the bridge to the exact Budget identity and source", async () => {
    const valid = await authenticateStratosDocumentServiceJsonRequest(
      request({ external_system: "STRATOS_BUDGET" }),
    );

    assert.equal(valid.principal.clientId, "stratos-akb-service");
    assert.deepEqual(valid.principal.roles, ["service_ingestion"]);
    assert.deepEqual(valid.principal.allowedSourceSystems, ["STRATOS_BUDGET"]);
    assert.equal(valid.body.external_system, "STRATOS_BUDGET");
    assert.equal(
      requireStratosDocumentSourceAllowed(valid.principal, "STRATOS_BUDGET"),
      "STRATOS_BUDGET",
    );
    assert.throws(
      () => requireStratosDocumentSourceAllowed(valid.principal, "STRATOS_ARCHFLOW"),
      (error: unknown) =>
        error instanceof ApiClientError
        && error.status === 403
        && error.code === "SOURCE_SYSTEM_NOT_ALLOWED",
    );
  });

  it("rejects a wrong role, audience, client, or inactive token", async () => {
    state.roles = ["reader"];
    await assert.rejects(
      () => authenticateStratosDocumentServiceRequest(request({})),
      (error: unknown) => error instanceof ApiClientError && error.code === "AUTH_ROLE_REQUIRED",
    );

    state.roles = ["service_ingestion"];
    state.audience = ["akb-api"];
    await assert.rejects(
      () => authenticateStratosDocumentServiceRequest(request({})),
      (error: unknown) => error instanceof ApiClientError && error.code === "AUTH_AUDIENCE_INVALID",
    );

    state.audience = ["akl-api"];
    state.clientId = "retired-service";
    await assert.rejects(
      () => authenticateStratosDocumentServiceRequest(request({})),
      (error: unknown) => error instanceof ApiClientError && error.code === "AUTH_FORBIDDEN",
    );

    state.clientId = "stratos-akb-service";
    state.active = false;
    await assert.rejects(
      () => authenticateStratosDocumentServiceRequest(request({})),
      (error: unknown) => error instanceof ApiClientError && error.code === "AUTH_INVALID",
    );
  });

  it("rejects caller-authored internal identity headers", async () => {
    await assert.rejects(
      () => authenticateStratosDocumentServiceRequest(
        request({}, { headers: { "X-AKL-Subject": "attacker" } }),
      ),
      (error: unknown) =>
        error instanceof ApiClientError
        && error.status === 400
        && error.code === "INTERNAL_HEADER_FORBIDDEN",
    );
  });

  it("enforces the bounded Budget upload rate profile", async () => {
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

  it("cancels an oversized chunked JSON stream", async () => {
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
      "https://stratos.example/akb/api/stratos/budget-upload/preflight",
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
      () => authenticateStratosDocumentServiceJsonRequest(streamedRequest),
      (error: unknown) =>
        error instanceof ApiClientError
        && error.status === 413
        && error.code === "PAYLOAD_TOO_LARGE",
    );
    assert.equal(cancelled, true);
    assert.ok(producedChunks < 20);
  });

  it("validates a signed Budget service JWT through JWKS", async () => {
    process.env.AKL_WEB_OIDC_CLIENT_SECRET = "";
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicJwk = publicKey.export({ format: "jwk" });
    const encodedHeader = Buffer.from(
      JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }),
    ).toString("base64url");
    const encodedClaims = Buffer.from(JSON.stringify({
      iss: "https://login.example/realms/stratos",
      sub: "e9c66f56-832d-47d4-8d15-5ee74940b7a0",
      azp: "stratos-akb-service",
      client_id: "stratos-akb-service",
      preferred_username: "service-account-stratos-akb-service",
      aud: ["akl-api"],
      exp: Math.floor(Date.now() / 1000) + 300,
      realm_access: { roles: ["service_ingestion"] },
    })).toString("base64url");
    const signingInput = `${encodedHeader}.${encodedClaims}`;
    const signature = createSign("RSA-SHA256")
      .update(signingInput)
      .sign(privateKey)
      .toString("base64url");
    const token = `${signingInput}.${signature}`;
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      assert.ok(url.endsWith("/protocol/openid-connect/certs"));
      return Response.json({
        keys: [{ ...publicJwk, kid: "test-key", alg: "RS256", use: "sig" }],
      });
    };

    const principal = await authenticateStratosDocumentServiceRequest(
      request({}, { token }),
    );

    assert.equal(principal.clientId, "stratos-akb-service");
    assert.deepEqual(principal.roles, ["service_ingestion"]);
  });
});
