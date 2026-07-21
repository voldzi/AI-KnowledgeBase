import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createApiClients } from "../src/lib/api";
import { createMockContext } from "../src/lib/api/correlation";
import type { AklFetch } from "../src/lib/api/http-client";
import {
  cancelGovernedIngestionJob,
  exactIngestionJobFromAttempt,
  getGovernedIngestionJob,
  getGovernedIngestionReport,
  listAllVisibleIngestionJobs,
  listVisibleIngestionJobs,
  listVisibleIngestionReports,
  refreshPublishedVersionIndexes,
  retryCurrentGovernedIngestionAttempt,
} from "../src/lib/ingestion/governed-operations";
import {
  ApiClientError,
  type ApiRequestContext,
  type IngestionJob,
} from "../src/lib/types";

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
  subjectId: "user_1",
  accessToken: "actor-token",
  requestId: "request-parent-1",
  correlationId: "correlation-parent-1",
});

describe("Registry-governed ingestion operations", () => {
  it("builds a historical retry profile only from the exact Registry current attempt", () => {
    const attempt = {
      document_id: "doc_history",
      document_version_id: "ver_history",
      ingestion_job_id: "ing_history_failed",
      ingestion_status: "FAILED" as const,
      created_at: "2026-07-20T08:00:00Z",
      updated_at: "2026-07-20T08:05:00Z",
    };
    const job = exactIngestionJobFromAttempt(attempt, {
      documentId: "doc_history",
      documentVersionId: "ver_history",
      jobId: "ing_history_failed",
    });
    assert.equal(job.status, "failed");
    assert.equal(job.parser_profile, "controlled_document");

    assert.throws(
      () => exactIngestionJobFromAttempt(attempt, {
        documentId: "doc_history",
        documentVersionId: "ver_other",
        jobId: "ing_history_failed",
      }),
      (error: unknown) => error instanceof ApiClientError
        && error.status === 502
        && error.code === "INGESTION_CURRENT_ATTEMPT_CONFLICT",
    );
  });

  it("projects current attempts for Registry-visible documents with one batch request", async () => {
    const calls: string[] = [];
    const fetcher: AklFetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("ingestion.local")) {
        throw new Error("The production projection must never call global listJobs");
      }
      if (url.includes("/documents/ingestion-attempts/current")) {
        return Response.json({
          items: [
            {
              document_id: "doc_visible_a",
              document_version_id: "ver_visible_a",
              ingestion_job_id: "ing_visible_a",
              ingestion_status: "INDEXED",
              created_at: "2026-07-14T08:00:00Z",
              updated_at: "2026-07-14T08:05:00Z",
            },
            {
              document_id: "doc_visible_outside_selection",
              document_version_id: "ver_outside",
              ingestion_job_id: "ing_outside",
              ingestion_status: "FAILED",
              created_at: "2026-07-14T07:00:00Z",
              updated_at: "2026-07-14T07:05:00Z",
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    const clients = createApiClients({ env: productionEnv, fetcher });

    const jobs = await listVisibleIngestionJobs(
      clients,
      [
        { document_id: "doc_visible_a" },
        { document_id: "doc_visible_b" },
        { document_id: "doc_visible_a" },
      ],
      actorContext,
      { apiClientMode: "production" },
    );

    assert.deepEqual(jobs.map((job) => job.job_id), ["ing_visible_a"]);
    assert.equal(jobs[0]?.document_id, "doc_visible_a");
    assert.equal(jobs[0]?.status, "completed");
    assert.equal(calls.length, 1);
    assert.ok(calls.every((url) => url.includes("registry.local")));
  });

  it("loads the complete caller-visible batch without a preceding document request", async () => {
    const calls: string[] = [];
    const clients = createApiClients({
      env: productionEnv,
      fetcher: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("/documents/ingestion-attempts/current")) {
          return Response.json({
            items: [{
              document_id: "doc_visible",
              document_version_id: "ver_visible",
              ingestion_job_id: "ing_visible",
              ingestion_status: "INDEXED",
              created_at: "2026-07-14T08:00:00Z",
              updated_at: "2026-07-14T08:05:00Z",
            }],
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    const jobs = await listAllVisibleIngestionJobs(clients, actorContext, {
      apiClientMode: "production",
    });

    assert.deepEqual(jobs.map((job) => job.job_id), ["ing_visible"]);
    assert.deepEqual(calls, [
      "https://registry.local/api/v1/documents/ingestion-attempts/current",
    ]);
  });

  it("accepts an empty authorized batch without per-document fallbacks", async () => {
    const fetcher: AklFetch = async (input) => {
      const url = String(input);
      if (url.includes("/documents/ingestion-attempts/current")) {
        return Response.json({ items: [] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    const clients = createApiClients({ env: productionEnv, fetcher });

    const jobs = await listVisibleIngestionJobs(
      clients,
      [
        { document_id: "doc_visible" },
        { document_id: "doc_metadata_only" },
      ],
      actorContext,
      { apiClientMode: "production" },
    );

    assert.deepEqual(jobs, []);
  });

  it("does not hide an unavailable Registry ingestion projection", async () => {
    const clients = createApiClients({
      env: productionEnv,
      fetcher: async () => Response.json({
        error: {
          code: "registry_unavailable",
          message: "Registry is unavailable.",
          trace_id: "corr_unavailable",
        },
      }, { status: 503 }),
    });

    await assert.rejects(
      () => listVisibleIngestionJobs(
        clients,
        [{ document_id: "doc_visible" }],
        actorContext,
        { apiClientMode: "production" },
      ),
      (error: unknown) => error instanceof ApiClientError
        && error.status === 503
        && error.code === "registry_unavailable",
    );
  });

  it("filters the mock job list to the same visible-document boundary", async () => {
    const clients = createApiClients({
      env: {
        AKL_ENV: "test",
        AKL_API_CLIENT_MODE: "mock",
        AKL_AUTH_MODE: "mock",
      },
    });
    const allJobs = await clients.ingestion.listJobs(actorContext);
    const visibleDocumentId = allJobs[0]?.document_id;
    assert.ok(visibleDocumentId);

    const jobs = await listVisibleIngestionJobs(
      clients,
      [{ document_id: visibleDocumentId }],
      actorContext,
      { apiClientMode: "mock" },
    );

    assert.ok(jobs.length > 0);
    assert.ok(jobs.every((job) => job.document_id === visibleDocumentId));
  });

  it("loads mock reports through the same exact governed operation", async () => {
    const clients = createApiClients({
      env: {
        AKL_ENV: "test",
        AKL_API_CLIENT_MODE: "mock",
        AKL_AUTH_MODE: "mock",
      },
    });
    const documents = await clients.registry.listDocuments(actorContext);
    const jobs = await listVisibleIngestionJobs(
      clients,
      documents,
      actorContext,
      { apiClientMode: "mock" },
    );

    const reports = await listVisibleIngestionReports(
      clients,
      actorContext,
      jobs,
    );

    assert.deepEqual(
      reports.map((report) => report.job_id).sort(),
      ["ing_299", "ing_300"],
    );
  });

  it("forbids the production web client from issuing a global job list request", async () => {
    let called = false;
    const clients = createApiClients({
      env: productionEnv,
      fetcher: async () => {
        called = true;
        return Response.json([]);
      },
    });

    await assert.rejects(
      () => clients.ingestion.listJobs(actorContext),
      (error: unknown) => error instanceof ApiClientError
        && error.status === 403
        && error.code === "INGESTION_GLOBAL_LIST_FORBIDDEN",
    );
    assert.equal(called, false);
  });

  it("issues a fresh exact proof and uses only the dedicated transport for get, report, and cancel", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetcher: AklFetch = async (input, init) => {
      const url = String(input);
      calls.push([url, init]);
      if (url.includes("/ingestion-authorization")) {
        const body = JSON.parse(String(init?.body)) as {
          action: "document.read" | "document.ingest";
          correlation_id: string;
          idempotency_key: string;
        };
        assert.equal((init?.headers as Headers).get("Authorization"), "Bearer actor-token");
        return Response.json({
          authorization_token: "registry-proof-token-with-bounded-length-1234567890",
          authorization_id: `iauth_${body.correlation_id}`,
          confirmed_subject_id: "user_1",
          action: body.action,
          document_id: "doc_1",
          document_version_id: "ver_1",
          correlation_id: body.correlation_id,
          idempotency_key: body.idempotency_key,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        });
      }
      const headers = init?.headers as Headers;
      assert.equal(headers.get("Authorization"), "Bearer transport-token");
      assert.equal(headers.get("X-AKL-On-Behalf-Of"), "user_1");
      assert.equal(
        headers.get("X-AKL-Ingestion-Authorization"),
        "registry-proof-token-with-bounded-length-1234567890",
      );
      if (url.endsWith("/ingestion/jobs/ing_1/report")) {
        return Response.json({
          job_id: "ing_1",
          status: "completed",
          documents_processed: 1,
          pages_processed: 3,
          chunks_created: 7,
          tables_detected: 0,
          ocr_used: false,
          warnings: [],
          errors: [],
        });
      }
      return Response.json(jobFixture(url.endsWith("/cancel") ? "cancelled" : "completed"));
    };
    const clients = createApiClients({ env: productionEnv, fetcher });
    const transportContextFactory = async (correlationId: string) =>
      dedicatedTransportContext(correlationId);

    const job = await getGovernedIngestionJob(
      clients,
      actorContext,
      exactCoordinate("corr-read-get-1"),
      { transportContextFactory },
    );
    const report = await getGovernedIngestionReport(
      clients,
      actorContext,
      exactCoordinate("corr-read-report-1"),
      { transportContextFactory },
    );
    const cancelled = await cancelGovernedIngestionJob(
      clients,
      actorContext,
      exactCoordinate("corr-cancel-1"),
      { transportContextFactory },
    );

    assert.equal(job.job_id, "ing_1");
    assert.equal(report.chunks_created, 7);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(calls.length, 6);
    const proofBodies = calls
      .filter(([url]) => url.includes("/ingestion-authorization"))
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, string>);
    assert.deepEqual(
      proofBodies.map((body) => [body.action, body.idempotency_key]),
      [
        ["document.read", "read:ing_1:corr-read-get-1"],
        ["document.read", "read:ing_1:corr-read-report-1"],
        ["document.ingest", "cancel:ing_1:corr-cancel-1"],
      ],
    );
  });

  it("rejects a conflicting Registry proof before the ingestion transport is called", async () => {
    let ingestionCalled = false;
    const fetcher: AklFetch = async (input, init) => {
      if (String(input).includes("ingestion.local")) {
        ingestionCalled = true;
        return Response.json(jobFixture("completed"));
      }
      const body = JSON.parse(String(init?.body)) as {
        action: "document.read";
        correlation_id: string;
        idempotency_key: string;
      };
      return Response.json({
        authorization_token: "registry-proof-token-with-bounded-length-1234567890",
        authorization_id: "iauth_conflict",
        confirmed_subject_id: "user_1",
        action: body.action,
        document_id: "doc_other",
        document_version_id: "ver_1",
        correlation_id: body.correlation_id,
        idempotency_key: body.idempotency_key,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
    };
    const clients = createApiClients({ env: productionEnv, fetcher });

    await assert.rejects(
      () => getGovernedIngestionJob(
        clients,
        actorContext,
        exactCoordinate("corr-conflict-1"),
        { transportContextFactory: async (correlationId) => dedicatedTransportContext(correlationId) },
      ),
      (error: unknown) => error instanceof ApiClientError
        && error.status === 502
        && error.code === "INGESTION_AUTHORIZATION_CONFLICT",
    );
    assert.equal(ingestionCalled, false);
  });

  it("rejects a malformed Registry proof as a bounded upstream conflict", async () => {
    let ingestionCalled = false;
    const clients = createApiClients({
      env: productionEnv,
      fetcher: async (input) => {
        if (String(input).includes("ingestion.local")) {
          ingestionCalled = true;
          return Response.json(jobFixture("completed"));
        }
        return Response.json({});
      },
    });

    await assert.rejects(
      () => getGovernedIngestionJob(
        clients,
        actorContext,
        exactCoordinate("corr-malformed-1"),
        { transportContextFactory: async (correlationId) => dedicatedTransportContext(correlationId) },
      ),
      (error: unknown) => error instanceof ApiClientError
        && error.status === 502
        && error.code === "INGESTION_AUTHORIZATION_CONFLICT",
    );
    assert.equal(ingestionCalled, false);
  });

  it("does not hide authorization failures while loading visible reports", async () => {
    const fetcher: AklFetch = async (input, init) => {
      if (String(input).includes("/ingestion-authorization")) {
        const body = JSON.parse(String(init?.body)) as {
          action: "document.read";
          correlation_id: string;
          idempotency_key: string;
        };
        return Response.json({
          authorization_token: "registry-proof-token-with-bounded-length-1234567890",
          authorization_id: "iauth_report_denied",
          confirmed_subject_id: "user_1",
          action: body.action,
          document_id: "doc_1",
          document_version_id: "ver_1",
          correlation_id: body.correlation_id,
          idempotency_key: body.idempotency_key,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        });
      }
      return Response.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Denied",
            details: {},
            trace_id: "trace_report_denied",
          },
        },
        { status: 403 },
      );
    };
    const clients = createApiClients({ env: productionEnv, fetcher });

    await assert.rejects(
      () => listVisibleIngestionReports(
        clients,
        actorContext,
        [jobFixture("completed")],
        { transportContextFactory: async (correlationId) => dedicatedTransportContext(correlationId) },
      ),
      (error: unknown) => error instanceof ApiClientError
        && error.status === 403
        && error.code === "FORBIDDEN",
    );
  });

  it("refuses exact ProductionIngestionClient calls made with an actor context", async () => {
    let called = false;
    const clients = createApiClients({
      env: productionEnv,
      fetcher: async () => {
        called = true;
        return Response.json(jobFixture("completed"));
      },
    });

    assert.throws(
      () => clients.ingestion.getJob(
        "ing_1",
        actorContext,
        {
          delegatedActorSubjectId: "user_1",
          authorizationToken: "registry-proof-token-with-bounded-length-1234567890",
        },
      ),
      (error: unknown) => error instanceof ApiClientError
        && error.status === 503
        && error.code === "INGESTION_TRANSPORT_AUTH_REQUIRED",
    );
    assert.equal(called, false);
  });

  it("retries only the Registry current attempt with fresh read and ingest proofs over the dedicated transport", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetcher: AklFetch = async (input, init) => {
      const url = String(input);
      calls.push([url, init]);
      const headers = init?.headers as Headers;
      if (url.endsWith("/documents/doc_1/external-references/current")) {
        assert.equal(headers.get("Authorization"), "Bearer actor-token");
        return Response.json({
          document_id: "doc_1",
          updated: 0,
          items: [],
          ingestion_attempt: {
            document_id: "doc_1",
            document_version_id: "ver_1",
            ingestion_job_id: "ing_1",
            ingestion_status: "FAILED",
            created_at: "2026-07-14T10:00:00Z",
            updated_at: "2026-07-14T10:02:00Z",
          },
        });
      }
      if (url.endsWith("/documents/doc_1/versions")) {
        assert.equal(headers.get("Authorization"), "Bearer actor-token");
        return Response.json({ items: [versionFixture()] });
      }
      if (url.includes("/ingestion-authorization")) {
        assert.equal(headers.get("Authorization"), "Bearer actor-token");
        const body = JSON.parse(String(init?.body)) as {
          action: "document.read" | "document.ingest";
          correlation_id: string;
          idempotency_key: string;
        };
        return Response.json({
          authorization_token: `registry-${body.action}-proof-token-with-bounded-length-1234`,
          authorization_id: `iauth_${body.action.replace(".", "_")}`,
          confirmed_subject_id: "user_1",
          action: body.action,
          document_id: "doc_1",
          document_version_id: "ver_1",
          correlation_id: body.correlation_id,
          idempotency_key: body.idempotency_key,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        });
      }

      assert.equal(headers.get("Authorization"), "Bearer transport-token");
      assert.equal(headers.get("X-AKL-On-Behalf-Of"), "user_1");
      assert.match(headers.get("X-AKL-Ingestion-Authorization") ?? "", /^registry-document\./);
      if (url.endsWith("/ingestion/jobs/ing_1")) {
        return Response.json(jobFixture("failed", "ing_1"));
      }
      if (url.endsWith("/ingestion/jobs") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        assert.equal(body.document_id, "doc_1");
        assert.equal(body.document_version_id, "ver_1");
        assert.equal(body.expected_current_ingestion_job_id, "ing_1");
        assert.equal(body.source_file_uri, versionFixture().source_file_uri);
        assert.match(String(body.idempotency_key), /^retry:[a-f0-9]{64}$/);
        return Response.json(jobFixture("queued", "ing_2"));
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    const clients = createApiClients({ env: productionEnv, fetcher });

    const result = await retryCurrentGovernedIngestionAttempt(
      clients,
      actorContext,
      "doc_1",
      "user-retry-operation-0001",
      {
        correlationId: "corr-user-retry-1",
        transportContextFactory: async (correlationId) => dedicatedTransportContext(correlationId),
      },
    );

    assert.equal(result.previousAttempt.ingestion_job_id, "ing_1");
    assert.equal(result.version.document_version_id, "ver_1");
    assert.equal(result.job.job_id, "ing_2");
    assert.equal(calls.length, 6);
    const proofBodies = calls
      .filter(([url]) => url.includes("/ingestion-authorization"))
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, string>);
    assert.deepEqual(proofBodies.map((body) => body.action), ["document.read", "document.ingest"]);
    assert.equal(proofBodies[0]?.idempotency_key, "read:ing_1:corr-user-retry-1");
    assert.match(proofBodies[1]?.idempotency_key ?? "", /^retry:[a-f0-9]{64}$/);
  });

  it("fails closed before proof issuance when the Registry current attempt version is inconsistent", async () => {
    let authorizationCalled = false;
    let ingestionCalled = false;
    const clients = createApiClients({
      env: productionEnv,
      fetcher: async (input) => {
        const url = String(input);
        if (url.includes("ingestion.local")) ingestionCalled = true;
        if (url.includes("/ingestion-authorization")) authorizationCalled = true;
        if (url.endsWith("/documents/doc_1/external-references/current")) {
          return Response.json({
            document_id: "doc_1",
            ingestion_attempt: {
              document_id: "doc_1",
              document_version_id: "ver_missing",
              ingestion_job_id: "ing_1",
              ingestion_status: "FAILED",
              created_at: "2026-07-14T10:00:00Z",
              updated_at: "2026-07-14T10:02:00Z",
            },
          });
        }
        if (url.endsWith("/documents/doc_1/versions")) {
          return Response.json({ items: [versionFixture()] });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await assert.rejects(
      () => retryCurrentGovernedIngestionAttempt(
        clients,
        actorContext,
        "doc_1",
        "user-retry-operation-0002",
        {
          correlationId: "corr-user-retry-2",
          transportContextFactory: async (correlationId) => dedicatedTransportContext(correlationId),
        },
      ),
      (error: unknown) => error instanceof ApiClientError
        && error.status === 502
        && error.code === "INGESTION_CURRENT_ATTEMPT_CONFLICT",
    );
    assert.equal(authorizationCalled, false);
    assert.equal(ingestionCalled, false);
  });

  it("rejects an invalid user retry operation id before any Registry request", async () => {
    let called = false;
    const clients = createApiClients({
      env: productionEnv,
      fetcher: async () => {
        called = true;
        return Response.json({});
      },
    });

    await assert.rejects(
      () => retryCurrentGovernedIngestionAttempt(
        clients,
        actorContext,
        "doc_1",
        "short",
      ),
      (error: unknown) => error instanceof ApiClientError
        && error.status === 400
        && error.code === "INGESTION_RETRY_OPERATION_ID_INVALID",
    );
    assert.equal(called, false);
  });

  it("refreshes the exact published version with one deterministic successor job", async () => {
    const idempotencyKeys: string[] = [];
    const fetcher: AklFetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      if (url.endsWith("/documents/doc_1/external-references/current")) {
        return Response.json({
          document_id: "doc_1",
          ingestion_attempt: {
            document_id: "doc_1",
            document_version_id: "ver_1",
            ingestion_job_id: "ing_1",
            ingestion_status: "INDEXED",
            created_at: "2026-07-14T10:00:00Z",
            updated_at: "2026-07-14T10:02:00Z",
          },
        });
      }
      if (url.endsWith("/documents/doc_1/versions")) {
        return Response.json({ items: [versionFixture()] });
      }
      if (url.includes("/ingestion-authorization")) {
        const body = JSON.parse(String(init?.body)) as {
          action: "document.read" | "document.ingest";
          correlation_id: string;
          idempotency_key: string;
        };
        idempotencyKeys.push(body.idempotency_key);
        return Response.json({
          authorization_token: `registry-${body.action}-proof-token-with-bounded-length-1234`,
          authorization_id: `iauth_${body.action.replace(".", "_")}`,
          confirmed_subject_id: "user_1",
          action: body.action,
          document_id: "doc_1",
          document_version_id: "ver_1",
          correlation_id: body.correlation_id,
          idempotency_key: body.idempotency_key,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        });
      }
      assert.equal(headers.get("Authorization"), "Bearer transport-token");
      if (url.endsWith("/ingestion/jobs/ing_1")) {
        return Response.json(jobFixture("completed", "ing_1"));
      }
      if (url.endsWith("/ingestion/jobs") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        assert.equal(body.expected_current_ingestion_job_id, "ing_1");
        return Response.json(jobFixture("queued", "ing_refresh"));
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    const clients = createApiClients({ env: productionEnv, fetcher });

    const result = await refreshPublishedVersionIndexes(
      clients,
      actorContext,
      "doc_1",
      "ver_1",
      {
        transportContextFactory: async (correlationId) => dedicatedTransportContext(correlationId),
      },
    );

    assert.equal(result.job.job_id, "ing_refresh");
    assert.match(idempotencyKeys[0] ?? "", /^read:ing_1:/);
    assert.match(idempotencyKeys[1] ?? "", /^retry:[a-f0-9]{64}$/);
  });

  it("fails before reading or writing an index when the published version is not current", async () => {
    let ingestionCalled = false;
    const clients = createApiClients({
      env: productionEnv,
      fetcher: async (input) => {
        const url = String(input);
        if (url.includes("ingestion.local")) ingestionCalled = true;
        if (url.endsWith("/documents/doc_1/external-references/current")) {
          return Response.json({
            document_id: "doc_1",
            ingestion_attempt: {
              document_id: "doc_1",
              document_version_id: "ver_1",
              ingestion_job_id: "ing_1",
              ingestion_status: "INDEXED",
              created_at: "2026-07-14T10:00:00Z",
              updated_at: "2026-07-14T10:02:00Z",
            },
          });
        }
        if (url.endsWith("/documents/doc_1/versions")) {
          return Response.json({ items: [versionFixture()] });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await assert.rejects(
      () => refreshPublishedVersionIndexes(
        clients,
        actorContext,
        "doc_1",
        "ver_other",
      ),
      (error: unknown) => error instanceof ApiClientError
        && error.status === 502
        && error.code === "INGESTION_PUBLISHED_VERSION_CONFLICT",
    );
    assert.equal(ingestionCalled, false);
  });
});

function exactCoordinate(correlationId: string) {
  return {
    documentId: "doc_1",
    documentVersionId: "ver_1",
    jobId: "ing_1",
    correlationId,
  };
}

function dedicatedTransportContext(correlationId: string): ApiRequestContext {
  return {
    subjectId: "service-account-svc-akb-web-ingestion",
    roles: ["service_akb_web_ingestion"],
    serviceClientId: "svc-akb-web-ingestion",
    accessToken: "transport-token",
    requestId: correlationId,
    correlationId,
  };
}

function jobFixture(status: IngestionJob["status"], jobId = "ing_1"): IngestionJob {
  return {
    job_id: jobId,
    document_id: "doc_1",
    document_version_id: "ver_1",
    status,
    parser_profile: "controlled_document",
    ocr_enabled: true,
    chunking_strategy: "legal_structured",
    embedding_profile: "default",
    created_at: "2026-07-14T10:00:00Z",
    started_at: "2026-07-14T10:01:00Z",
    finished_at: "2026-07-14T10:02:00Z",
  };
}

function versionFixture() {
  return {
    document_version_id: "ver_1",
    document_id: "doc_1",
    version_label: "1.0",
    status: "valid" as const,
    valid_from: "2026-07-01",
    valid_to: null,
    source_file_uri: "s3://akl-documents/doc_1/ver_1/file.pdf",
    file_hash: `sha256:${"a".repeat(64)}`,
    change_summary: "Current governed version.",
    created_at: "2026-07-01T10:00:00Z",
    published_at: "2026-07-02T10:00:00Z",
  };
}
