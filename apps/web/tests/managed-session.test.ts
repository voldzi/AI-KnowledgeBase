import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createServerSession, resolveServerSession, revokeServerSession, serverSessionCookieOptions, synchronizeServerSession } from "../src/lib/auth/server-session";
import { verifiedSessionFromTokens } from "../src/lib/auth/oidc";
import { identityFixture, ISSUER, managedConfig, SUBJECT } from "./helpers/managed-identity";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

async function fixture(persistent = false) {
  const identity = await identityFixture();
  const config = managedConfig();
  const session = await verifiedSessionFromTokens(config, await identity.tokens({ stratos_remember_device: persistent }), "test-nonce", identity.nowMs, identity.fetcher);
  const state = { record: {} as Record<string, unknown>, rejectWrite: false, revokeDuringPatch: false, touchDuringPatch: false, remember: persistent, now: identity.nowMs };
  identity.state.handle = async (url, init) => {
    if (url === `${ISSUER}/token`) return Response.json(await identity.tokens({ stratos_remember_device: state.remember }, "test-nonce", state.now));
    if (!url.includes("/internal/web-sessions")) return undefined;
    const method = init?.method ?? "GET";
    if (method === "GET") return Response.json(state.record);
    const body = JSON.parse(String(init?.body));
    if (method === "POST") {
      if (state.rejectWrite) return new Response(null, { status: 503 });
      state.record = { ...body, session_id: "sess_synthetic", revoked_at: null, revoked_reason: null, created_at: new Date(state.now).toISOString(), updated_at: new Date(state.now).toISOString() };
      return Response.json(state.record, { status: 201 });
    }
    if (body.revoked_reason) {
      state.record = { ...state.record, revoked_at: new Date(state.now).toISOString(), revoked_reason: body.revoked_reason };
      return Response.json(state.record);
    }
    if (state.revokeDuringPatch) state.record.revoked_at = new Date(state.now).toISOString();
    if (state.touchDuringPatch) {
      state.record.updated_at = new Date(state.now + 2).toISOString();
      state.touchDuringPatch = false;
    }
    if (state.record.revoked_at || (body.expected_updated_at && body.expected_updated_at !== state.record.updated_at)) return new Response(null, { status: 409 });
    state.record = { ...state.record, ...body, updated_at: new Date(state.now + 1).toISOString() };
    return Response.json(state.record);
  };
  globalThis.fetch = identity.fetcher;
  return { identity, config, session, state };
}

