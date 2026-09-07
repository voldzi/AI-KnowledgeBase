import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import vector from "../../../contracts/akb/document-intake/v1/manifest-test-vector.json";
import { createIntakeManifest, persistIntakeManifest } from "../src/lib/upload/intake-manifest";
import { acceptDocumentIntakeBytes } from "../src/lib/upload/document-intake";
import type { UploadSettings, UploadTokenPayload } from "../src/lib/upload/preflight";

const payload = { ...vector.payload, purpose: "controlled-document-upload", file_type: "application/pdf" } as unknown as UploadTokenPayload;

test("web and Python Registry share the exact signed expiry test vector", () => {
  assert.equal(createIntakeManifest(payload, vector.signing_secret), vector.manifest);
});

test("durable manifest exists in both recovery locations and retries preserve exact bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "akb-manifest-"));
  const settings: UploadSettings = { objectStorageRoot: root, bucket: payload.bucket, storageMode: "local",
    signingSecret: vector.signing_secret, maxFileBytes: 1_000_000, publicUploadBasePath: "/unused", expiresInSeconds: 60 };
  try {
    await persistIntakeManifest(payload, settings);
    await persistIntakeManifest(payload, settings);
    for (const file of [path.join(root, "manifests", `${payload.session_id}.manifest`),
      path.join(root, payload.bucket, ".intake/manifests", `${payload.session_id}.manifest`)]) {
      assert.equal(await readFile(file, "utf8"), vector.manifest);
    }
    await assert.rejects(persistIntakeManifest({ ...payload, file_size: payload.file_size + 1 }, settings), /identity conflict/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("byte acceptance persists manifest before its first quarantine write", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "akb-manifest-before-bytes-"));
  const settings: UploadSettings = { objectStorageRoot: root, bucket: payload.bucket, storageMode: "local",
    signingSecret: vector.signing_secret, maxFileBytes: 1_000_000, publicUploadBasePath: "/unused", expiresInSeconds: 60 };
  try {
    await assert.rejects(acceptDocumentIntakeBytes({ content: new Uint8Array(), sessionId: payload.session_id,
      payload, settings, uploadToken: "test-only" }), /size does not match/);
    assert.equal(await readFile(path.join(root, "manifests", `${payload.session_id}.manifest`), "utf8"), vector.manifest);
    await assert.rejects(readFile(path.join(root, "pending", payload.session_id, payload.file_name)), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
