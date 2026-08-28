import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requestJson, type JsonRequestOptions } from "../src/lib/api/http-client";
import { ApiClientError } from "../src/lib/types";

const options: JsonRequestOptions = {
  service: "registry-api", operation: "listWorkflowTasks", baseUrl: "https://registry.test", path: "/workflow/tasks",
  context: { subjectId: "fixture", authorizationSource: "stratos_projection", accessToken: "fixture-private-token", correlationId: "http-test", requestId: "http-request" },
};

describe("safe registry transport failures", () => {
  it("maps failed connections to a typed error without leaking underlying details", async (t) => {
    const logs: string[] = [];
    t.mock.method(console, "error", (value: string) => logs.push(value));
    await assert.rejects(() => requestJson({ ...options, fetcher: async () => { throw new Error("fixture-private-token connection string"); } }),
      (error: unknown) => error instanceof ApiClientError && error.status === 503 && error.code === "UPSTREAM_UNAVAILABLE" && !error.message.includes("fixture-private"));
    assert.equal(logs.length, 1);
    assert.doesNotMatch(logs[0], /fixture-private|connection string|subjectId/);
    assert.equal(JSON.parse(logs[0]).correlation_id, "http-test");
  });
  it("gives a bounded timeout and never retries a mutation", async (t) => {
    t.mock.method(console, "error", () => {});
    let calls = 0;
    await assert.rejects(() => requestJson({ ...options, method: "POST", timeoutMs: 10, fetcher: async (_url, init) => {
      calls++;
      assert.ok(init?.signal);
      await new Promise((resolve) => setTimeout(resolve, 20));
      init.signal.throwIfAborted();
      return Response.json({});
    } }), (error: unknown) => error instanceof ApiClientError && error.status === 504 && error.code === "UPSTREAM_TIMEOUT");
    assert.equal(calls, 1);
  });
  for (const response of [() => new Response("<html>unexpected</html>"), () => new Response("broken json", { headers: { "Content-Type": "application/json" } })]) {
    it("treats an invalid success response as failure, not an empty result", async (t) => {
      t.mock.method(console, "error", () => {});
      await assert.rejects(() => requestJson({ ...options, fetcher: async () => response() }),
        (error: unknown) => error instanceof ApiClientError && error.status === 502 && error.code === "UPSTREAM_INVALID_RESPONSE");
    });
  }
  it("preserves authorization failures and does not cache responses", async (t) => {
    t.mock.method(console, "error", () => {});
    await assert.rejects(() => requestJson({ ...options, fetcher: async (_url, init) => {
      assert.equal(init?.cache, "no-store");
      return Response.json({ error: { code: "forbidden", message: "Denied", trace_id: "fixture-trace" } }, { status: 403 });
    } }), (error: unknown) => error instanceof ApiClientError && error.status === 403 && error.code === "forbidden");
  });
});