describe("managed opaque sessions", () => {
  for (const persistent of [false, true]) {
    it(`enforces signed remember=${persistent}, bounded expiry and encrypted persistence`, async () => {
      const f = await fixture(persistent);
      const selector = await createServerSession(f.config, f.session, persistent, f.state.now);
      assert.match(selector, /^[A-Za-z0-9_-]{43}$/);
      assert.notEqual(f.state.record.session_id_hash, selector);
      assert.equal(f.state.record.idle_expires_at, new Date(f.state.now + (persistent ? 30 * 86_400_000 : 8 * 3_600_000)).toISOString());
      assert.equal(f.state.record.absolute_expires_at, new Date(Math.floor(f.state.now / 1000) * 1000 + (persistent ? 90 * 86_400_000 : 24 * 3_600_000)).toISOString());
      assert.equal(String(f.state.record.encrypted_payload).includes(f.session.accessToken!), false);
      assert.equal(String(f.state.record.encrypted_payload).includes(f.session.refreshToken!), false);
      assert.equal(serverSessionCookieOptions(f.config, persistent).secure, true);
      assert.equal("maxAge" in serverSessionCookieOptions(f.config, persistent), persistent);
      assert.equal((await resolveServerSession(f.config, selector, f.state.now + 1))?.oidc.subjectId, SUBJECT);
      if (!persistent) await assert.rejects(createServerSession(f.config, f.session, true, f.state.now));
      f.state.now += persistent ? 31 * 86_400_000 : 9 * 3_600_000;
      assert.equal(await resolveServerSession(f.config, selector, f.state.now), null);
    });
  }

  it("never issues a selector for a failed server write or a foreign client", async () => {
    const f = await fixture();
    f.state.rejectWrite = true;
    await assert.rejects(createServerSession(f.config, f.session, false, f.state.now));
    await assert.rejects(createServerSession(f.config, { ...f.session, identityClientId: "foreign" }, false, f.state.now));
  });

  it("refreshes at most 15 minutes after validation and never moves the absolute deadline", async () => {
    const f = await fixture(true);
    const selector = await createServerSession(f.config, { ...f.session, expiresAt: f.state.now + 3_600_000 }, true, f.state.now);
    const deadline = f.state.record.absolute_expires_at;
    f.state.now += 900_000;
    const resolved = await resolveServerSession(f.config, selector, f.state.now);
    assert.equal(resolved?.oidc.subjectId, SUBJECT);
    assert.equal(f.state.record.identity_validated_at, new Date(f.state.now).toISOString());
    assert.equal(f.state.record.absolute_expires_at, deadline);
    assert.equal(f.identity.requests.filter((entry) => entry.url === `${ISSUER}/token`).length, 1);
    assert.ok(f.identity.requests.some((entry) => entry.url === `${ISSUER}/userinfo`));
    await createServerSession(f.config, resolved!.oidc, true, f.state.now, resolved!.absoluteExpiresAt);
    assert.equal(f.state.record.absolute_expires_at, deadline);
  });

  it("cannot revive a session revoked while a refresh is in flight", async () => {
    const f = await fixture();
    const selector = await createServerSession(f.config, f.session, false, f.state.now);
    f.state.now += 301_000;
    f.state.revokeDuringPatch = true;
    assert.equal(await resolveServerSession(f.config, selector, f.state.now), null);
    assert.ok(f.state.record.revoked_at);
    assert.equal(await resolveServerSession(f.config, selector, f.state.now + 1), null);
  });

  it("persists a remember downgrade and emits only a session cookie with a shorter absolute end", async () => {
    const f = await fixture(true);
    const selector = await createServerSession(f.config, f.session, true, f.state.now);
    f.state.now += 301_000;
    f.state.remember = false;
    const resolved = await resolveServerSession(f.config, selector, f.state.now);
    assert.ok(resolved);
    assert.equal(resolved.persistent, false);
    assert.equal(f.state.record.persistent, false);
    assert.equal(resolved.absoluteExpiresAt, Math.floor(f.identity.nowMs / 1000) * 1000 + 86_400_000);
    const cookie = serverSessionCookieOptions(f.config, resolved.persistent, resolved.absoluteExpiresAt, f.state.now);
    assert.equal("maxAge" in cookie, false);
    assert.equal("expires" in cookie, false);
    assert.equal("domain" in cookie, false);
    f.state.now += 301_000;
    f.state.remember = true;
    const later = await resolveServerSession(f.config, selector, f.state.now);
    assert.equal(later?.persistent, false);
    assert.equal(later?.absoluteExpiresAt, resolved.absoluteExpiresAt);
  });

  it("shares an in-flight rotation without caching a resolved session", async () => {
    const f = await fixture();
    const selector = await createServerSession(f.config, f.session, false, f.state.now);
    f.state.now += 301_000;
    const first = resolveServerSession(f.config, selector, f.state.now);
    const second = resolveServerSession(f.config, selector, f.state.now);
    assert.equal((await first)?.oidc.subjectId, SUBJECT);
    assert.equal((await second)?.oidc.subjectId, SUBJECT);
    assert.equal(f.identity.requests.filter((entry) => entry.url === `${ISSUER}/token`).length, 1);
    await revokeServerSession(f.config, selector);
    assert.equal(await resolveServerSession(f.config, selector, f.state.now), null);
  });

  it("retries an activity-only CAS race without discarding a rotated token", async () => {
    const f = await fixture();
    const selector = await createServerSession(f.config, f.session, false, f.state.now);
    f.state.now += 301_000;
    f.state.touchDuringPatch = true;
    assert.equal((await resolveServerSession(f.config, selector, f.state.now))?.oidc.subjectId, SUBJECT);
    assert.equal(f.identity.requests.filter((entry) => entry.url === `${ISSUER}/token`).length, 1);
    assert.equal(f.state.record.identity_validated_at, new Date(f.state.now).toISOString());
  });

  it("keeps a locally revoked session dead even when the identity provider is unavailable", async () => {
    const f = await fixture();
    const selector = await createServerSession(f.config, f.session, false, f.state.now);
    await revokeServerSession(f.config, selector);
    assert.equal(await resolveServerSession(f.config, selector, f.state.now), null);
    assert.equal(f.identity.requests.filter((entry) => entry.url === `${ISSUER}/token`).length, 0);
  });

  it("synchronizes the same central identity without replacing the selector or extending its policy", async () => {
    const f = await fixture();
    const selector = await createServerSession(f.config, f.session, false, f.state.now);
    const current = await resolveServerSession(f.config, selector, f.state.now);
    assert.ok(current);
    const later = await verifiedSessionFromTokens(f.config, await f.identity.tokens({ stratos_remember_device: true }), "test-nonce", f.state.now, f.identity.fetcher);
    const synchronized = await synchronizeServerSession(f.config, selector, current, later, f.state.now);
    assert.equal(synchronized.internalSessionId, current.internalSessionId);
    assert.equal(synchronized.persistent, false);
    assert.equal(synchronized.absoluteExpiresAt, current.absoluteExpiresAt);
    assert.equal(f.identity.requests.filter((entry) => entry.init?.method === "POST" && entry.url.endsWith("/internal/web-sessions")).length, 1);
    await revokeServerSession(f.config, selector);
    assert.equal(await resolveServerSession(f.config, selector, f.state.now), null);
  });

  it("cannot recreate a session if logout wins during silent SSO synchronization", async () => {
    const f = await fixture();
    const selector = await createServerSession(f.config, f.session, false, f.state.now);
    const current = await resolveServerSession(f.config, selector, f.state.now);
    assert.ok(current);
    f.state.revokeDuringPatch = true;
    await assert.rejects(synchronizeServerSession(f.config, selector, current, f.session, f.state.now), /SESSION_SYNCHRONIZATION_REJECTED/);
    assert.equal(f.identity.requests.filter((entry) => entry.init?.method === "POST" && entry.url.endsWith("/internal/web-sessions")).length, 1);
    assert.ok(f.state.record.revoked_at);
  });

  it("revokes an undecryptable session after encryption key rotation", async () => {
    const f = await fixture();
    const selector = await createServerSession(f.config, f.session, false, f.state.now);
    f.config.oidc!.sessionEncryptionKey = "a-new-test-only-encryption-key-at-least-32-bytes";
    assert.equal(await resolveServerSession(f.config, selector, f.state.now), null);
    assert.equal(f.state.record.revoked_reason, "undecryptable");
  });
});
