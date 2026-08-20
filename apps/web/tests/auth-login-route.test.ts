import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { NextRequest } from "next/server";

import { GET, POST } from "../src/app/api/auth/login/route";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("OIDC login page", () => {
  it("posts to the public AKB base path instead of the rewritten Next.js route", async () => {
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

    const response = await GET(
      new NextRequest("https://stratos.example/api/auth/login?return_to=%2Fchat"),
    );
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(
      html,
      /<form method="post" action="https:\/\/stratos\.example\/akb\/api\/auth\/login">/,
    );
    assert.match(html, /name="remember"/);
    assert.doesNotMatch(html, /name="remember"[^>]*checked/);
    assert.equal(
      response.headers.get("content-security-policy"),
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://login.example; base-uri 'none'; frame-ancestors 'none'",
    );
    assert.doesNotMatch(
      response.headers.get("content-security-policy") ?? "",
      /attacker\.example/,
    );
  });

  it("accepts the configured public origin behind a reverse proxy", async () => {
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
      AKL_WEB_STRATOS_AUTH_ME_URL: "https://stratos.example/api/v1/auth/me",
    });

    const response = await POST(
      new NextRequest("http://akl-web:3000/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://stratos.example",
        },
        body: "return_to=%2Fchat",
      }),
    );

    assert.equal(response.status, 307);
    const location = new URL(response.headers.get("location") ?? "");
    assert.equal(
      location.origin + location.pathname,
      "https://login.example/realms/stratos/protocol/openid-connect/auth",
    );
    assert.equal(location.searchParams.get("max_age"), null);
    assert.equal(location.searchParams.get("prompt"), "login");
    assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  });

  it("accepts an opaque origin from a same-origin document navigation", async () => {
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
      AKL_WEB_STRATOS_AUTH_ME_URL: "https://stratos.example/api/v1/auth/me",
    });

    const response = await POST(
      new NextRequest("http://akl-web:3000/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "null",
          "sec-fetch-site": "same-origin",
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
        },
        body: "return_to=%2Fchat",
      }),
    );

    assert.equal(response.status, 307);
  });

  it("rejects an opaque origin without same-origin navigation metadata", async () => {
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
      AKL_WEB_STRATOS_AUTH_ME_URL: "https://stratos.example/api/v1/auth/me",
    });

    const response = await POST(
      new NextRequest("http://akl-web:3000/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "null",
          "sec-fetch-site": "cross-site",
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
        },
        body: "return_to=%2Fchat",
      }),
    );

    assert.equal(response.status, 403);
  });

  it("rejects a foreign origin", async () => {
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
      AKL_WEB_STRATOS_AUTH_ME_URL: "https://stratos.example/api/v1/auth/me",
    });

    const response = await POST(
      new NextRequest("http://akl-web:3000/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://attacker.example",
        },
        body: "return_to=%2Fchat",
      }),
    );

    assert.equal(response.status, 403);
  });
});
