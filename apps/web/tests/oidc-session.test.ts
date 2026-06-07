import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  contextFromOidcSession,
  openSession,
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

  it("seals and opens a session cookie payload", () => {
    const session = sessionFromTokens({ access_token: jwt({ sub: "user-123" }), expires_in: 600 }, 1_000);
    const sealed = sealSession(session, "test-secret");
    const opened = openSession(sealed, "test-secret", 2_000);

    assert.equal(opened?.accessToken, session.accessToken);
    assert.equal(opened?.expiresAt, session.expiresAt);
    assert.equal(opened?.subjectId, session.subjectId);
    assert.deepEqual(opened?.roles, []);
    assert.deepEqual(opened?.groups, []);
    assert.equal(openSession(sealed, "wrong-secret", 2_000), null);
    assert.equal(openSession(sealed, "test-secret", session.expiresAt + 1), null);
  });
});

function jwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    ""
  ].join(".");
}
