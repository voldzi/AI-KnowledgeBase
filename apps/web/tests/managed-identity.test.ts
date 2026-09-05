import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateKeyPair, SignJWT } from "jose";

import { managedDiscovery, verifyManagedUserToken, verifyManagedServiceToken, identityJson } from "../src/lib/auth/managed-oidc";
import { contextFromStratosAccessProjection } from "../src/lib/auth/access-projection";
import { createState, exchangeAuthorizationCode, parseState, refreshOidcSession, resolveAuthorizationUrl, resolveLogoutUrl, revokeOidcRefreshToken, verifiedSessionFromTokens } from "../src/lib/auth/oidc";
import { directorCopilotServiceToken, resetDirectorCopilotServiceTokenCacheForTests } from "../src/lib/director-copilot/service-identity";
import { getDirectorCopilotConfig } from "../src/lib/api/config";
import { identityFixture, ISSUER, managedConfig, OTHER_SUBJECT, SUBJECT } from "./helpers/managed-identity";

describe("managed identity trust boundary", () => {
  it("discovers public PKCE endpoints and never transmits an old client secret", async () => {
    const f = await identityFixture();
    const config = managedConfig();
    const state = createState("/chat", true);
    const url = new URL(await resolveAuthorizationUrl(config, state, "v".repeat(64), "interactive", f.fetcher));
    assert.equal(url.origin + url.pathname, `${ISSUER}/auth`);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("nonce"), parseState(state).nonce);
    assert.equal(url.searchParams.get("scope"), "openid profile email");
    await exchangeAuthorizationCode(config, "synthetic-code", "v".repeat(64), f.fetcher);
    const request = f.requests.find((entry) => entry.url === `${ISSUER}/token`)!;
    const body = new URLSearchParams(String(request.init?.body));
    assert.equal(body.has("client_secret"), false);
    assert.equal(body.get("client_id"), "akl-web");
    assert.equal(request.init?.redirect, "error");
    assert.equal(request.init?.cache, "no-store");
    assert.equal(request.init?.opentelemetry?.ignore, true);
    await assert.rejects(exchangeAuthorizationCode(config, "code", undefined, f.fetcher));
    assert.match(await resolveLogoutUrl(config, f.fetcher), /\/identity\/session\/end\?/);
  });

  it("verifies access and ID token independently including nonce and signed remember flag", async () => {
    const f = await identityFixture();
    const tokens = await f.tokens({ stratos_remember_device: true });
    const session = await verifiedSessionFromTokens(managedConfig(), tokens, "test-nonce", f.nowMs, f.fetcher);
    assert.equal(session.subjectId, SUBJECT);
    assert.equal(session.rememberDevice, true);
    assert.deepEqual(session.roles, []);
    assert.deepEqual(session.groups, []);
    await assert.rejects(verifiedSessionFromTokens(managedConfig(), tokens, "wrong-nonce", f.nowMs, f.fetcher));
    await assert.rejects(verifiedSessionFromTokens(managedConfig(), { ...tokens, id_token: tokens.access_token }, "test-nonce", f.nowMs, f.fetcher));
    await assert.rejects(verifiedSessionFromTokens(managedConfig(), { ...tokens, access_token: tokens.id_token }, "test-nonce", f.nowMs, f.fetcher));
    await assert.rejects(verifiedSessionFromTokens(managedConfig(), { ...tokens, refresh_token: undefined }, "test-nonce", f.nowMs, f.fetcher));
  });

  it("rejects mixed audiences, foreign roles, malformed subjects and unsigned remember preferences", async () => {
    const f = await identityFixture();
    const invalid = [
      { aud: ["akl-api"] }, { aud: ["akl-api", "stratos-access-api", "budget-api"] },
      { aud: ["akl-api", "akl-api"] }, { sub: "same-login" }, { sub: SUBJECT.toUpperCase().replace("1111", "ABCD") },
      { stratos_roles: ["stratos_user", "admin"] }, { realm_access: {} }, { resource_access: {} },
      { stratos_service: false }, { stratos_service_roles: [] }, { roles: [] }, { role: "reader" },
      { identity_source: "" }, { identity_audience: "other" }, { identity_audience: ["employees"] }, { stratos_remember_device: "true" },
    ];
    for (const override of invalid) {
      await assert.rejects(verifyManagedUserToken(managedConfig(), await f.sign({ ...f.claims, ...override }), f.fetcher, f.nowMs), Object.keys(override).join(","));
    }
    await assert.rejects(verifyManagedUserToken(managedConfig(), (await f.tokens()).access_token, f.fetcher, f.nowMs + 301_000));
  });

  it("rejects a foreign signature, unknown key, issuer mismatch and tampered JWT", async () => {
    const f = await identityFixture();
    const other = await generateKeyPair("RS256");
    const foreign = await new SignJWT(f.claims).setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(ISSUER).setIssuedAt().setExpirationTime("5m").sign(other.privateKey);
    await assert.rejects(verifyManagedUserToken(managedConfig(), foreign, f.fetcher));
    const valid = (await f.tokens()).access_token;
    await assert.rejects(verifyManagedUserToken(managedConfig(), `${valid.slice(0, -20)}${"a".repeat(20)}`, f.fetcher));
    const unapproved = managedConfig();
    unapproved.oidc!.managedIssuer = "https://other.example/identity";
    await assert.rejects(verifyManagedUserToken(unapproved, valid, f.fetcher));
  });

  it("rejects discovery redirects, foreign endpoints, malformed JSON and oversized responses", async () => {
    const config = managedConfig();
    const f = await identityFixture();
    f.discovery.token_endpoint = "https://evil.example/token";
    await assert.rejects(managedDiscovery(config, f.fetcher));
    for (const response of [new Response(null, { status: 302, headers: { Location: "https://evil.example" } }), new Response("secret-response-not-json"), new Response("x".repeat(70_000))]) {
      await assert.rejects(identityJson(`${ISSUER}/token`, {}, async () => response), (error: Error) => error.message === "OIDC_ENDPOINT_UNAVAILABLE_OR_INVALID");
    }
  });

  it("does not merge two directory identities sharing login and email", async () => {
    const f = await identityFixture();
    const a = await verifiedSessionFromTokens(managedConfig(), await f.tokens(), "test-nonce", f.nowMs, f.fetcher);
    const b = await verifiedSessionFromTokens(managedConfig(), await f.tokens({ sub: OTHER_SUBJECT, identity_source: "directory-b" }), "test-nonce", f.nowMs, f.fetcher);
    assert.equal(a.email, b.email);
    assert.notEqual(a.subjectId, b.subjectId);
    assert.notEqual(a.identitySource, b.identitySource);
  });
});

