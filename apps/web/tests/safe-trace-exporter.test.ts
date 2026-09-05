import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SafeTraceExporter, sanitizeTraceSpan } from "../src/lib/observability/safe-trace-exporter";

type Span = Parameters<typeof sanitizeTraceSpan>[0];

function span(attributes: Record<string, string> = {}): Span {
  return {
    name: "GET /api/documents?query=private-query", attributes,
    status: { code: 2, message: "private-error" },
    events: [{ name: "exception", time: [1, 0], attributes: { "exception.message": "private-error" } }],
    links: [], spanContext: () => ({ traceId: "a".repeat(32), spanId: "b".repeat(16), traceFlags: 1 }),
  } as unknown as Span;
}

describe("safe identity telemetry", () => {
  it("does not export auth callbacks, session storage or issuer protocol spans", () => {
    for (const path of ["/api/auth/callback", "/identity/token", "/protocol/openid-connect/token", "/api/v1/internal/web-sessions/private-selector-hash", "/?code=synthetic-code"]) {
      assert.equal(sanitizeTraceSpan(span({ "url.full": `https://example.invalid${path}` })), null);
    }
  });

  it("retains timing and technical status without credentials, bodies, queries or exceptions", () => {
    const result = sanitizeTraceSpan(span({
      "http.status_code": "200", "url.full": "https://example.invalid/api/documents?token=private-token#private-fragment",
      "http.request.header.authorization": "Bearer private-token", "http.request.body": "private-body",
      "session.cookie": "private-cookie", "llm.prompt": "private-prompt", "llm.answer": "private-answer",
      "db.statement": "private-sql", "refresh_token": "private-refresh",
    }));
    assert.ok(result);
    assert.deepEqual(result.attributes, { "http.status_code": "200", "url.full": "https://example.invalid/api/documents" });
    assert.deepEqual(result.status, { code: 2 });
    assert.deepEqual(result.events, []);
    assert.equal(result.name, "GET /api/documents");
    assert.equal(JSON.stringify(result).includes("private-"), false);
  });

  it("wraps the only exporter and preserves exporter lifecycle", async () => {
    let exported: Span[] = [];
    let shutdown = false;
    const exporter = new SafeTraceExporter({
      export: (spans, callback) => { exported = spans; callback({ code: 0 }); },
      shutdown: async () => { shutdown = true; }, forceFlush: async () => undefined,
    });
    exporter.export([span({ "url.path": "/identity/jwks" }), span({ "http.status_code": "200" })], (result) => assert.equal(result.code, 0));
    assert.equal(exported.length, 1);
    await exporter.forceFlush();
    await exporter.shutdown();
    assert.equal(shutdown, true);
  });
});
