import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AklConfig } from "../src/lib/api/config";
import {
  centralSsoSyncCookieOptions,
  createCentralSsoSyncMarker,
  createServerSession,
  hasCurrentCentralSsoSyncMarker,
  resolveServerSession,
  serverSessionCookieOptions,
} from "../src/lib/auth/server-session";

const config: AklConfig = {
  environment: "production",
  apiClientMode: "production",
  authMode: "oidc",
  serviceBaseUrls: {
    registry: "http://registry-api:8000/api/v1",
    ingestion: "http://ingestion",
    rag: "http://rag",
    governance: "http://governance",
    evaluation: "http://evaluation",
  },
  oidc: {
    issuer: "https://login.example/realms/stratos",
    clientId: "akl-web",
    redirectUri: "https://stratos.example/akb/api/auth/callback",
    scopes: "openid profile email",
    sessionSecret: "legacy-state-secret",
    sessionEncryptionKey: "test-session-encryption-key-that-is-long-enough",
    sessionStoreSecret: "test-session-store-secret-that-is-long-enough",
    sessionAbsoluteTtlMs: 90 * 86_400_000,
    sessionIdleTtlMs: 30 * 86_400_000,
    identityValidationIntervalMs: 15 * 60_000,
    stratosAuthMeUrl: "https://stratos.example/api/v1/auth/me",
    accessProjectionTimeoutMs: 3_000,
    accessProjectionCacheTtlMs: 0,
  },
};

