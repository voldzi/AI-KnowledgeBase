import assert from "node:assert/strict";
import test from "node:test";

import { controlledDocumentationBridgeError } from "../src/app/api/controlled-documentation/errors";
import { ApiClientError } from "../src/lib/types";

test("controlledDocumentationBridgeError preserves Next redirects", () => {
  const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
    digest: "NEXT_REDIRECT;replace;/api/auth/login;307;",
  });

  assert.throws(
    () =>
      controlledDocumentationBridgeError(
        redirectError,
        "CONTROLLED_DOCUMENTATION_REQUEST_FAILED",
        "Request failed.",
      ),
    (error) => error === redirectError,
  );
});

test("controlledDocumentationBridgeError preserves typed upstream errors", async () => {
  const response = controlledDocumentationBridgeError(
    new ApiClientError(
      "Rule is not authorized.",
      403,
      "CONTROLLED_RULE_NOT_AUTHORIZED",
      "trace-controlled-rule",
    ),
    "CONTROLLED_DOCUMENTATION_REQUEST_FAILED",
    "Request failed.",
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: {
      code: "CONTROLLED_RULE_NOT_AUTHORIZED",
      message: "Rule is not authorized.",
      trace_id: "trace-controlled-rule",
    },
  });
});

test("controlledDocumentationBridgeError does not disclose unknown failures", async () => {
  const response = controlledDocumentationBridgeError(
    new Error("private upstream detail"),
    "CONTROLLED_DOCUMENTATION_REQUEST_FAILED",
    "Request failed.",
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: {
      code: "CONTROLLED_DOCUMENTATION_REQUEST_FAILED",
      message: "Request failed.",
    },
  });
});