describe("managed identity authorization and lifecycle", () => {
  it("reauthorizes every call and denies group/grant removal without static claims fallback", async () => {
    const f = await identityFixture();
    const config = managedConfig();
    config.oidc!.accessProjectionCacheTtlMs = 60_000;
    const token = (await f.tokens()).access_token;
    const first = await contextFromStratosAccessProjection(token, config, f.fetcher, f.nowMs);
    assert.equal(first.applicationAccessActive, true);
    assert.ok(first.scopes?.includes("recipient_set:employee-directives"));
    f.state.handle = (url) => url.endsWith("/auth/me") ? Response.json({ id: SUBJECT, tenantId: "org_stratos", applicationAccess: [] }) : undefined;
    const revoked = await contextFromStratosAccessProjection(token, config, f.fetcher, f.nowMs + 1);
    assert.equal(revoked.applicationAccessActive, false);
    assert.deepEqual(revoked.capabilities, []);
    assert.equal(f.requests.filter((entry) => entry.url.endsWith("/auth/me")).length, 2);
  });

  it("rejects an external employee-directives grant, different subject, inactive account and unavailable projection", async () => {
    const f = await identityFixture();
    const external = (await f.tokens({ identity_audience: "external" })).access_token;
    await assert.rejects(contextFromStratosAccessProjection(external, managedConfig(), f.fetcher, f.nowMs));
    const token = (await f.tokens()).access_token;
    for (const response of [Response.json({ id: OTHER_SUBJECT, applicationAccess: [] }), Response.json({ id: SUBJECT, isActive: false, applicationAccess: [] }), Response.json({ error: "synthetic-private-error" }, { status: 503 })]) {
      f.state.handle = (url) => url.endsWith("/auth/me") ? response : undefined;
      await assert.rejects(contextFromStratosAccessProjection(token, managedConfig(), f.fetcher, f.nowMs));
    }
    f.state.handle = (url) => url.endsWith("/auth/me") ? Response.json({ id: SUBJECT, tenantId: "org_stratos", applicationAccess: [{ application: "akb", capabilities: ["akb:chat"], effectiveScopes: [{ type: "public", id: "public" }] }] }) : undefined;
    assert.equal((await contextFromStratosAccessProjection(external, managedConfig(), f.fetcher, f.nowMs)).applicationAccessActive, true);
  });

  it("refreshes public clients, verifies userinfo and rejects identity changes or a directory outage", async () => {
    const f = await identityFixture();
    const config = managedConfig();
    const session = await verifiedSessionFromTokens(config, await f.tokens(), "test-nonce", f.nowMs, f.fetcher);
    const refresh = () => refreshOidcSession(config, { ...session, accessToken: undefined }, f.nowMs, f.fetcher);
    assert.equal((await refresh())?.subjectId, SUBJECT);
    const request = f.requests.find((entry) => entry.url === `${ISSUER}/token`)!;
    assert.equal(new URLSearchParams(String(request.init?.body)).has("client_secret"), false);
    await revokeOidcRefreshToken(config, session, f.fetcher);
    const revoke = f.requests.find((entry) => entry.url.endsWith("/revocation"))!;
    assert.equal(new URLSearchParams(String(revoke.init?.body)).has("client_secret"), false);
    f.state.handle = (url) => url.endsWith("/userinfo") ? Response.json({ sub: OTHER_SUBJECT }) : undefined;
    assert.equal(await refresh(), null);
    f.state.handle = async (url) => url === `${ISSUER}/token` ? Response.json(await f.tokens({ identity_source: "other-directory" })) : undefined;
    assert.equal(await refresh(), null);
    f.state.handle = (url) => url === `${ISSUER}/token` ? new Response(null, { status: 503 }) : undefined;
    assert.equal(await refresh(), null);
    assert.equal(await refreshOidcSession(config, { ...session, identityClientId: "other-client" }, f.nowMs, f.fetcher), null);
  });
});

