import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import type { AklConfig } from "../src/lib/api/config";
import { contextFromStratosAccessProjection, resetAccessProjectionCacheForTests } from "../src/lib/auth/access-projection";
import { ApiClientError } from "../src/lib/types";

const NOW = 1_000_000;

describe("STRATOS access projection", () => {
  beforeEach(() => resetAccessProjectionCacheForTests());

  it("forwards a read-only session probe to the central authority", async () => {
    let probe: string | null = null;
    await contextFromStratosAccessProjection(jwt({ sub: "user-123", exp: 2_000 }), config(), async (_url, init) => {
      probe = new Headers(init?.headers).get("X-STRATOS-Session-Probe");
      return Response.json(projection([]));
    }, NOW, true, true);
    assert.equal(probe, "1");
  });

  it("preserves explicit application grants separately from the effective closure", async () => {
    const token = jwt({
      sub: "user-123",
      exp: 2_000,
      realm_access: { roles: ["admin"] },
      stratos_access: { capabilities: ["akb:manage_access"], scopes: ["organization"] },
    });
    const context = await contextFromStratosAccessProjection(
      token,
      config(),
      async () => Response.json(projection([{
          applicationId: "akb",
          entitlementId: "grant-akb-chat",
          capabilities: ["akb:chat"],
          scopes: [{ type: "project", id: "inactive-or-orphaned" }],
          effectiveScopes: [{ type: "organization", id: "org_stratos" }],
        }, {
          applicationId: "budget",
          entitlementId: "grant-budget-read",
          capabilities: ["budget:read"],
          scopes: [{ type: "project", id: "raw-and-untrusted" }],
          effectiveScopes: [{ type: "project", id: "project-001" }],
        }])),
      NOW,
    );

    assert.equal(context.subjectId, "user-123");
    assert.deepEqual(context.roles, []);
    assert.deepEqual(context.groups, []);
    assert.deepEqual(context.capabilities, ["akb:chat"]);
    assert.deepEqual(context.scopes, ["organization:org_stratos"]);
    assert.deepEqual(context.applicationAccess, [{
      application: "akb",
      entitlementId: "grant-akb-chat",
      profileId: null,
      source: "MANUAL",
      virtual: false,
      capabilities: ["akb:chat"],
      scopes: ["project:inactive-or-orphaned"],
      effectiveScopes: ["organization:org_stratos"],
      validUntil: null,
    }, {
      application: "budget",
      entitlementId: "grant-budget-read",
      profileId: null,
      source: "MANUAL",
      virtual: false,
      capabilities: ["budget:read"],
      scopes: ["project:raw-and-untrusted"],
      effectiveScopes: ["project:project-001"],
      validUntil: null,
    }]);
    assert.equal(context.authorizationSource, "stratos_projection");
    assert.equal(context.applicationAccessActive, true);
  });

  it("denies immediately after AKB application access disappears", async () => {
    const token = jwt({ sub: "user-123", exp: 2_000 });
    let active = true;
    const fetcher: typeof fetch = async () => Response.json(projection(active
      ? [{ applicationId: "akb", entitlementId: "grant-chat", capabilities: ["akb:chat"], scopes: [{ type: "public" }], effectiveScopes: [{ type: "public" }] }]
      : []));

    const first = await contextFromStratosAccessProjection(token, config(), fetcher, NOW);
    active = false;
    const second = await contextFromStratosAccessProjection(token, config(), fetcher, NOW + 1);

    assert.equal(first.applicationAccessActive, true);
    assert.equal(second.applicationAccessActive, false);
    assert.deepEqual(second.capabilities, []);
  });

  it("bypasses the projection cache for pre-synthesis reauthorization", async () => {
    const token = jwt({ sub: "user-123", exp: 2_000 });
    const cachedConfig = config();
    cachedConfig.oidc!.accessProjectionCacheTtlMs = 60_000;
    let active = true;
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      return Response.json(projection(active
        ? [{ applicationId: "akb", entitlementId: "grant-chat", capabilities: ["akb:chat"], scopes: [{ type: "public" }], effectiveScopes: [{ type: "public" }] }]
        : []));
    };

    const first = await contextFromStratosAccessProjection(token, cachedConfig, fetcher, NOW);
    active = false;
    const cached = await contextFromStratosAccessProjection(token, cachedConfig, fetcher, NOW + 1);
    const refreshed = await contextFromStratosAccessProjection(token, cachedConfig, fetcher, NOW + 2, true);

    assert.equal(first.applicationAccessActive, true);
    assert.equal(cached.applicationAccessActive, true);
    assert.equal(refreshed.applicationAccessActive, false);
    assert.equal(calls, 2);
  });

  it("never falls back to raw administrative scope grants", async () => {
    const token = jwt({ sub: "user-123", exp: 2_000 });
    const context = await contextFromStratosAccessProjection(
      token,
      config(),
      async () => Response.json(projection([{
          applicationId: "akb",
          entitlementId: "grant-read",
          capabilities: ["akb:read_document"],
          scopes: [{ type: "organization", id: "org_stratos" }],
          effectiveScopes: [{ type: "public" }],
        }])),
      NOW,
    );

    assert.deepEqual(context.scopes, ["public"]);
    assert.equal(context.applicationAccessActive, true);
  });

  it("fails closed when projection is unavailable or malformed", async () => {
    const token = jwt({ sub: "user-123", exp: 2_000 });
    await assert.rejects(
      () => contextFromStratosAccessProjection(token, config(), async () => { throw new Error("offline"); }, NOW),
      (error: unknown) => error instanceof ApiClientError
        && error.status === 503
        && error.code === "ACCESS_PROJECTION_UNAVAILABLE",
    );
    await assert.rejects(
      () => contextFromStratosAccessProjection(
        token,
        config(),
        async () => Response.json({
          tenantId: "org_stratos",
          applicationAccess: [{ application: "akb", validUntil: "not-a-date" }],
        }),
        NOW,
      ),
      (error: unknown) => error instanceof ApiClientError
        && error.status === 503
        && error.code === "ACCESS_PROJECTION_UNAVAILABLE",
    );
  });

  it("accepts a projection generated by STRATOS during the authority request", async () => {
    const body = projection([{
      applicationId: "akb",
      entitlementId: "grant-read",
      capabilities: ["akb:read_document"],
      scopes: [{ type: "public" }],
      effectiveScopes: [{ type: "public" }],
    }]);
    body.generatedAt = new Date(NOW + 5).toISOString();

    const context = await contextFromStratosAccessProjection(
      jwt({ sub: "user-123", exp: 2_000 }),
      config(),
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return Response.json(body);
      },
      NOW,
    );

    assert.equal(context.applicationAccessActive, true);
    assert.deepEqual(context.capabilities, ["akb:read_document"]);
  });

  it("rejects an entitlement whose validity ends before it starts", async () => {
    const body = projection([{
      applicationId: "akb",
      entitlementId: "grant-read",
      capabilities: ["akb:read_document"],
      scopes: [{ type: "public" }],
      effectiveScopes: [{ type: "public" }],
    }]);
    body.applicationAccess[0]!.entitlements[0]!.validFrom = new Date(NOW + 1_000).toISOString();
    body.applicationAccess[0]!.entitlements[0]!.validUntil = new Date(NOW).toISOString();

    await assert.rejects(
      () => contextFromStratosAccessProjection(
        jwt({ sub: "user-123", exp: 2_000 }),
        config(),
        async () => Response.json(body),
        NOW,
      ),
      (error: unknown) => error instanceof ApiClientError
        && error.status === 503
        && error.code === "ACCESS_PROJECTION_UNAVAILABLE",
    );
  });

  it("logs only status, never upstream bodies or token claims", async () => {
    const token = jwt({
      sub: "user-123",
      exp: 2_000,
      aud: ["akl-api", "stratos-access-api"],
      azp: "akb-chat-web",
    });
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      await assert.rejects(
        () => contextFromStratosAccessProjection(
          token,
          config(),
          async () => Response.json(
            { message: `Invalid OIDC audience\n${"x".repeat(200)}` },
            { status: 401 },
          ),
          NOW,
        ),
        (error: unknown) => error instanceof ApiClientError
          && error.status === 401
          && error.code === "ACCESS_PROJECTION_DENIED",
      );
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.[0], "STRATOS access projection rejected bearer identity.");
    const detail = warnings[0]?.[1] as {
      status?: unknown;
      reason?: unknown;
      audiences?: unknown;
      authorizedParty?: unknown;
    };
    assert.equal(detail.status, 401);
    assert.deepEqual(detail, { status: 401 });
  });
});

