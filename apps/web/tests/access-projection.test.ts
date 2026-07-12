import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import type { AklConfig } from "../src/lib/api/config";
import { contextFromStratosAccessProjection, resetAccessProjectionCacheForTests } from "../src/lib/auth/access-projection";
import { ApiClientError } from "../src/lib/types";

const NOW = 1_000_000;

describe("STRATOS access projection", () => {
  beforeEach(() => resetAccessProjectionCacheForTests());

  it("uses only AKB capabilities and scopes returned by STRATOS", async () => {
    const token = jwt({
      sub: "user-123",
      exp: 2_000,
      realm_access: { roles: ["admin"] },
      stratos_access: { capabilities: ["akb:manage_access"], scopes: ["organization"] },
    });
    const context = await contextFromStratosAccessProjection(
      token,
      config(),
      async () => Response.json({
        tenantId: "org_stratos",
        applicationAccess: [{
          application: "AKB",
          capabilities: ["akb:chat"],
          scopes: [{ type: "organization", id: "org_stratos" }],
        }],
      }),
      NOW,
    );

    assert.equal(context.subjectId, "user-123");
    assert.deepEqual(context.roles, []);
    assert.deepEqual(context.groups, []);
    assert.deepEqual(context.capabilities, ["akb:chat"]);
    assert.deepEqual(context.scopes, ["organization:org_stratos"]);
    assert.equal(context.authorizationSource, "stratos_projection");
    assert.equal(context.applicationAccessActive, true);
  });

  it("denies immediately after AKB application access disappears", async () => {
    const token = jwt({ sub: "user-123", exp: 2_000 });
    let active = true;
    const fetcher: typeof fetch = async () => Response.json({
      tenantId: "org_stratos",
      applicationAccess: active
        ? [{ application: "akb", capabilities: ["akb:chat"], scopes: [] }]
        : [],
    });

    const first = await contextFromStratosAccessProjection(token, config(), fetcher, NOW);
    active = false;
    const second = await contextFromStratosAccessProjection(token, config(), fetcher, NOW + 1);

    assert.equal(first.applicationAccessActive, true);
    assert.equal(second.applicationAccessActive, false);
    assert.deepEqual(second.capabilities, []);
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
      stratosAuthMeUrl: "https://stratos.example/api/v1/auth/me",
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