describe("server-side OIDC session cookie", () => {
  it("creates a browser-session cookie without persistent expiry by default", () => {
    const options = serverSessionCookieOptions(config, false);
    assert.equal(options.httpOnly, true);
    assert.equal(options.secure, true);
    assert.equal(options.sameSite, "lax");
    assert.equal(options.path, "/akb");
    assert.equal("maxAge" in options, false);
  });

  it("bounds a trusted-device cookie to 90 days", () => {
    const options = serverSessionCookieOptions(config, true);
    assert.equal(options.maxAge, 90 * 24 * 60 * 60);
  });

  it("binds the short-lived central SSO marker to one server session", async () => {
    const selector = "a".repeat(43);
    const now = Date.UTC(2026, 7, 26, 8, 0, 0);
    const marker = await createCentralSsoSyncMarker(config, selector, now);

    assert.equal(
      await hasCurrentCentralSsoSyncMarker(config, selector, marker, now + 1_000),
      true,
    );
    assert.equal(
      await hasCurrentCentralSsoSyncMarker(config, "b".repeat(43), marker, now + 1_000),
      false,
    );
    assert.equal(
      await hasCurrentCentralSsoSyncMarker(config, selector, `${marker}x`, now + 1_000),
      false,
    );
    assert.equal(
      await hasCurrentCentralSsoSyncMarker(config, selector, marker, now + 6_000),
      false,
    );
    const options = centralSsoSyncCookieOptions(config);
    assert.equal(options.maxAge, 5);
    assert.equal(options.httpOnly, true);
  });

  it("stores tokens only in the encrypted server record and enforces 30/90 day bounds", async () => {
    const originalFetch = globalThis.fetch;
    const now = Date.UTC(2026, 7, 18, 8, 0, 0);
    let record: Record<string, unknown> | null = null;
    globalThis.fetch = async (_input, init) => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        record = {
          ...payload,
          session_id: "sess_test",
          revoked_at: null,
          revoked_reason: null,
          created_at: new Date(now).toISOString(),
          updated_at: new Date(now).toISOString(),
        };
        return Response.json(record, { status: 201 });
      }
      if (method === "GET") {
        return record ? Response.json(record) : new Response(null, { status: 404 });
      }
      if (method === "PATCH") {
        const patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
        record = { ...record, ...patch, updated_at: new Date(now + 1).toISOString() };
        return Response.json(record);
      }
      return new Response(null, { status: 405 });
    };

    try {
      const selector = await createServerSession(config, {
        accessToken: "access-token-must-not-reach-the-browser",
        refreshToken: "refresh-token-must-not-reach-the-browser",
        expiresAt: now + 60 * 60_000,
        subjectId: "user-123",
        keycloakSessionId: "kc-session-123",
        rememberDevice: true, centralSessionStartedAt: now / 1000, sessionPolicyReason: "CENTRAL_REMEMBER_DEVICE", sessionAbsoluteExpiresAt: now + 90 * 86_400_000,
        roles: [],
        groups: [],
      }, true, now);

      assert.match(selector, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(selector.includes("access-token"), false);
      if (!record) throw new Error("Server session was not persisted.");
      const stored: Record<string, unknown> = record;
      assert.match(String(stored.session_id_hash), /^[0-9a-f]{64}$/);
      assert.notEqual(stored.session_id_hash, selector);
      assert.equal(stored.idle_expires_at, new Date(now + 30 * 86_400_000).toISOString());
      assert.equal(stored.absolute_expires_at, new Date(now + 90 * 86_400_000).toISOString());
      assert.equal(String(stored.encrypted_payload).includes("access-token"), false);
      assert.equal(String(stored.encrypted_payload).includes("refresh-token"), false);
      assert.equal(await resolveServerSession(config, selector, now + 14 * 60_000).then((value) => value?.oidc.subjectId), "user-123");

      record = { ...stored, idle_expires_at: new Date(now - 1).toISOString() };
      assert.equal(await resolveServerSession(config, selector, now), null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects a server record bound to another issuer or client", async () => {
    const originalFetch = globalThis.fetch;
    const now = Date.UTC(2026, 7, 18, 8, 0, 0);
    let record: Record<string, unknown> | null = null;
    globalThis.fetch = async (_input, init) => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        record = {
          ...(JSON.parse(String(init?.body)) as Record<string, unknown>),
          session_id: "sess_test",
          revoked_at: null,
          revoked_reason: null,
          created_at: new Date(now).toISOString(),
          updated_at: new Date(now).toISOString(),
        };
        return Response.json(record, { status: 201 });
      }
      if (method === "GET") return Response.json(record);
      if (method === "PATCH") {
        record = { ...record, ...(JSON.parse(String(init?.body)) as Record<string, unknown>) };
        return Response.json(record);
      }
      return new Response(null, { status: 405 });
    };

    try {
      const selector = await createServerSession(config, {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: now + 60 * 60_000,
        subjectId: "user-123",
        roles: [],
        groups: [],
      }, false, now);
      record = { ...record!, issuer: "https://login.example/realms/other" };
      assert.equal(await resolveServerSession(config, selector, now + 1), null);
      assert.equal(record?.revoked_reason, "undecryptable");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("revokes the session when Keycloak rejects the required 15-minute validation", async () => {
    const originalFetch = globalThis.fetch;
    const now = Date.UTC(2026, 7, 18, 8, 0, 0);
    let record: Record<string, unknown> | null = null;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/protocol/openid-connect/token")) {
        return new Response(null, { status: 401 });
      }
      const method = init?.method ?? "GET";
      if (method === "POST") {
        record = {
          ...(JSON.parse(String(init?.body)) as Record<string, unknown>),
          session_id: "sess_identity_test",
          revoked_at: null,
          revoked_reason: null,
          created_at: new Date(now).toISOString(),
          updated_at: new Date(now).toISOString(),
        };
        return Response.json(record, { status: 201 });
      }
      if (method === "GET") return Response.json(record);
      if (method === "PATCH") {
        const patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
        record = {
          ...record,
          ...patch,
          ...(patch.revoked_reason
            ? { revoked_at: new Date(now + 15 * 60_000).toISOString() }
            : {}),
        };
        return Response.json(record);
      }
      return new Response(null, { status: 405 });
    };

    try {
      const selector = await createServerSession(config, {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: now + 60 * 60_000,
        subjectId: "disabled-user",
        rememberDevice: true, centralSessionStartedAt: now / 1000, sessionPolicyReason: "CENTRAL_REMEMBER_DEVICE", sessionAbsoluteExpiresAt: now + 90 * 86_400_000,
        roles: [],
        groups: [],
      }, true, now);

      assert.equal(await resolveServerSession(config, selector, now + 15 * 60_000), null);
      const finalRecord = record as Record<string, unknown> | null;
      assert.equal(finalRecord?.revoked_reason, "identity_invalid");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
