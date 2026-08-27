import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { identityFixture } from "./helpers/managed-identity";

import {
  buildAuthorizationUrl,
  buildPublicAppUrl,
  isAllowedAuthNavigationRequestOrigin,
  isAllowedPublicOrigin,
  contextFromOidcAccessToken,
  contextFromOidcSession,
  createState,
  getOrRefreshOidcSession,
  normalizeReturnToForPublicBase,
  parseState,
  refreshOidcSession,
  safeReturnToFromState,
  sessionFromTokens
} from "../src/lib/auth/oidc";

describe("OIDC web session", () => {
  it("extracts Keycloak roles and groups into API context", () => {
    const accessToken = jwt({
      sub: "user-123",
      preferred_username: "admin@example.test",
      realm_access: { roles: ["admin", "document_manager", "akl_admin"] },
      resource_access: { "akl-api": { roles: ["reader"] } },
      groups: ["STRATOS Administrators"]
    });

    const session = sessionFromTokens({ access_token: accessToken, expires_in: 600 }, 1_000);
    const context = contextFromOidcSession(session);

    assert.equal(context.subjectId, "user-123");
    assert.deepEqual(context.roles?.sort(), ["admin", "akl_admin", "document_manager", "reader"]);
    assert.deepEqual(context.groups, ["STRATOS Administrators"]);
    assert.equal(context.accessToken, accessToken);
  });

  it("extracts service identity from an OIDC bearer access token", () => {
    const accessToken = jwt({
      sub: "service-account-stratos-akb-service",
      client_id: "stratos-akb-service",
      exp: 3_600,
      realm_access: { roles: ["stratos_service"] },
      resource_access: { "akl-api": { roles: ["document_manager"] } },
      groups: ["STRATOS Services"]
    });

    const context = contextFromOidcAccessToken(accessToken, 1_000);

    assert.equal(context?.subjectId, "service-account-stratos-akb-service");
    assert.deepEqual(context?.roles?.sort(), ["document_manager", "stratos_service"]);
    assert.deepEqual(context?.groups, ["STRATOS Services"]);
    assert.equal(context?.accessToken, accessToken);
    assert.equal(contextFromOidcAccessToken("not-a-jwt", 1_000), null);
    assert.equal(contextFromOidcAccessToken(jwt({ sub: "expired", exp: 1 }), 2_000), null);
  });

  it("deduplicates refresh rotation and reuses the server-side access session", async () => {
    const config = testOidcConfig();
    const fixture = await identityFixture(60_000, { issuer: config.oidc.issuer, external: true, lifetime: 600 });
    const refreshedAccessToken = await fixture.sign({
      sub: "dedupe-user",
      aud: "akl-api",
      realm_access: { roles: ["reader"] }
    });
    const session = {
      ...sessionFromTokens(
        { access_token: jwt({ sub: "dedupe-user" }), refresh_token: "dedupe-refresh-old", expires_in: 600 },
        1_000
      ),
      accessToken: undefined
    };
    let refreshRequests = 0;
    fixture.state.handle = async (url) => {
      if (url !== fixture.discovery.token_endpoint) return undefined;
      refreshRequests += 1;
      return new Response(
        JSON.stringify({
          access_token: refreshedAccessToken,
          token_type: "Bearer",
          refresh_token: "dedupe-refresh-new",
          expires_in: 600
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const [first, second] = await Promise.all([
      getOrRefreshOidcSession(config, session, 60_000, fixture.fetcher),
      getOrRefreshOidcSession(config, session, 60_000, fixture.fetcher)
    ]);
    const fromRotatedCookie = await getOrRefreshOidcSession(
      config,
      { ...first!, accessToken: undefined },
      61_000,
      fixture.fetcher
    );

    assert.equal(refreshRequests, 1);
    assert.equal(first?.accessToken, refreshedAccessToken);
    assert.equal(second?.accessToken, refreshedAccessToken);
    assert.equal(fromRotatedCookie?.accessToken, refreshedAccessToken);
    assert.equal(fromRotatedCookie?.refreshToken, "dedupe-refresh-new");
  });

  it("refreshes a non-expired metadata session when the access token is absent", async () => {
    const config = testOidcConfig();
    const fixture = await identityFixture(60_000, { issuer: config.oidc.issuer, external: true, lifetime: 600 });
    const refreshedAccessToken = await fixture.sign({
      sub: "user-123",
      aud: "akl-api",
      realm_access: { roles: ["reader"] }
    });
    const session = {
      ...sessionFromTokens(
        { access_token: jwt({ sub: "user-123" }), refresh_token: "refresh-old", expires_in: 600 },
        1_000
      ),
      accessToken: undefined
    };

    fixture.state.handle = async (url) => url !== fixture.discovery.token_endpoint ? undefined : new Response(
        JSON.stringify({
          access_token: refreshedAccessToken,
          token_type: "Bearer",
          refresh_token: "refresh-new",
          expires_in: 600
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    const refreshed = await refreshOidcSession(config, session, 60_000, fixture.fetcher);

    assert.equal(refreshed?.accessToken, refreshedAccessToken);
    assert.equal(refreshed?.refreshToken, "refresh-new");
    assert.deepEqual(refreshed?.roles, ["reader"]);
  });

  it("refreshes an expired web session with the OIDC refresh token", async () => {
    const config = testOidcConfig();
    const fixture = await identityFixture(60_000, { issuer: config.oidc.issuer, external: true, lifetime: 600 });
    const refreshedAccessToken = await fixture.sign({
      sub: "user-123",
      aud: "akl-api",
      realm_access: { roles: ["reader"] },
      groups: ["employees"],
      name: "Demo User"
    });
    const session = sessionFromTokens(
      { access_token: jwt({ sub: "user-123", name: "Demo User" }), refresh_token: "refresh-old", expires_in: 30 },
      1_000
    );

    fixture.state.handle = async (url, init) => {
      if (url !== fixture.discovery.token_endpoint) return undefined;
      assert.equal(init?.method, "POST");
      const body = init?.body as URLSearchParams;
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("client_id"), "akl-web");
      assert.equal(body.get("refresh_token"), "refresh-old");
      return new Response(
        JSON.stringify({
          access_token: refreshedAccessToken,
          token_type: "Bearer",
          refresh_token: "refresh-new",
          expires_in: 600
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };
    const refreshed = await refreshOidcSession(config, session, 60_000, fixture.fetcher);

    assert.equal(refreshed?.accessToken, refreshedAccessToken);
    assert.equal(refreshed?.refreshToken, "refresh-new");
    assert.equal(refreshed?.expiresAt, 660_000);
    assert.equal(refreshed?.subjectId, "user-123");
    assert.deepEqual(refreshed?.roles, ["reader"]);
    assert.deepEqual(refreshed?.groups, ["employees"]);
    assert.equal(refreshed?.name, "Demo User");
  });

  it("builds post-login redirects from the configured public base URL", () => {
    const config = testOidcConfig();

    assert.equal(buildPublicAppUrl(config, "/"), "https://stratos.example/akb");
    assert.equal(buildPublicAppUrl(config, "/assistant"), "https://stratos.example/akb/assistant");
    assert.equal(
      buildPublicAppUrl(config, "/api/auth/login?return_to=%2F"),
      "https://stratos.example/akb/api/auth/login?return_to=%2F"
    );
  });

  it("validates state-changing requests against the configured public origin", () => {
    const config = testOidcConfig();
    assert.equal(isAllowedPublicOrigin(config, "https://stratos.example"), true);
    assert.equal(
      isAllowedPublicOrigin(config, "https://stratos.example:443"),
      true,
    );
    assert.equal(isAllowedPublicOrigin(config, "http://akl-web:3000"), false);
    assert.equal(isAllowedPublicOrigin(config, "https://attacker.example"), false);
    assert.equal(isAllowedPublicOrigin(config, null), false);
  });

  it("allows an opaque origin only for a same-origin document navigation", () => {
    const config = testOidcConfig();
    const headers = (values: Record<string, string>) => new Headers(values);

    assert.equal(
      isAllowedAuthNavigationRequestOrigin(
        config,
        headers({
          origin: "null",
          "sec-fetch-site": "same-origin",
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
        }),
      ),
      true,
    );
    assert.equal(
      isAllowedAuthNavigationRequestOrigin(
        config,
        headers({
          origin: "null",
          "sec-fetch-site": "cross-site",
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
        }),
      ),
      false,
    );
    assert.equal(
      isAllowedAuthNavigationRequestOrigin(
        config,
        headers({ origin: "null", "sec-fetch-site": "same-origin" }),
      ),
      false,
    );
  });

  it("falls back to a safe return path for malformed OIDC state", () => {
    const state = createState("/chat");

    assert.equal(safeReturnToFromState(state, "/"), "/chat");
    assert.equal(safeReturnToFromState("not-base64-json", "/"), "/");
    assert.equal(safeReturnToFromState(null, "/"), "/");
  });

  it("can parse old state but does not use it as session-policy evidence", () => {
    assert.equal(parseState(createState("/chat", true)).remember, true);
    assert.equal(parseState(createState("/chat")).remember, false);
    assert.equal(parseState(createState("/chat", false, "silent")).mode, "silent");
    assert.equal(parseState(createState("/chat")).mode, "interactive");
  });

  it("uses prompt=none only for silent STRATOS SSO", () => {
    const config = testOidcConfig();
    const silent = new URL(buildAuthorizationUrl(config, createState("/chat"), "verifier", "silent"));
    const interactive = new URL(buildAuthorizationUrl(config, createState("/chat"), "verifier"));

    assert.equal(silent.searchParams.get("prompt"), "none");
    assert.equal(interactive.searchParams.get("prompt"), null);
  });

  it("normalizes return paths against the configured public base path", () => {
    const config = testOidcConfig();

    assert.equal(normalizeReturnToForPublicBase(config, "/akb/dashboard"), "/dashboard");
    assert.equal(normalizeReturnToForPublicBase(config, "/akb"), "/");
    assert.equal(normalizeReturnToForPublicBase(config, "/dashboard"), "/dashboard");
    assert.equal(normalizeReturnToForPublicBase(config, "https://example.invalid"), "/");
  });
});

function testOidcConfig() {
  return {
    environment: "production",
    apiClientMode: "production",
    authMode: "oidc",
    serviceBaseUrls: {
      registry: "http://registry/api/v1",
      ingestion: "http://ingestion/api/v1",
      rag: "http://rag/api/v1",
      governance: "http://governance/api/v1",
      evaluation: "http://evaluation/api/v1"
    },
    oidc: {
      issuer: "https://login.example/realms/stratos",
      clientId: "akl-web",
      redirectUri: "https://stratos.example/akb/api/auth/callback",
      scopes: "openid profile email",
      sessionSecret: "test-secret",
      stratosAuthMeUrl: "https://stratos.example/api/v1/auth/me",
      accessProjectionTimeoutMs: 3_000,
      accessProjectionCacheTtlMs: 0
    }
  } as const;
}

function jwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    ""
  ].join(".");
}
