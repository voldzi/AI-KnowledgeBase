import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRootLoginPath,
  isAppRootPath,
  normalizedAppBasePath,
} from "../src/lib/auth/root-login-redirect";

test("normalizes empty and slash-only base paths", () => {
  assert.equal(normalizedAppBasePath({}), "");
  assert.equal(normalizedAppBasePath({ NEXT_PUBLIC_AKL_BASE_PATH: "/" }), "");
});

test("recognizes AKB root paths with configured base path", () => {
  const env = { NEXT_PUBLIC_AKL_BASE_PATH: "/akb" };
  assert.equal(isAppRootPath("/akb", env), true);
  assert.equal(isAppRootPath("/akb/", env), true);
  assert.equal(isAppRootPath("/", env), true);
  assert.equal(isAppRootPath("/akb/chat", env), false);
  assert.equal(isAppRootPath("/akb/api/health", env), false);
});

test("builds root login path under the configured base path", () => {
  assert.equal(buildRootLoginPath({ NEXT_PUBLIC_AKL_BASE_PATH: "/akb" }), "/akb/api/auth/login");
  assert.equal(buildRootLoginPath({}), "/api/auth/login");
});
