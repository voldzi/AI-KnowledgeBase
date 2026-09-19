import assert from "node:assert/strict";
import test from "node:test";
import {
  recoverSessionAuthority,
  sessionAuthorityFingerprint,
  type SessionAuthorityPayload,
} from "../src/lib/session-authority-recovery";

const currentUser = {
  subjectId: "user-1",
  capabilities: ["akb:access", "akb:chat"],
  applicationAccess: [{ applicationId: "akb", status: "active" }],
};

test("recovers the same authority after a transient failure", async () => {
  let calls = 0;
  const result = await recoverSessionAuthority({
    expectedFingerprint: sessionAuthorityFingerprint(currentUser),
    signal: new AbortController().signal,
    delaysMs: [0, 0],
    read: async (): Promise<SessionAuthorityPayload> => {
      calls += 1;
      if (calls === 1) throw new Error("temporary 503");
      return { authenticated: true, user: currentUser };
    },
  });
  assert.equal(result, "verified");
  assert.equal(calls, 2);
});

test("never restores a changed or signed-out identity", async () => {
  const expectedFingerprint = sessionAuthorityFingerprint(currentUser);
  assert.equal(await recoverSessionAuthority({
    expectedFingerprint,
    signal: new AbortController().signal,
    delaysMs: [0],
    read: async () => ({ authenticated: true, user: { ...currentUser, capabilities: ["akb:access"] } }),
  }), "changed");
  assert.equal(await recoverSessionAuthority({
    expectedFingerprint,
    signal: new AbortController().signal,
    delaysMs: [0],
    read: async () => ({ authenticated: false }),
  }), "signed-out");
});

test("remains fail-closed when every recovery probe fails", async () => {
  assert.equal(await recoverSessionAuthority({
    expectedFingerprint: sessionAuthorityFingerprint(currentUser),
    signal: new AbortController().signal,
    delaysMs: [0, 0, 0],
    read: async () => { throw new Error("unavailable"); },
  }), "unavailable");
});
