import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { AklConfig } from "../src/lib/api/config";
import {
  ingestionJobIdForIdempotencyKey,
  ingestionServiceAccessToken,
  resetIngestionServiceTokenCacheForTests,
} from "../src/lib/ingestion/service-identity";
import { ApiClientError } from "../src/lib/types";

const originalFetch = globalThis.fetch;

beforeEach(() => resetIngestionServiceTokenCacheForTests());
afterEach(() => {
  globalThis.fetch = originalFetch;
  resetIngestionServiceTokenCacheForTests();
});

describe("web-to-ingestion service identity", () => {
  it("derives the exact durable ingestion job id from the transport namespace", () => {
    assert.equal(
      ingestionJobIdForIdempotencyKey("confirm:extdoc_budget_123:ver_budget_123"),
      "ing_4e41bbae34394a6768ec51916c656af7",
    );
  });

  it("isolates concurrent token requests by exact token endpoint and client", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/realm-a/token")) return first.promise;
      if (url.endsWith("/realm-b/token")) return second.promise;
      throw new Error(`Unexpected token endpoint: ${url}`);
    };

    const tokenA = ingestionServiceAccessToken(config("https://login.example/realm-a/token"));
    const tokenB = ingestionServiceAccessToken(config("https://login.example/realm-b/token"));
    second.resolve(Response.json({ access_token: "token-b", expires_in: 300 }));
    first.resolve(Response.json({ access_token: "token-a", expires_in: 300 }));

    assert.equal(await tokenA, "token-a");
    assert.equal(await tokenB, "token-b");
  });

  it("rejects unbounded token lifetimes", async () => {
    globalThis.fetch = async () => Response.json({
      access_token: "token-too-long",
      expires_in: 86_401,
    });

    await assert.rejects(
      () => ingestionServiceAccessToken(config("https://login.example/realm/token")),
      (error: unknown) => error instanceof ApiClientError
        && error.status === 503
        && error.code === "INGESTION_TRANSPORT_AUTH_INVALID",
    );
  });
});

function config(tokenUrl: string): AklConfig {
  return {
    environment: "test",
    apiClientMode: "production",
    authMode: "oidc",
    serviceBaseUrls: {
      registry: "http://registry/api/v1",
      ingestion: "http://ingestion/api/v1",
      rag: "http://rag/api/v1",
      governance: "http://governance/api/v1",
      evaluation: "http://evaluation/api/v1",
    },
    ingestionTransport: {
      tokenUrl,
      clientId: "svc-akb-web-ingestion",
      clientSecret: "test-web-ingestion-secret",
    },
    oidc: {
      issuer: "https://login.example/realms/stratos",
      clientId: "akl-web",
      redirectUri: "https://stratos.example/akb/api/auth/callback",
      scopes: "openid profile email",
      sessionSecret: "test-secret",
      stratosAuthMeUrl: "https://stratos.example/api/v1/auth/me",
      accessProjectionTimeoutMs: 3_000,
      accessProjectionCacheTtlMs: 0,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
