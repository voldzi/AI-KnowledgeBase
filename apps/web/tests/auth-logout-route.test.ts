import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { NextRequest } from "next/server";

import { POST } from "../src/app/api/auth/logout/route";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("STRATOS logout", () => {
  it("continues to the central end-session endpoint after local revocation", async () => {
    Object.assign(process.env, {
      AKL_ENV: "development",
      AKL_API_CLIENT_MODE: "mock",
      AKL_AUTH_MODE: "oidc",
      AKL_WEB_OIDC_ISSUER: "https://login.example/realms/stratos",
      AKL_WEB_OIDC_CLIENT_ID: "akl-web",
      AKL_WEB_PUBLIC_BASE_URL: "https://stratos.example/akb",
      AKL_WEB_SESSION_SECRET: "test-session-secret",
      AKL_WEB_SESSION_ENCRYPTION_KEY: "test-session-encryption-key-that-is-long-enough",
      AKL_WEB_SESSION_STORE_SECRET: "test-session-store-secret-that-is-long-enough",
      AKL_WEB_STRATOS_AUTH_ME_URL: "https://stratos.example/api/v1/auth/me",
    });

    const response = await POST(
      new NextRequest("http://akl-web:3000/api/auth/logout", {
        method: "POST",
        headers: { origin: "https://stratos.example" },
      }),
    );

    assert.equal(response.status, 303);
    const location = new URL(response.headers.get("location") ?? "");
    assert.equal(
      location.origin + location.pathname,
      "https://login.example/realms/stratos/protocol/openid-connect/logout",
    );
    assert.equal(location.searchParams.get("client_id"), "akl-web");
    assert.equal(
      location.searchParams.get("post_logout_redirect_uri"),
      "https://stratos.example/akb",
    );
  });
});
