import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { centralSessionPolicy } from "../src/lib/auth/session-policy";
import { verifiedSessionFromTokens } from "../src/lib/auth/oidc";
import { createServerSession, resolveServerSession, serverSessionCookieOptions, SERVER_SESSION_COOKIE, SSO_ATTEMPT_COOKIE, SSO_SIGNED_OUT_COOKIE } from "../src/lib/auth/server-session";
import { contextFromStratosAccessProjection } from "../src/lib/auth/access-projection";
import { GET as login } from "../src/app/api/auth/login/route";
import { GET as sso } from "../src/app/api/auth/sso/route";
import { isSameAppRscNavigation } from "../src/lib/auth/login-navigation";
import { identityFixture, managedConfig, managedEnv, SUBJECT } from "./helpers/managed-identity";
import nextConfig from "../next.config";

const DAY = 86_400_000;
const now = Date.UTC(2026, 7, 27, 10);
const env = { ...process.env };
const originalFetch = globalThis.fetch;
afterEach(() => { process.env = { ...env }; globalThis.fetch = originalFetch; });

describe("central SSO policy", () => {
  it("uses the central start, not application entry or step-up auth_time", () => {
    const start = (now - 60 * DAY) / 1000;
    const claims = { stratos_remember_device: true, stratos_session_started_at: start, auth_time: now / 1000 };
    const policy = centralSessionPolicy(claims, now);
    assert.equal(policy.sessionAbsoluteExpiresAt, now + 30 * DAY);
    assert.deepEqual(centralSessionPolicy({ ...claims, auth_time: (now + DAY) / 1000 }, now + DAY, policy), policy);
    assert.equal(serverSessionCookieOptions(managedConfig(), true, policy.sessionAbsoluteExpiresAt, now).maxAge, 30 * 86_400);
    assert.equal(centralSessionPolicy(claims, now + DAY).sessionAbsoluteExpiresAt, policy.sessionAbsoluteExpiresAt);
  });

  it("requires both typed policy claims and never invents a trusted device", () => {
    const cases = [
      [{}, "REMEMBER_CLAIM_MISSING"],
      [{ stratos_remember_device: "true" }, "REMEMBER_CLAIM_INVALID"],
      [{ stratos_remember_device: true }, "SESSION_START_MISSING"],
      [{ stratos_remember_device: true, stratos_session_started_at: "123" }, "SESSION_START_INVALID"],
      [{ stratos_remember_device: true, stratos_session_started_at: now / 1000 + 31 }, "SESSION_START_INVALID"],
      [{ stratos_remember_device: false, stratos_session_started_at: now / 1000 }, "CENTRAL_BROWSER_SESSION"],
    ] as const;
    for (const [claims, reason] of cases) {
      const policy = centralSessionPolicy(claims, now);
      assert.equal(policy.rememberDevice, false);
      assert.equal(policy.sessionAbsoluteExpiresAt, now + DAY);
      assert.equal(policy.sessionPolicyReason, reason);
    }
    const skewed = centralSessionPolicy({ stratos_remember_device: true, stratos_session_started_at: now / 1000 + 30 }, now);
    assert.equal(skewed.sessionAbsoluteExpiresAt, now + 90 * DAY);
  });

  it("does not revive an expired central session or extend a shorter BFF deadline", () => {
    for (const remember of [true, false]) {
      assert.throws(() => centralSessionPolicy({ stratos_remember_device: remember, stratos_session_started_at: (now - (remember ? 90 : 1) * DAY) / 1000 }, now), /EXPIRED/);
    }
    const start = now / 1000;
    const short = centralSessionPolicy({ stratos_remember_device: false, stratos_session_started_at: start }, now);
    const upgraded = centralSessionPolicy({ stratos_remember_device: true, stratos_session_started_at: start }, now + 1000, short);
    assert.equal(upgraded.sessionAbsoluteExpiresAt, short.sessionAbsoluteExpiresAt);
    assert.throws(() => centralSessionPolicy({ stratos_remember_device: true, stratos_session_started_at: start + 1 }, now + 1000, short), /START_CHANGED/);
    const long = centralSessionPolicy({ stratos_remember_device: true, stratos_session_started_at: start }, now);
    assert.throws(() => centralSessionPolicy({ stratos_remember_device: false, stratos_session_started_at: start }, now + 2 * DAY, long), /EXPIRED/);
  });

  for (const managed of [false, true]) {
    it(`verifies access/ID evidence separately in ${managed ? "managed" : "external Keycloak"} mode`, async () => {
      const config = managedConfig();
      config.oidc!.identityMode = managed ? "managed" : "external_oidc";
      const f = await identityFixture(now, { external: !managed });
      const valid = await f.tokens({ stratos_remember_device: true, stratos_session_started_at: (now - 20 * DAY) / 1000 });
      const session = await verifiedSessionFromTokens(config, valid, "test-nonce", now, f.fetcher);
      assert.equal(session.rememberDevice, true);
      assert.equal(session.sessionAbsoluteExpiresAt, now + 70 * DAY);
      for (const override of [{ aud: "wrong-api" }, { azp: "other-client" }, { sub: "" }]) {
        const tokens = await f.tokens(override);
        await assert.rejects(verifiedSessionFromTokens(config, tokens, "test-nonce", now, f.fetcher));
      }
      await assert.rejects(verifiedSessionFromTokens(config, valid, "wrong-nonce", now, f.fetcher));
      const foreign = await identityFixture(now);
      await assert.rejects(verifiedSessionFromTokens(config, await foreign.tokens(), "test-nonce", now, f.fetcher));
      if (!managed) {
        const noPolicy = await f.tokens({ stratos_remember_device: undefined, stratos_session_started_at: undefined });
        assert.equal((await verifiedSessionFromTokens(config, noPolicy, "test-nonce", now, f.fetcher)).rememberDevice, false);
        const malformed = await f.tokens({ stratos_remember_device: "true" });
        assert.equal((await verifiedSessionFromTokens(config, malformed, "test-nonce", now, f.fetcher)).sessionPolicyReason, "REMEMBER_CLAIM_INVALID");
      }
    });
  }
});

