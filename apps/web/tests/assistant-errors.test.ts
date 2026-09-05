import assert from "node:assert/strict";
import test from "node:test";

import { assistantBridgeError } from "../src/app/api/assistant/errors";

test("assistantBridgeError preserves Next redirects", () => {
  const redirectError = { digest: "NEXT_REDIRECT;replace;/api/auth/login;307;" };

  assert.throws(() => assistantBridgeError(redirectError), (error) => error === redirectError);
});

test("assistantBridgeError reports a bounded upstream timeout", async () => {
  const response = assistantBridgeError(new DOMException("timed out", "TimeoutError"));

  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), {
    error: {
      code: "ASSISTANT_UPSTREAM_TIMEOUT",
      message: "Assistant source did not respond within the configured time limit.",
    },
  });
});
