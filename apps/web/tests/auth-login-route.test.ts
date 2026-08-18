import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { NextRequest } from "next/server";

import { GET } from "../src/app/api/auth/login/route";

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
  });
});
