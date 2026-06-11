import assert from "node:assert/strict";
import test from "node:test";

import { assistantBridgeError } from "../src/app/api/assistant/errors";

test("assistantBridgeError preserves Next redirects", () => {
  const redirectError = { digest: "NEXT_REDIRECT;replace;/api/auth/login;307;" };

  assert.throws(() => assistantBridgeError(redirectError), (error) => error === redirectError);
});
