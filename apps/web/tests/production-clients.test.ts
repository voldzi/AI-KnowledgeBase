import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createApiClients } from "../src/lib/api";
import { createMockContext } from "../src/lib/api/correlation";
import type { AklFetch } from "../src/lib/api/http-client";

const env = {
  AKL_ENV: "test",
  AKL_API_CLIENT_MODE: "production",
  AKL_AUTH_MODE: "oidc",
  AKL_REGISTRY_API_BASE_URL: "https://registry.local/api/v1/",
  AKL_INGESTION_API_BASE_URL: "https://ingestion.local/api/v1/",
  AKL_RAG_API_BASE_URL: "https://rag.local/api/v1/"
};

describe("production API clients", () => {
  it("uses service base URLs and required request headers", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: AklFetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json({
        items: [
          {
            document_id: "doc_1",
            title: "Test",
            document_type: "directive",
            status: "valid",
            classification: "internal",
            owner_id: "user_1",
            owner: "user_1",
            gestor_unit: "IT",
            tags: [],
            created_at: "2026-06-05T10:00:00Z",
            updated_at: "2026-06-05T10:00:00Z"
          }
        ],
        limit: 100,
        offset: 0
      });
    };

    const clients = createApiClients({ env, fetcher });
    const context = createMockContext({
      subjectId: "user_1",
      accessToken: "test-token",
      requestId: "req_test",
      correlationId: "corr_test"
    });

    await clients.registry.listDocuments(context);

    assert.equal(calls.length, 1);
    const [url, init] = calls[0];
    const headers = init?.headers as Headers;

    assert.equal(url, "https://registry.local/api/v1/documents");
    assert.equal(headers.get("Authorization"), "Bearer test-token");
    assert.equal(headers.get("X-Request-ID"), "req_test");
    assert.equal(headers.get("X-Correlation-ID"), "corr_test");
    assert.equal(init?.cache, "no-store");
  });

  it("maps upstream error bodies to ApiClientError", async () => {
    const fetcher: AklFetch = async () =>
      Response.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Denied",
            details: {},
            trace_id: "trace_1"
          }
        },
        { status: 403 }
      );

    const clients = createApiClients({ env, fetcher });

    await assert.rejects(
      () => clients.registry.listDocuments(createMockContext()),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        "code" in error &&
        "traceId" in error &&
        error.status === 403 &&
        error.code === "FORBIDDEN" &&
        error.traceId === "trace_1"
    );
  });
});
