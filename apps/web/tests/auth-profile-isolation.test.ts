import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { NextRequest } from "next/server";
import { GET as login } from "../src/app/api/auth/login/route";
import { GET as callback } from "../src/app/api/auth/callback/route";
import { POST as logout } from "../src/app/api/auth/logout/route";
import { authCookieNames } from "../src/lib/auth/cookies";
import { managedEnv } from "./helpers/managed-identity";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
afterEach(() => { process.env = originalEnv; globalThis.fetch = originalFetch; });

for (const profile of ["platform", "chat"] as const) {
  const own = authCookieNames(profile);
  const other = authCookieNames(profile === "chat" ? "platform" : "chat");
  const base = profile === "chat" ? "http://localhost:3221" : "http://localhost:3220/akb";
  const configure = () => {
    process.env = { ...managedEnv(), AKL_IDENTITY_MODE: "external_oidc",
      AKL_WEB_PROFILE: profile, AKL_WEB_PUBLIC_BASE_URL: base,
      AKL_WEB_BASE_PATH: profile === "chat" ? "" : "/akb",
      AKL_WEB_OIDC_CLIENT_ID: profile === "chat" ? "akb-chat-web" : "akl-web" };
  };

  it(`${profile}: another profile's logout and in-flight OIDC cookies do not block login`, async () => {
    configure();
    const response = await login(new NextRequest(`${base}/api/auth/login`, {
      headers: { cookie: Object.values(other).map(name => `${name}=foreign`).join("; ") },
    }));
    assert.equal(response.status, 303);
    assert.ok(new URL(response.headers.get("location")!).searchParams.get("code_challenge"));
    assert.ok(response.cookies.get(own.state)?.value);
    assert.ok(response.cookies.get(own.pkce)?.value);
    for (const cookie of response.cookies.getAll()) assert.ok(Object.values(own).includes(cookie.name as typeof own.session));
  });

  it(`${profile}: own explicit logout still suppresses automatic login`, async () => {
    configure();
    const response = await login(new NextRequest(`${base}/api/auth/login`, {
      headers: { cookie: `${own.signedOut}=1` },
    }));
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Pokračovat k přihlášení/);
  });

  it(`${profile}: foreign callback state never exchanges a code or clears the other profile`, async () => {
    configure();
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error("must not contact identity or session store"); };
    const response = await callback(new NextRequest(`${base}/api/auth/callback?state=foreign&code=unused`, {
      headers: { cookie: `${other.state}=foreign; ${other.pkce}=verifier; ${other.session}=selector` },
    }));
    assert.equal(calls, 0);
    assert.match(response.headers.get("location")!, /retry=required/);
    for (const cookie of response.cookies.getAll()) assert.ok(Object.values(own).includes(cookie.name as typeof own.session));
  });

  it(`${profile}: logout neither reads nor revokes the other profile's selector`, async () => {
    configure();
    let storeCalls = 0;
    globalThis.fetch = async (input) => { if (String(input).includes("web-sessions")) storeCalls++; throw new Error("synthetic outage"); };
    const response = await logout(new NextRequest(`${base}/api/auth/logout`, {
      method: "POST", headers: { origin: new URL(base).origin, cookie: `${other.session}=${"a".repeat(43)}` },
    }));
    assert.equal(storeCalls, 0);
    assert.equal(response.status, 303);
    assert.equal(response.cookies.get(own.session)?.maxAge, 0);
    assert.equal(response.cookies.get(other.session), undefined);
    assert.equal(response.cookies.get(own.signedOut)?.value, "1");
  });
}