describe("separate managed Director clients", () => {
  it("obtains and verifies three single-audience credentials without sending legacy secrets", async () => {
    resetDirectorCopilotServiceTokenCacheForTests();
    const f = await identityFixture();
    const config = managedConfig();
    config.directorCopilot = { ...getDirectorCopilotConfig(config), enabled: true, managedIssuer: ISSUER, managedClients: {
      "budget-api": { clientId: "svc-akb-director-copilot-budget", clientSecret: "synthetic-budget" },
      "projectflow-api": { clientId: "svc-akb-director-copilot-projectflow", clientSecret: "synthetic-projectflow" },
      "archflow-api": { clientId: "svc-akb-director-copilot-archflow", clientSecret: "synthetic-archflow" },
    } };
    f.state.handle = async (url, init) => {
      if (url !== `${ISSUER}/token`) return undefined;
      const form = new URLSearchParams(String(init?.body));
      const id = form.get("client_id")!;
      const audience = `${id.split("-").at(-1)}-api`;
      assert.equal(form.get("scope"), "director-copilot:read");
      assert.equal(form.get("client_secret"), `synthetic-${id.split("-").at(-1)}`);
      return Response.json({ token_type: "Bearer", access_token: await f.sign({ sub: `service:${id}`, client_id: id, aud: audience, stratos_service: true, scope: "director-copilot:read" }) });
    };
    for (const audience of ["budget-api", "projectflow-api", "archflow-api"] as const) {
      const target = { audience, scope: `director-copilot-${audience}` as const };
      const token = await directorCopilotServiceToken(config, f.fetcher, target);
      await verifyManagedServiceToken(config, token, audience, config.directorCopilot.managedClients![audience].clientId, f.fetcher);
      assert.equal(await directorCopilotServiceToken(config, f.fetcher, target), token);
    }
    assert.equal(f.requests.filter((entry) => entry.url === `${ISSUER}/token`).length, 3);
    await assert.rejects(directorCopilotServiceToken(config, f.fetcher, { audience: "akl-api", scope: "director-copilot-akl-api" }));
  });

  it("rejects human roles, broad scope, wrong client and extra audience in service tokens", async () => {
    const f = await identityFixture();
    const id = "svc-akb-director-copilot-budget";
    const base = { sub: `service:${id}`, client_id: id, aud: "budget-api", stratos_service: true, scope: "director-copilot:read" };
    for (const override of [{ stratos_service: false }, { client_id: "other" }, { scope: "director-copilot:read admin" }, { aud: ["budget-api", "akl-api"] }, { stratos_roles: [] }, { realm_access: {} }, { email: "person@example.invalid" }, { stratos_service_roles: [] }]) {
      await assert.rejects(verifyManagedServiceToken(managedConfig(), await f.sign({ ...base, ...override }), "budget-api", id, f.fetcher));
    }
  });
});
