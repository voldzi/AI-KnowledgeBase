import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPublicAppUrl,
  contextFromOidcAccessToken,
  contextFromOidcSession,
  createState,
  normalizeReturnToForPublicBase,
  OIDC_ACCESS_COOKIE,
  OIDC_REFRESH_COOKIE,
  OIDC_SESSION_COOKIE,
  openSession,
  readSessionCookie,
  refreshOidcSession,
  safeReturnToFromState,
  sealAccessToken,
  sealBrowserSession,
  sealRefreshToken,
  sealSession,
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

  it("seals and opens a session cookie payload", () => {
    const session = sessionFromTokens(
      { access_token: jwt({ sub: "user-123" }), refresh_token: "refresh-token", expires_in: 600 },
      1_000
    );
    const sealed = sealSession(session, "test-secret");
    const opened = openSession(sealed, "test-secret", 2_000);

    assert.equal(opened?.accessToken, session.accessToken);
    assert.equal(opened?.refreshToken, "refresh-token");
    assert.equal(opened?.expiresAt, session.expiresAt);
    assert.equal(opened?.subjectId, session.subjectId);
    assert.deepEqual(opened?.roles, []);
    assert.deepEqual(opened?.groups, []);
    assert.equal(openSession(sealed, "wrong-secret", 2_000), null);
    assert.equal(openSession(sealed, "test-secret", session.expiresAt + 1), null);
    assert.equal(openSession(sealed, "test-secret", session.expiresAt + 1, { allowExpired: true })?.subjectId, "user-123");
  });

  it("keeps tokens out of the metadata session cookie and restores encrypted token cookies", () => {
    const config = testOidcConfig();
    const accessToken = jwt({ sub: "user-123" });
    const session = sessionFromTokens(
      { access_token: accessToken, refresh_token: "refresh-token", expires_in: 600 },
      1_000
    );
    const browserSession = sealBrowserSession(session, "test-secret");
    const accessCookie = sealAccessToken(accessToken, "test-secret");
    const refreshCookie = sealRefreshToken("refresh-token", "test-secret");
    const opened = openSession(browserSession, "test-secret", 2_000);
    const read = readSessionCookie(
      {
        get: (name: string) =>
          ({
            [OIDC_SESSION_COOKIE]: { value: browserSession },
            [OIDC_ACCESS_COOKIE]: { value: accessCookie },
            [OIDC_REFRESH_COOKIE]: { value: refreshCookie }
          })[name]
      },
      config,
      2_000
    );

    assert.equal(opened?.accessToken, undefined);
    assert.equal(opened?.refreshToken, undefined);
    assert.equal(read?.accessToken, accessToken);
    assert.equal(read?.refreshToken, "refresh-token");
  });

  it("refreshes a non-expired metadata session when the access token is absent", async () => {
    const config = testOidcConfig();
    const refreshedAccessToken = jwt({
      sub: "user-123",
      realm_access: { roles: ["reader"] }
    });
    const session = {
      ...sessionFromTokens(
        { access_token: jwt({ sub: "user-123" }), refresh_token: "refresh-old", expires_in: 600 },
        1_000
      ),
      accessToken: undefined
    };

    const refreshed = await refreshOidcSession(config, session, 60_000, async () =>
      new Response(
        JSON.stringify({
          access_token: refreshedAccessToken,
          refresh_token: "refresh-new",
          expires_in: 600
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    assert.equal(refreshed?.accessToken, refreshedAccessToken);
    assert.equal(refreshed?.refreshToken, "refresh-new");
    assert.deepEqual(refreshed?.roles, ["reader"]);
  });

  it("refreshes an expired web session with the OIDC refresh token", async () => {
    const config = testOidcConfig();
    const refreshedAccessToken = jwt({
      sub: "user-123",
      realm_access: { roles: ["reader"] },
      groups: ["employees"],
      name: "Demo User"
    });
    const session = sessionFromTokens(
      { access_token: jwt({ sub: "user-123", name: "Demo User" }), refresh_token: "refresh-old", expires_in: 30 },
      1_000
    );

    const refreshed = await refreshOidcSession(config, session, 60_000, async (input, init) => {
      assert.equal(String(input), "https://login.example/realms/stratos/protocol/openid-connect/token");
      assert.equal(init?.method, "POST");
      const body = init?.body as URLSearchParams;
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("client_id"), "akl-web");
      assert.equal(body.get("refresh_token"), "refresh-old");
      return new Response(
        JSON.stringify({
          access_token: refreshedAccessToken,
          refresh_token: "refresh-new",
          expires_in: 600
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });

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

  it("falls back to a safe return path for malformed OIDC state", () => {
    const state = createState("/chat");

    assert.equal(safeReturnToFromState(state, "/"), "/chat");
    assert.equal(safeReturnToFromState("not-base64-json", "/"), "/");
    assert.equal(safeReturnToFromState(null, "/"), "/");
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
      governance: "http://governance/api/v1"
    },
    oidc: {
      issuer: "https://login.example/realms/stratos",
      clientId: "akl-web",
      redirectUri: "https://stratos.example/akb/api/auth/callback",
      scopes: "openid profile email",
      sessionSecret: "test-secret"
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
