import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  assertUploadMatchesIngestionPayload,
  createUploadReceipt,
  createUploadPreflightDecision,
  persistUploadedObject,
  readBoundedUploadContent,
  UploadPreflightError,
  verifyPersistedUploadedObject,
  verifyUploadReceipt,
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
    const receipt = createUploadReceipt(token, payload, persisted, settings);
    const verifiedReceipt = verifyUploadReceipt(receipt, token, payload, settings);
    const verifiedObject = await verifyPersistedUploadedObject(payload, settings);
    const saved = await readFile(persisted.path, "utf8");

    assert.equal(decision.file.filename, "Test_Document.md");
    assert.equal(decision.file.mime_type, "text/markdown");
    assert.equal(decision.source_file_uri, `s3://akl-documents/${decision.object_key}`);
    assert.equal(payload.document_id, "doc_123");
    assert.equal(verifiedReceipt.sha256, sha256);
    assert.equal(verifiedObject.size_bytes, content.byteLength);
    assert.equal(saved, "# Test document\n\nControlled content.");
  });

  it("rejects a tampered receipt and a missing or changed persisted object", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "akl-upload-receipt-"));
    const settings = testSettings(root);
    const content = new TextEncoder().encode("receipt-bound content");
    const sha256 = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    const decision = createUploadPreflightDecision(
      {
        document_id: "doc_receipt",
        file_name: "source.txt",
        file_size: content.byteLength,
        file_type: "text/plain",
        sha256,
      },
      settings,
    );
    const token = decision.required_headers["X-AKL-Upload-Token"];
    const payload = verifyUploadToken(token, settings);
    const persisted = await persistUploadedObject(payload, content, settings);
    const receipt = createUploadReceipt(token, payload, persisted, settings);

    assert.throws(
      () => verifyUploadReceipt(`${receipt.slice(0, -1)}x`, token, payload, settings),
      (error: unknown) =>
        error instanceof UploadPreflightError && error.code === "INVALID_UPLOAD_RECEIPT",
    );

    await writeFile(persisted.path, new TextEncoder().encode("changed-bound content"));
    await assert.rejects(
      () => verifyPersistedUploadedObject(payload, settings),
      (error: unknown) =>
        error instanceof UploadPreflightError && error.code === "UPLOADED_OBJECT_MISMATCH",
    );

    await unlink(persisted.path);
    await assert.rejects(
      () => verifyPersistedUploadedObject(payload, settings),
      (error: unknown) =>
        error instanceof UploadPreflightError && error.code === "UPLOADED_OBJECT_MISSING",
    );
  });

  it("binds the complete AIIP governance confirmation into the signed upload token", () => {
    const settings = testSettings("/tmp/akl-upload-test");
    const governanceScope = {
      scopeType: "own",
      scopeId: "own:aiip:subject-123",
      organizationId: "org_stratos",
      ownerSubjectId: "subject-123"
    };
    const decision = createUploadPreflightDecision(
      {
        document_id: "doc_aiip_123",
        file_name: "requirement-card.pdf",
        file_size: 128,
        file_type: "application/pdf",
        sha256: `sha256:${"d".repeat(64)}`,
        policy_binding_id: "binding-aiip-own",
        policy_version: "2",
        policy_hash: `sha256:${"e".repeat(64)}`,
        external_document_id: "extdoc_aiip_123",
        expected_current_document_version_id: "ver_previous_123",
        governed_document_resource_id: "governed-akb-document-123",
        source_governed_resource_id: "governed-aiip-idea-123",
        source_resource_id: "idea-123",
        source_version: "content-revision-7",
        governance_scope: governanceScope,
        governance_actor_subject_id: "subject-123",
        governance_registered_by_subject_id: "subject-123",
        governance_correlation_id: "corr-aiip-123",
        governance_idempotency_key: "aiip-upload:idea-123:content-revision-7"
      },
      settings
    );

    const payload = verifyUploadToken(decision.required_headers["X-AKL-Upload-Token"], settings);

    assert.equal(payload.external_document_id, "extdoc_aiip_123");
    assert.equal(payload.expected_current_document_version_id, "ver_previous_123");
    assert.equal(payload.governed_document_resource_id, "governed-akb-document-123");
    assert.equal(payload.source_governed_resource_id, "governed-aiip-idea-123");
    assert.equal(payload.source_resource_id, "idea-123");
    assert.equal(payload.source_version, "content-revision-7");
    assert.deepEqual(payload.governance_scope, governanceScope);
    assert.equal(payload.governance_actor_subject_id, "subject-123");
    assert.equal(payload.governance_registered_by_subject_id, "subject-123");
    assert.equal(payload.governance_correlation_id, "corr-aiip-123");
    assert.equal(payload.governance_idempotency_key, "aiip-upload:idea-123:content-revision-7");
  });

  it("rejects a signed token with an incomplete governed AIIP context", () => {
    const settings = testSettings("/tmp/akl-upload-test");
    const decision = createUploadPreflightDecision(
      {
        document_id: "doc_aiip_123",
        file_name: "requirement-card.pdf",
        file_size: 128,
        file_type: "application/pdf",
        sha256: `sha256:${"f".repeat(64)}`,
        external_document_id: "extdoc_aiip_123"
      },
      settings
    );

    assert.throws(
      () => verifyUploadToken(decision.required_headers["X-AKL-Upload-Token"], settings),
      (error: unknown) =>
        error instanceof UploadPreflightError &&
        error.status === 401 &&
        error.code === "INVALID_UPLOAD_TOKEN"
    );
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

  it("streams no more bytes than the signed upload size", async () => {
    const settings = testSettings("/tmp/akl-upload-test");
    const decision = createUploadPreflightDecision(
      {
        document_id: "doc_bounded",
        file_name: "source.txt",
        file_size: 3,
        file_type: "text/plain",
        sha256: `sha256:${createHash("sha256").update("abc").digest("hex")}`
      },
      settings
    );
    const payload = verifyUploadToken(decision.required_headers["X-AKL-Upload-Token"], settings);
    const exact = await readBoundedUploadContent(
      new Request("https://akb.example/upload", { method: "PUT", body: "abc" }),
      payload,
      settings
    );
    assert.equal(new TextDecoder().decode(exact), "abc");

    await assert.rejects(
      () =>
        readBoundedUploadContent(
          new Request("https://akb.example/upload", { method: "PUT", body: "abcd" }),
          payload,
          settings
        ),
      (error: unknown) =>
        error instanceof UploadPreflightError &&
        error.status === 400 &&
        error.code === "UPLOAD_SIZE_MISMATCH"
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
