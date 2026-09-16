import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { NextRequest } from "next/server";
import "./helpers/next-server-navigation";

import { GET } from "../src/app/api/documents/route";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

test("documents API returns a bounded 401 when the OIDC session is absent", async () => {
  Object.assign(process.env, {
    AKL_ENV: "development",
    AKL_API_CLIENT_MODE: "mock",
    AKL_AUTH_MODE: "oidc",
    AKL_WEB_OIDC_ISSUER: "https://login.example/realms/stratos",
    AKL_WEB_OIDC_CLIENT_ID: "akl-web",
    AKL_WEB_PUBLIC_BASE_URL: "https://stratos.example/akb",
    AKL_WEB_SESSION_SECRET: "test-session-secret",
    AKL_WEB_SESSION_ENCRYPTION_KEY:
      "test-session-encryption-key-that-is-long-enough",
    AKL_WEB_SESSION_STORE_SECRET:
      "test-session-store-secret-that-is-long-enough",
    AKL_WEB_STRATOS_AUTH_ME_URL: "https://stratos.example/api/v2/auth/me",
  });

  const response = await GET(
    new NextRequest("https://stratos.example/akb/api/documents"),
  );
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(body.error.code, "OIDC_SESSION_REQUIRED");
});
