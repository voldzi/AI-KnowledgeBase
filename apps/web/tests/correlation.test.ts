import assert from "node:assert/strict";
import test from "node:test";

import { withRequestCorrelation } from "../src/lib/api/correlation";

test("request correlation preserves valid STRATOS transport identifiers", () => {
  const context = withRequestCorrelation(
    { subjectId: "person-1", correlationId: "cached-value" },
    new Headers({
      "X-Request-ID": "req-c06-1",
      "X-Correlation-ID": "corr-c06-1",
    }),
  );

  assert.equal(context.requestId, "req-c06-1");
  assert.equal(context.correlationId, "corr-c06-1");
  assert.equal(context.subjectId, "person-1");
});

test("request correlation never reuses a cached token context identifier", () => {
  const context = withRequestCorrelation(
    { subjectId: "person-1", requestId: "cached-request", correlationId: "cached-correlation" },
    new Headers(),
  );

  assert.notEqual(context.requestId, "cached-request");
  assert.equal(context.correlationId, context.requestId);
});

test("request correlation ignores malformed transport identifiers", () => {
  const context = withRequestCorrelation(
    { subjectId: "person-1" },
    new Headers({
      "X-Request-ID": "contains whitespace",
      "X-Correlation-ID": "../invalid/value",
    }),
  );

  assert.equal(context.correlationId, context.requestId);
  assert.notEqual(context.requestId, "contains whitespace");
});
