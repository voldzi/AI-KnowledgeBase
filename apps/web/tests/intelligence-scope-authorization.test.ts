import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { createApiClients } from "../src/lib/api";
import { createMockContext } from "../src/lib/api/correlation";
import type { AklFetch } from "../src/lib/api/http-client";
import { authorizeIntelligenceScope } from "../src/lib/intelligence/scope-authorization";
import { ApiClientError, type IntelligenceDocumentCoordinate } from "../src/lib/types";

const productionEnv = {
  AKL_ENV: "test",
  AKL_API_CLIENT_MODE: "production",
  AKL_AUTH_MODE: "oidc",
  AKL_REGISTRY_API_BASE_URL: "https://registry.local/api/v1/",
  AKL_INGESTION_API_BASE_URL: "https://ingestion.local/api/v1/",
  AKL_RAG_API_BASE_URL: "https://rag.local/api/v1/",
  AKL_GOVERNANCE_API_BASE_URL: "https://governance.local/api/v1/",
  AKL_EVALUATION_API_BASE_URL: "https://evaluation.local/api/v1/",
  AKL_WEB_OIDC_ISSUER: "https://login.local/realms/stratos",
  AKL_WEB_PUBLIC_BASE_URL: "https://akl.local",
  AKL_WEB_SESSION_SECRET: "test-session-secret",
  AKL_WEB_STRATOS_AUTH_ME_URL: "https://stratos.local/api/v1/auth/me",
};

const actorContext = createMockContext({
  subjectId: "user_scope_1",
  accessToken: "actor-token",
  requestId: "request-parent",
  correlationId: "correlation-parent",
});

describe("Registry-governed intelligence scope", () => {
  it("accepts only the exact current subset and binds the Registry correlation", async () => {
    const coordinate = exactCoordinate("doc_allowed", "ver_current", "a");
    const fetcher: AklFetch = async (input, init) => {
      assert.equal(String(input), "https://registry.local/api/v1/intelligence/authorization");
      const headers = init?.headers as Headers;
      const body = JSON.parse(String(init?.body)) as {
        document_ids: string[];
        correlation_id: string;
        idempotency_key: string;
      };
      assert.equal(headers.get("Authorization"), "Bearer actor-token");
      assert.equal(headers.get("X-Correlation-ID"), body.correlation_id);
      assert.deepEqual(body.document_ids, ["doc_allowed", "doc_omitted"]);
      return Response.json({
        authorization_token: "registry-intelligence-proof-token-with-bounded-length",
        authorization_id: "iscope_test_scope_123",
        confirmed_subject_id: "user_scope_1",
        action: "intelligence.query",
        document_scope_hash: canonicalScopeHash([coordinate]),
        document_count: 1,
        documents: [coordinate],
        correlation_id: body.correlation_id,
        idempotency_key: body.idempotency_key,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
    };
    const clients = createApiClients({ env: productionEnv, fetcher });

    const scope = await authorizeIntelligenceScope(
      clients,
      actorContext,
      ["doc_omitted", "doc_allowed", "doc_allowed"],
    );

    assert.deepEqual(scope.authorizedDocuments, [coordinate]);
    assert.match(scope.idempotencyKey, /^intelligence:/);
    assert.equal(scope.correlationId.length > 0, true);
  });

  it("rejects a conflicting scope hash before any ingestion query", async () => {
    const coordinate = exactCoordinate("doc_allowed", "ver_current", "a");
    const clients = createApiClients({
      env: productionEnv,
      fetcher: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          correlation_id: string;
          idempotency_key: string;
        };
        return Response.json({
          authorization_token: "registry-intelligence-proof-token-with-bounded-length",
          authorization_id: "iscope_test_scope_123",
          confirmed_subject_id: "user_scope_1",
          action: "intelligence.query",
          document_scope_hash: `sha256:${"f".repeat(64)}`,
          document_count: 1,
          documents: [coordinate],
          correlation_id: body.correlation_id,
          idempotency_key: body.idempotency_key,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        });
      },
    });

    await assert.rejects(
      () => authorizeIntelligenceScope(clients, actorContext, ["doc_allowed"]),
      (error: unknown) => error instanceof ApiClientError
        && error.status === 502
        && error.code === "INTELLIGENCE_SCOPE_AUTHORIZATION_INVALID",
    );
  });

  it("maps a malformed Registry response to a bounded upstream conflict", async () => {
    const clients = createApiClients({
      env: productionEnv,
      fetcher: async () => Response.json({ documents: null }),
    });

    await assert.rejects(
      () => authorizeIntelligenceScope(clients, actorContext, ["doc_allowed"]),
      (error: unknown) => error instanceof ApiClientError
        && error.status === 502
        && error.code === "INTELLIGENCE_SCOPE_AUTHORIZATION_INVALID",
    );
  });

  it("rejects unbounded candidate scopes without calling Registry", async () => {
    let called = false;
    const clients = createApiClients({
      env: productionEnv,
      fetcher: async () => {
        called = true;
        return Response.json({});
      },
    });

    await assert.rejects(
      () => authorizeIntelligenceScope(
        clients,
        actorContext,
        Array.from({ length: 501 }, (_, index) => `doc_${index}`),
      ),
      (error: unknown) => error instanceof ApiClientError
        && error.status === 409
        && error.code === "INTELLIGENCE_SCOPE_REQUIRED",
    );
    assert.equal(called, false);
  });

  it("makes the mock query honor proof coordinates instead of caller filters", async () => {
    const clients = createApiClients({
      env: {
        AKL_ENV: "test",
        AKL_API_CLIENT_MODE: "mock",
        AKL_AUTH_MODE: "mock",
      },
    });
    const context = createMockContext({ subjectId: "mock-user" });
    const scope = await authorizeIntelligenceScope(clients, context, ["doc_109"]);

    const result = await clients.ingestion.searchEntities(
      {
        query: "RMO",
        allowed_document_ids: ["doc_105"],
        allowed_policy_hashes: { doc_105: [`sha256:${"f".repeat(64)}`] },
      },
      context,
      scope,
    );

    assert.deepEqual(result.hits.map((hit) => hit.document_id), ["doc_109"]);
    assert.equal(result.hits[0]?.document_version_id, scope.authorizedDocuments[0]?.document_version_id);
    assert.equal(result.hits[0]?.policy_hash, scope.authorizedDocuments[0]?.policy_hash);
  });
});

function exactCoordinate(
  documentId: string,
  versionId: string,
  hashCharacter: string,
): IntelligenceDocumentCoordinate {
  return {
    document_id: documentId,
    document_version_id: versionId,
    policy_hash: `sha256:${hashCharacter.repeat(64)}`,
  };
}

function canonicalScopeHash(documents: IntelligenceDocumentCoordinate[]): string {
  const canonical = [...documents]
    .sort((left, right) => left.document_id === right.document_id
      ? 0
      : left.document_id < right.document_id ? -1 : 1)
    .map((document) => ({
      document_id: document.document_id,
      document_version_id: document.document_version_id,
      policy_hash: document.policy_hash,
    }));
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}
