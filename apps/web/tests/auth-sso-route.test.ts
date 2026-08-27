import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { NextRequest } from "next/server";

import { GET as beginSilentSso } from "../src/app/api/auth/sso/route";
import { GET as completeOidcCallback } from "../src/app/api/auth/callback/route";
import { createState } from "../src/lib/auth/oidc";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("automatic STRATOS SSO", () => {
  it("starts ordinary PKCE authorization once without forcing a fresh login", async () => {
    configureOidc();
    const response = await beginSilentSso(
      new NextRequest("https://stratos.example/akb/api/auth/sso?return_to=%2Fchat"),
    );

    assert.equal(response.status, 303);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    const location = new URL(response.headers.get("location") ?? "");
    assert.equal(location.searchParams.get("prompt"), null);
    assert.equal(location.searchParams.get("max_age"), null);
    assert.ok(location.searchParams.get("nonce"));
    assert.equal(location.searchParams.get("code_challenge_method"), "S256");
    assert.match(response.headers.get("set-cookie") ?? "", /akl_oidc_state=/);
    assert.doesNotMatch(response.headers.get("set-cookie") ?? "", /akl_session=/);
  });

  it("falls back once to interactive login when central SSO is absent", async () => {
    configureOidc();
    const state = createState("/chat", false, "silent");
    const response = await completeOidcCallback(
      new NextRequest(
        `https://stratos.example/akb/api/auth/callback?error=login_required&state=${encodeURIComponent(state)}`,
        { headers: { cookie: `akl_oidc_state=${state}; akl_oidc_pkce=verifier` } },
      ),
    );

    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get("location"),
      "https://stratos.example/akb/api/auth/login?return_to=%2Fchat&retry=required",
    );
  });

  it("rejects an error callback without matching state", async () => {
    configureOidc();
    const state = createState("/chat", false, "silent");
    const response = await completeOidcCallback(
      new NextRequest(
        `https://stratos.example/akb/api/auth/callback?error=login_required&state=${encodeURIComponent(state)}`,
        { headers: { cookie: "akl_oidc_state=other; akl_oidc_pkce=verifier" } },
      ),
    );

    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get("location"),
      "https://stratos.example/akb/api/auth/login?return_to=%2Fchat&retry=required",
    );
  });
});

function configureOidc() {
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
}
