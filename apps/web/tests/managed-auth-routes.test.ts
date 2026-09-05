import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { GET as callback } from "../src/app/api/auth/callback/route";
import { GET as loginPage, POST as login } from "../src/app/api/auth/login/route";
import { POST as logout } from "../src/app/api/auth/logout/route";
import { createState, parseState } from "../src/lib/auth/oidc";
import { identityFixture, ISSUER, managedEnv } from "./helpers/managed-identity";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
afterEach(() => { process.env = { ...originalEnv }; globalThis.fetch = originalFetch; });

describe("managed browser auth routes", () => {
  it("delegates remember-device selection to STRATOS and rejects a foreign Origin", async () => {
    process.env = { ...managedEnv() };
    const page = await loginPage(new NextRequest("https://akb.example/akb/api/auth/login?retry=required"));
    assert.equal(page.status, 200);
    assert.doesNotMatch(await page.text(), /name="remember"/);
    const response = await login(new NextRequest("https://akb.example/akb/api/auth/login", { method: "POST", headers: { origin: "https://foreign.example" } }));
    assert.equal(response.status, 403);
    const deniedLogout = await logout(new NextRequest("https://akb.example/akb/api/auth/logout", { method: "POST", headers: { origin: "https://foreign.example" } }));
    assert.equal(deniedLogout.status, 403);
  });

  for (const remember of [false, true]) {
    it(`stores only an opaque scoped cookie using signed remember=${remember}`, async () => {
      process.env = { ...managedEnv() };
      const f = await identityFixture();
      const state = createState("/chat", !remember);
      let stored: Record<string, unknown> = {};
      f.state.handle = async (url, init) => {
        if (url === `${ISSUER}/token`) return Response.json(await f.tokens({ stratos_remember_device: remember }, parseState(state).nonce));
        if (url.endsWith("/internal/web-sessions")) {
          stored = JSON.parse(String(init?.body));
          return Response.json({}, { status: 201 });
        }
        return undefined;
      };
      globalThis.fetch = f.fetcher;
      const response = await callback(new NextRequest(`https://akb.example/akb/api/auth/callback?code=synthetic-code&state=${state}`, {
        headers: { cookie: `akl_oidc_state=${state}; akl_oidc_pkce=${"v".repeat(64)}` },
      }));
      assert.equal(response.status, 303);
      assert.equal(response.headers.get("location"), "https://akb.example/akb/chat");
      const cookie = response.cookies.get("akl_session")!;
      assert.match(cookie.value, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(cookie.httpOnly, true);
      assert.equal(cookie.secure, true);
      assert.equal(cookie.sameSite, "lax");
      assert.equal(cookie.path, "/akb");
      assert.equal(Boolean(cookie.maxAge), remember);
      assert.equal(stored.persistent, remember);
      assert.equal(response.cookies.get("akl_oidc_pkce")?.path, "/akb");
      assert.equal(response.cookies.get("akl_oidc_state")?.maxAge, 0);
      const output = JSON.stringify([...response.headers]);
      assert.equal(output.includes("synthetic-refresh-token"), false);
      assert.equal(output.includes("encrypted_payload"), false);
    });
  }

  it("fails closed on a bad ID nonce without creating a session", async () => {
    process.env = { ...managedEnv() };
    const f = await identityFixture();
    const state = createState("/chat");
    globalThis.fetch = f.fetcher;
    const response = await callback(new NextRequest(`https://akb.example/akb/api/auth/callback?code=synthetic-code&state=${state}`, {
      headers: { cookie: `akl_oidc_state=${state}; akl_oidc_pkce=${"v".repeat(64)}` },
    }));
    assert.match(response.headers.get("location") ?? "", /\/api\/auth\/login\?/);
    assert.equal(f.requests.some((request) => request.url.includes("/web-sessions")), false);
    assert.equal(response.cookies.get("akl_session")?.path, "/akb");
    assert.equal(response.cookies.get("akl_session")?.maxAge, 0);
  });

  it("does not silently recreate a missing or revoked application session", async () => {
    process.env = { ...managedEnv() };
    const f = await identityFixture();
    const state = createState("/chat", false, "silent");
    f.state.handle = async (url) => {
      if (url === `${ISSUER}/token`) return Response.json(await f.tokens({}, parseState(state).nonce));
      if (url.includes("/internal/web-sessions")) return new Response(null, { status: 404 });
      return undefined;
    };
    globalThis.fetch = f.fetcher;
    const response = await callback(new NextRequest(`https://akb.example/akb/api/auth/callback?code=synthetic-code&state=${state}`, {
      headers: { cookie: `akl_oidc_state=${state}; akl_oidc_pkce=${"v".repeat(64)}; akl_session=${"a".repeat(43)}` },
    }));
    assert.match(response.headers.get("location") ?? "", /retry=required/);
    assert.equal(response.cookies.get("akl_session")?.maxAge, 0);
    assert.equal(f.requests.some((entry) => entry.url.endsWith("/internal/web-sessions") && entry.init?.method === "POST"), false);
  });

  it("clears the scoped cookie after local revocation even when the issuer is down", async () => {
    process.env = { ...managedEnv() };
    const methods: string[] = [];
    globalThis.fetch = async (input, init) => {
      if (!String(input).includes("/internal/web-sessions/")) throw new Error("synthetic-issuer-outage");
      methods.push(init?.method ?? "GET");
      if (init?.method === "GET") return new Response(null, { status: 404 });
      assert.equal(JSON.parse(String(init?.body)).revoked_reason, "logout");
      return Response.json({ revoked_at: "synthetic" });
    };
    const response = await logout(new NextRequest("https://akb.example/akb/api/auth/logout", {
      method: "POST", headers: { origin: "https://akb.example", cookie: `akl_session=${"a".repeat(43)}` },
    }));
    assert.equal(response.status, 303);
    assert.deepEqual(methods, ["GET", "PATCH"]);
    assert.equal(response.cookies.get("akl_session")?.maxAge, 0);
    assert.equal(response.cookies.get("akl_session")?.path, "/akb");
  });

  it("does not report successful logout when the local session store cannot revoke", async () => {
    process.env = { ...managedEnv() };
    globalThis.fetch = async () => new Response(null, { status: 503 });
    const response = await logout(new NextRequest("https://akb.example/akb/api/auth/logout", {
      method: "POST", headers: { origin: "https://akb.example", cookie: `akl_session=${"a".repeat(43)}` },
    }));
    assert.equal(response.status, 503);
    assert.equal(response.cookies.get("akl_session"), undefined);
    assert.equal((await response.json()).error.code, "SESSION_REVOCATION_UNAVAILABLE");
  });
});