function config(): AklConfig {
  return {
    environment: "test",
    apiClientMode: "production",
    authMode: "oidc",
    serviceBaseUrls: {
      registry: "http://registry/api/v1",
      ingestion: "http://ingestion/api/v1",
      rag: "http://rag/api/v1",
      governance: "http://governance/api/v1",
      evaluation: "http://evaluation/api/v1",
    },
    oidc: {
      issuer: "https://login.example/realms/stratos",
      clientId: "akl-web",
      redirectUri: "https://stratos.example/akb/api/auth/callback",
      scopes: "openid profile email",
      sessionSecret: "test-secret",
      stratosAuthMeUrl: "https://stratos.example/api/v2/auth/me",
      accessProjectionTimeoutMs: 3_000,
      accessProjectionCacheTtlMs: 0,
    },
  };
}

function jwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "",
  ].join(".");
}

type TestGrant = {
  applicationId: string;
  entitlementId: string;
  capabilities: string[];
  scopes: Array<{ type: string; id?: string }>;
  effectiveScopes: Array<{ type: string; id?: string }>;
};

function projection(grants: TestGrant[]) {
  const byApplication = new Map<string, TestGrant[]>();
  for (const grant of grants) byApplication.set(grant.applicationId, [...(byApplication.get(grant.applicationId) ?? []), grant]);
  return {
    schemaVersion: "stratos-access-projection-2",
    contractRevision: "2.1.0",
    contractStatus: "active",
    contractDigest: "sha256:16509ccbdc3e49e7a9918a29c833a8ae1aa7c78777b0a8693a2477acc2f0dafa",
    catalogVersion: "capabilities-1.12.2",
    generatedAt: new Date(NOW - 1_000).toISOString(),
    expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
    organizationId: "org_stratos",
    identity: { subjectId: "user-123", kind: "person", active: true, employeeEligible: false },
    membership: { active: true, validUntil: null },
    applicationAccess: [...byApplication.entries()].map(([applicationId, items]) => ({
      applicationId,
      entitlements: items.map((item) => ({
        entitlementId: item.entitlementId,
        definitionVersion: "capabilities-1.12.2",
        profileId: null,
        source: "MANUAL",
        sourceRef: null,
        virtual: false,
        capabilities: item.capabilities,
        scopes: item.scopes,
        effectiveScopes: item.effectiveScopes,
        validFrom: new Date(NOW - 10_000).toISOString(),
        validUntil: null as string | null,
      })),
    })),
  };
}
