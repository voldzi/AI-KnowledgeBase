import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  createSourceOpenDecision,
  readSourceObject,
  SourceDownloadError,
  verifySourceDownloadToken,
  type SourceDownloadSettings
} from "../src/lib/upload/source-download";

describe("source download", () => {
  it("creates a signed source open decision and reads the stored object", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "akl-source-"));
    const settings = testSettings(root);
    const content = new TextEncoder().encode("# Source\n\nControlled source body.");
    const sha256 = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    const objectKey = "doc_123/ver_456/source.md";
    const targetPath = path.join(root, "akl-documents", ...objectKey.split("/"));
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content);

    const decision = await createSourceOpenDecision(
      {
        document_id: "doc_123",
        document_version_id: "ver_456",
        source_file_uri: `s3://akl-documents/${objectKey}`,
        file_hash: sha256,
        viewer_mode: "markdown"
      },
      settings
    );
    assert.equal(decision.available, true);
    assert.equal(decision.file.filename, "source.md");
    assert.equal(decision.file.mime_type, "text/markdown");
    assert.match(decision.download_url ?? "", /^\/source\/content\?token=/);

    const token = new URL(`http://local${decision.download_url}`).searchParams.get("token") ?? "";
    const payload = verifySourceDownloadToken(token, settings);
    const source = await readSourceObject(payload, settings);
    assert.equal(new TextDecoder().decode(source.bytes), "# Source\n\nControlled source body.");
    assert.equal(source.sha256, sha256);
  });

  it("returns an unavailable decision when the object is missing", async () => {
    const settings = testSettings(path.join(tmpdir(), `akl-source-missing-${Date.now()}`));
    const decision = await createSourceOpenDecision(
      {
        document_id: "doc_123",
        document_version_id: "ver_456",
        source_file_uri: "s3://akl-documents/doc_123/ver_456/missing.pdf",
        file_hash: "sha256:short-mock",
        viewer_mode: "pdf"
      },
      settings
    );

    assert.equal(decision.available, false);
    assert.equal(decision.download_url, null);
    assert.equal(decision.unavailable_reason, "SOURCE_OBJECT_NOT_FOUND");
    assert.equal(decision.file.sha256, null);
  });

  it("rejects tampered source download tokens", async () => {
    const root = path.join(tmpdir(), `akl-source-token-${Date.now()}`);
    const settings = testSettings(root);
    const objectKey = "doc_123/ver_456/source.txt";
    const targetPath = path.join(root, "akl-documents", ...objectKey.split("/"));
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, "source");
    const sha256 = `sha256:${createHash("sha256").update("source").digest("hex")}`;
    const decision = await createSourceOpenDecision(
      {
        document_id: "doc_123",
        document_version_id: "ver_456",
        source_file_uri: `s3://akl-documents/${objectKey}`,
        file_hash: sha256,
        viewer_mode: "text"
      },
      settings
    );
    const token = new URL(`http://local${decision.download_url}`).searchParams.get("token") ?? "";

    assert.throws(
      () => verifySourceDownloadToken(`${token}tampered`, settings),
      (error: unknown) =>
        error instanceof SourceDownloadError &&
        error.status === 401 &&
        error.code === "INVALID_SOURCE_DOWNLOAD_TOKEN"
    );
  });
});

function testSettings(root: string): SourceDownloadSettings {
  return {
    objectStorageRoot: root,
    bucket: "akl-documents",
    signingSecret: "test-download-secret",
    publicDownloadBasePath: "/source/content",
    expiresInSeconds: 300
  };
}
