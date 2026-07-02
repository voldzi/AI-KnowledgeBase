import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  assertUploadMatchesIngestionPayload,
  createUploadPreflightDecision,
  persistUploadedObject,
  UploadPreflightError,
  verifyUploadToken,
  type UploadSettings
} from "../src/lib/upload/preflight";

describe("upload preflight", () => {
  it("creates a signed upload decision and persists matching content", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "akl-upload-"));
    const settings = testSettings(root);
    const content = new TextEncoder().encode("# Test document\n\nControlled content.");
    const sha256 = `sha256:${createHash("sha256").update(content).digest("hex")}`;

    const decision = createUploadPreflightDecision(
      {
        document_id: "doc_123",
        file_name: "../Test Document.md",
        file_size: content.byteLength,
        file_type: "",
        sha256
      },
      settings
    );
    const token = decision.required_headers["X-AKL-Upload-Token"];
    const payload = verifyUploadToken(token, settings);
    const persisted = await persistUploadedObject(payload, content, settings);
    const saved = await readFile(persisted.path, "utf8");

    assert.equal(decision.file.filename, "Test_Document.md");
    assert.equal(decision.file.mime_type, "text/markdown");
    assert.equal(decision.source_file_uri, `s3://akl-documents/${decision.object_key}`);
    assert.equal(payload.document_id, "doc_123");
    assert.equal(saved, "# Test document\n\nControlled content.");
  });

  it("rejects ingestion metadata that differs from the signed preflight", () => {
    const content = new TextEncoder().encode("abc");
    const sha256 = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    const settings = testSettings("/tmp/akl-upload-test");
    const decision = createUploadPreflightDecision(
      {
        document_id: "doc_123",
        file_name: "source.txt",
        file_size: content.byteLength,
        file_type: "text/plain",
        sha256
      },
      settings
    );

    assert.throws(
      () =>
        assertUploadMatchesIngestionPayload(
          decision.required_headers["X-AKL-Upload-Token"],
          {
            document_id: "doc_999",
            upload_session_id: decision.upload_session_id,
            source_file_uri: decision.source_file_uri,
            file_hash: sha256,
            file_name: "source.txt",
            file_size: content.byteLength,
            file_type: "text/plain"
          },
          settings
        ),
      (error: unknown) =>
        error instanceof UploadPreflightError &&
        error.status === 400 &&
        error.code === "UPLOAD_PREFLIGHT_MISMATCH"
    );
  });

  it("rejects unsupported MIME and extension combinations", () => {
    const settings = testSettings("/tmp/akl-upload-test");

    assert.throws(
      () =>
        createUploadPreflightDecision(
          {
            document_id: "doc_123",
            file_name: "source.exe",
            file_size: 12,
            file_type: "application/octet-stream",
            sha256: `sha256:${"a".repeat(64)}`
          },
          settings
        ),
      (error: unknown) =>
        error instanceof UploadPreflightError &&
        error.status === 415 &&
        error.code === "FILE_EXTENSION_UNSUPPORTED"
    );
  });

  it("accepts structured office, tabular and data document uploads", () => {
    const settings = testSettings("/tmp/akl-upload-test");
    const supported = [
      ["table.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
      ["data.csv", "text/csv"],
      ["payload.json", "application/json"],
      ["feed.xml", "text/xml"],
      ["page.html", "text/html"],
      ["scan.png", "image/png"]
    ] as const;

    for (const [fileName, fileType] of supported) {
      const decision = createUploadPreflightDecision(
        {
          document_id: "doc_123",
          file_name: fileName,
          file_size: 12,
          file_type: fileType,
          sha256: `sha256:${"b".repeat(64)}`
        },
        settings
      );

      assert.equal(decision.file.filename, fileName);
      assert.equal(decision.required_headers["Content-Type"], decision.file.mime_type);
    }
  });

  it("accepts architecture and API artifact uploads with common browser MIME aliases", () => {
    const settings = testSettings("/tmp/akl-upload-test");
    const supported = [
      ["model.archimate", "application/xml", "application/xml"],
      ["process.bpmn", "text/xml", "text/xml"],
      ["diagram.drawio", "application/xml", "application/xml"],
      ["sequence.mmd", "text/plain", "text/plain"],
      ["component.puml", "text/plain", "text/plain"],
      ["openapi.yaml", "text/yaml", "text/yaml"],
      ["asyncapi.yml", "application/x-yaml", "application/x-yaml"]
    ] as const;

    for (const [fileName, fileType, expectedMimeType] of supported) {
      const decision = createUploadPreflightDecision(
        {
          document_id: "doc_archflow",
          file_name: fileName,
          file_size: 24,
          file_type: fileType,
          sha256: `sha256:${"c".repeat(64)}`
        },
        settings
      );

      assert.equal(decision.file.filename, fileName);
      assert.equal(decision.file.mime_type, expectedMimeType);
      assert.equal(decision.required_headers["Content-Type"], expectedMimeType);
    }
  });
});

function testSettings(root: string): UploadSettings {
  return {
    objectStorageRoot: root,
    bucket: "akl-documents",
    signingSecret: "test-upload-secret",
    maxFileBytes: 1024 * 1024,
    publicUploadBasePath: "/api/controlled-document/upload/sessions",
    expiresInSeconds: 900
  };
}
