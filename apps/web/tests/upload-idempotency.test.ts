import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  externalUploadIdentityMismatches,
  latestIngestionJobForVersion,
  resolveUploadVersion
} from "../src/lib/stratos/upload-idempotency";
import type { DocumentVersion, IngestionJob } from "../src/lib/types";

function version(overrides: Partial<DocumentVersion> = {}): DocumentVersion {
  return {
    document_version_id: "ver_1",
    document_id: "doc_1",
    file_id: "file_1",
    version_label: "sha256-abc",
    status: "draft",
    valid_from: null,
    valid_to: null,
    source_file_uri: "s3://akl-documents/doc_1/source.pdf",
    file_hash: `sha256:${"a".repeat(64)}`,
    change_summary: null,
    created_at: "2026-07-10T10:00:00Z",
    published_at: null,
    ...overrides
  };
}

function job(jobId: string, createdAt: string): IngestionJob {
  return {
    job_id: jobId,
    document_id: "doc_1",
    document_version_id: "ver_1",
    status: "failed",
    parser_profile: "controlled_document",
    ocr_enabled: true,
    chunking_strategy: "legal_structured",
    embedding_profile: "default",
    created_at: createdAt,
    started_at: createdAt,
    finished_at: createdAt
  };
}

describe("STRATOS upload confirmation idempotency", () => {
  it("replays the existing version for the same label and SHA-256", () => {
    const existing = version();

    const resolution = resolveUploadVersion(
      [existing],
      "sha256-abc",
      `SHA256:${"A".repeat(64)}`
    );

    assert.equal(resolution.kind, "replay");
    if (resolution.kind === "replay") {
      assert.equal(resolution.version.document_version_id, "ver_1");
    }
  });

  it("reports a conflict when a version label is reused with another hash", () => {
    const resolution = resolveUploadVersion(
      [version()],
      "sha256-abc",
      `sha256:${"b".repeat(64)}`
    );

    assert.equal(resolution.kind, "conflict");
  });

  it("creates a version when the label is new", () => {
    assert.deepEqual(
      resolveUploadVersion([version()], "sha256-new", `sha256:${"b".repeat(64)}`),
      { kind: "create" }
    );
  });

  it("reuses the newest lifecycle job for the matching version", () => {
    const selected = latestIngestionJobForVersion(
      [
        job("ing_old", "2026-07-10T10:00:00Z"),
        job("ing_new", "2026-07-10T11:00:00Z"),
        { ...job("ing_other", "2026-07-10T12:00:00Z"), document_version_id: "ver_2" }
      ],
      "ver_1"
    );

    assert.equal(selected?.job_id, "ing_new");
  });

  it("binds a confirm replay to the external tenant, system, reference and document", () => {
    const actual = {
      document_id: "doc_1",
      tenant_id: "tenant_aiip_default",
      external_system: "STRATOS_AIIP",
      external_ref: "aiip:idea:123"
    };

    assert.deepEqual(
      externalUploadIdentityMismatches(actual, {
        documentId: "doc_1",
        tenantId: "tenant_aiip_default",
        externalSystem: "STRATOS_AIIP",
        externalRef: "aiip:idea:123"
      }),
      []
    );
    assert.deepEqual(
      externalUploadIdentityMismatches(actual, {
        documentId: "doc_2",
        tenantId: "tenant_other",
        externalSystem: "STRATOS_AIIP",
        externalRef: "aiip:idea:123"
      }),
      ["document_id", "tenant_id"]
    );
  });
});