describe("central SSO redirect guard", () => {
  const rscHeaders = () => new Headers({
    rsc: "1",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
  });

  it("supports the configured no-referrer policy without weakening fetch metadata", async () => {
    const configuredHeaders = await nextConfig.headers!();
    assert.ok(configuredHeaders.some((entry) => entry.headers.some((header) =>
      header.key.toLowerCase() === "referrer-policy" && header.value === "no-referrer")));
    const headers = rscHeaders();
    assert.equal(headers.get("referer"), null);
    assert.equal(isSameAppRscNavigation(managedConfig(), headers), true);
    headers.set("referer", "https://akb.example/akb/documents/doc_test");
    assert.equal(isSameAppRscNavigation(managedConfig(), headers), true);
  });

  it("distinguishes an internal RSC refresh from a new application entry", () => {
    const config = managedConfig();
    assert.equal(isSameAppRscNavigation(config, rscHeaders()), true);
    const fullNavigation = rscHeaders();
    fullNavigation.set("sec-fetch-dest", "document");
    fullNavigation.set("sec-fetch-mode", "navigate");
    assert.equal(isSameAppRscNavigation(config, fullNavigation), false);
    for (const header of ["rsc", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"]) {
      const missing = rscHeaders();
      missing.delete(header);
      assert.equal(isSameAppRscNavigation(config, missing), false, header);
    }
  });

  it("does not treat sibling applications, foreign origins or opaque referrers as internal navigation", () => {
    const config = managedConfig();
    for (const referer of [
      "https://akb.example/project/",
      "https://akb.example/akb-other/",
      "https://akb.example/",
      "https://foreign.example/akb/chat",
      "https://akb.example.evil.invalid/akb/chat",
      "https://user@akb.example/akb/chat",
      "http://akb.example/akb/chat",
      "/akb/chat",
      "null",
      "",
    ]) {
      const headers = rscHeaders();
      headers.set("referer", referer);
      assert.equal(isSameAppRscNavigation(config, headers), false, referer);
    }
    for (const [name, value] of [["rsc", "0"], ["sec-fetch-site", "same-site"], ["sec-fetch-site", "cross-site"], ["sec-fetch-mode", "no-cors"], ["origin", "null"], ["origin", ""], ["origin", "https://foreign.example"]]) {
      const headers = rscHeaders();
      headers.set(name, value);
      assert.equal(isSameAppRscNavigation(config, headers), false, `${name}=${value}`);
    }
  });

  it("supports the standalone Chat root without widening its origin", () => {
    const config = managedConfig();
    config.oidc!.redirectUri = "https://chat.example/api/auth/callback";
    const headers = rscHeaders();
    assert.equal(isSameAppRscNavigation(config, headers), true);
    headers.set("referer", "https://chat.example/chat?thread=conv_test");
    headers.set("sec-fetch-mode", "same-origin");
    assert.equal(isSameAppRscNavigation(config, headers), true);
    headers.set("referer", "https://akb.example/akb/chat");
    assert.equal(isSameAppRscNavigation(config, headers), false);
  });

  it("never uses RSC metadata instead of a live session and current access projection", async () => {
    process.env = { ...managedEnv() };
    const config = managedConfig();
    const identity = await identityFixture();
    const state = { record: null as Record<string, unknown> | null, granted: true, unavailable: false };
    identity.state.handle = (url, init) => {
      if (url.includes("/internal/web-sessions")) {
        if (init?.method === "POST") {
          state.record = { ...JSON.parse(String(init.body)), session_id: "sess_rsc", revoked_at: null, created_at: new Date(identity.nowMs).toISOString(), updated_at: new Date(identity.nowMs).toISOString() };
          return Response.json(state.record, { status: 201 });
        }
        return state.record ? Response.json(state.record) : new Response(null, { status: 404 });
      }
      if (url.endsWith("/auth/me")) {
        if (state.unavailable) return new Response(null, { status: 503 });
        return Response.json({ id: SUBJECT, identitySubject: SUBJECT, tenantId: "org_stratos", applicationAccess: state.granted ? [{ application: "akb", capabilities: ["akb:access", "akb:read_document"], effectiveScopes: [] }] : [] });
      }
    };
    globalThis.fetch = identity.fetcher;
    const session = await verifiedSessionFromTokens(config, await identity.tokens(), "test-nonce", identity.nowMs, identity.fetcher);
    const selector = await createServerSession(config, session, false, identity.nowMs);
    const request = (withSession = true) => {
      const headers = rscHeaders();
      if (withSession) headers.set("cookie", `${SERVER_SESSION_COOKIE}=${selector}`);
      assert.equal(isSameAppRscNavigation(config, headers), true);
      return new NextRequest("https://akb.example/akb/documents/doc_test", { headers });
    };
    const context = async (request: NextRequest) => {
      const selector = request.cookies.get(SERVER_SESSION_COOKIE)?.value;
      if (!selector) return null;
      const resolved = await resolveServerSession(config, selector);
      return resolved?.oidc.accessToken ? contextFromStratosAccessProjection(resolved.oidc.accessToken, config) : null;
    };
    assert.equal(await context(request(false)), null);
    assert.equal((await context(request()))?.applicationAccessActive, true);
    state.granted = false;
    assert.equal((await context(request()))?.applicationAccessActive, false);
    state.unavailable = true;
    await assert.rejects(context(request()), /projection/i);
    state.record!.revoked_at = new Date().toISOString();
    assert.equal(await context(request()), null);
    state.record = null;
    assert.equal(await context(request()), null);
  });

  it("starts only once, does not force credentials, and preserves a signed-out visit", async () => {
    process.env = { ...managedEnv(), AKL_IDENTITY_MODE: "external_oidc" };
    const first = await login(new NextRequest("https://akb.example/akb/api/auth/login?return_to=/chat"));
    assert.equal(first.status, 303);
    const auth = new URL(first.headers.get("location")!);
    assert.equal(auth.searchParams.get("prompt"), null);
    assert.equal(auth.searchParams.get("max_age"), null);
    assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
    for (const cookie of [SSO_ATTEMPT_COOKIE, SSO_SIGNED_OUT_COOKIE]) {
      const page = await login(new NextRequest("https://akb.example/akb/api/auth/login", { headers: { cookie: `${cookie}=1` } }));
      assert.equal(page.status, 200);
      assert.doesNotMatch(await page.text(), /name="remember"|http-equiv="refresh"/);
      const blocked = await sso(new NextRequest("https://akb.example/akb/api/auth/sso", { headers: { cookie: `${cookie}=1` } }));
      assert.match(blocked.headers.get("location")!, /retry=required/);
    }
  });

  it("stops at a manual retry when discovery is unavailable without exposing the exception", async () => {
    process.env = { ...managedEnv() };
    globalThis.fetch = async () => { throw new Error("synthetic-private-upstream-detail"); };
    const first = await login(new NextRequest("https://akb.example/akb/api/auth/login"));
    const location = first.headers.get("location")!;
    assert.match(location, /retry=required/);
    const page = await login(new NextRequest(location));
    assert.equal(page.status, 200);
    assert.doesNotMatch(await page.text(), /synthetic-private/);
  });
});
