import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  createSourceOpenDecision,
  getSourceDownloadSettings,
  readSourceObject,
  SourceDownloadError,
  sourceContentTypeHeader,
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

  it("detects image source MIME types for native previews", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "akl-source-image-"));
    const settings = testSettings(root);
    const content = new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
    const sha256 = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    const objectKey = "doc_123/ver_456/scan.svg";
    const targetPath = path.join(root, "akl-documents", ...objectKey.split("/"));
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content);

    const decision = await createSourceOpenDecision(
      {
        document_id: "doc_123",
        document_version_id: "ver_456",
        source_file_uri: `s3://akl-documents/${objectKey}`,
        file_hash: sha256,
        viewer_mode: "image"
      },
      settings
    );

    assert.equal(decision.available, true);
    assert.equal(decision.file.filename, "scan.svg");
    assert.equal(decision.file.mime_type, "image/svg+xml");
  });

  it("preserves deployment base path in signed source URLs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "akl-source-basepath-"));
    const settings = {
      ...testSettings(root),
      publicDownloadBasePath: "/akb/api/documents/source/content"
    };
    const content = new TextEncoder().encode("# Source\n\nBase path source body.");
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
    assert.match(decision.download_url ?? "", /^\/akb\/api\/documents\/source\/content\?token=/);
  });

  it("derives source download base path from the app base path", () => {
    const settings = getSourceDownloadSettings({
      NEXT_PUBLIC_AKL_BASE_PATH: "/akb/",
      AKL_WEB_OBJECT_STORAGE_ROOT: "/tmp/source-download-base-path",
      AKL_WEB_UPLOAD_BUCKET: "akl-documents",
      AKL_WEB_DOWNLOAD_SIGNING_SECRET: "test-download-secret"
    });

    assert.equal(settings.publicDownloadBasePath, "/akb/api/documents/source/content");
  });

  it("adds UTF-8 charset only for directly opened text-like source types", () => {
    assert.equal(sourceContentTypeHeader("text/markdown"), "text/markdown; charset=utf-8");
    assert.equal(sourceContentTypeHeader("text/csv"), "text/csv; charset=utf-8");
    assert.equal(sourceContentTypeHeader("application/json"), "application/json; charset=utf-8");
    assert.equal(sourceContentTypeHeader("application/xml"), "application/xml; charset=utf-8");
    assert.equal(sourceContentTypeHeader("image/svg+xml"), "image/svg+xml; charset=utf-8");
    assert.equal(sourceContentTypeHeader("application/pdf"), "application/pdf");
    assert.equal(
      sourceContentTypeHeader("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
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

  it("returns document context for expired source download tokens", () => {
    const settings = testSettings(path.join(tmpdir(), `akl-source-expired-${Date.now()}`));
    const token = signTestSourceToken(
      {
        source_open_id: "src_expired",
        document_id: "doc_123",
        document_version_id: "ver_456",
        bucket: "akl-documents",
        object_key: "doc_123/ver_456/source.md",
        source_file_uri: "s3://akl-documents/doc_123/ver_456/source.md",
        file_name: "source.md",
        file_type: "text/markdown",
        sha256: null,
        expires_at: "2000-01-01T00:00:00.000Z"
      },
      settings.signingSecret
    );

    assert.throws(
      () => verifySourceDownloadToken(token, settings),
      (error: unknown) =>
        error instanceof SourceDownloadError &&
        error.status === 410 &&
        error.code === "SOURCE_DOWNLOAD_TOKEN_EXPIRED" &&
        error.details.document_id === "doc_123" &&
        error.details.document_version_id === "ver_456"
    );
  });
});

function signTestSourceToken(payload: Record<string, unknown>, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function testSettings(root: string): SourceDownloadSettings {
  return {
    objectStorageRoot: root,
    bucket: "akl-documents",
    signingSecret: "test-download-secret",
    publicDownloadBasePath: "/source/content",
    expiresInSeconds: 300
  };
}
