import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  deleteStoredObject,
  headStoredObject,
  listStoredObjects,
  objectStorageSettingsFromEnv,
  putStoredObject,
  readStoredObject,
  type ObjectStorageSettings,
} from "../src/lib/storage/object-storage";

test("local object storage supports the complete object lifecycle", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akb-object-storage-"));
  const settings: ObjectStorageSettings = {
    objectStorageRoot: root,
    bucket: "akb-documents",
    storageMode: "local",
    legacyBuckets: ["akl-documents"],
  };
  const content = new TextEncoder().encode("AKB object storage integration test");
  const digest = "sha256:c37b68e657002663da6118fbb5ae6f125d28983b9e9e8877634f59dfbb9d065a";

  try {
    await putStoredObject(settings, {
      bucket: "akb-documents",
      key: "tests/object.txt",
      content,
      sha256: digest,
      contentType: "text/plain",
      originalFilename: "object.txt",
    });
    const descriptor = await headStoredObject(settings, "akb-documents", "tests/object.txt");
    assert.equal(descriptor?.size_bytes, content.byteLength);
    const stored = await readStoredObject(settings, "akb-documents", "tests/object.txt");
    assert.deepEqual(Buffer.from(stored.content), Buffer.from(content));
    assert.equal(stored.sha256, digest);
    const listed = await listStoredObjects(settings, "akb-documents", "tests/");
    assert.deepEqual(listed.map((item) => item.key), ["tests/object.txt"]);
    await deleteStoredObject(settings, "akb-documents", "tests/object.txt");
    assert.equal(await headStoredObject(settings, "akb-documents", "tests/object.txt"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("storage settings preserve the legacy logical bucket allow-list", () => {
  const settings = objectStorageSettingsFromEnv({
    AKL_OBJECT_STORAGE_MODE: "local",
    AKL_OBJECT_STORAGE_LEGACY_BUCKETS: "akl-documents, archive-documents,akl-documents",
  });
  assert.deepEqual(settings.legacyBuckets, ["akl-documents", "archive-documents"]);
});
