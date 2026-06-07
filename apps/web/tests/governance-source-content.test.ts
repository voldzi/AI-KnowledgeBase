import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { readGovernanceSourceContent } from "../src/lib/upload/governance-source-content";
import type { SourceDownloadSettings } from "../src/lib/upload/source-download";

describe("governance source content", () => {
  it("extracts markdown source text for governance checks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "akl-governance-source-"));
    const settings = testSettings(root);
    const content = "# Governance Source\n\n- controlled obligation";
    const bytes = new TextEncoder().encode(content);
    const objectKey = "doc_123/ver_456/source.md";
    await writeSource(root, objectKey, bytes);

    const result = await readGovernanceSourceContent(
      {
        document_id: "doc_123",
        document_version_id: "ver_456",
        source_file_uri: `s3://akl-documents/${objectKey}`,
        file_hash: sha256(bytes),
        viewer_mode: "markdown"
      },
      settings
    );

    assert.equal(result.extracted, true);
    assert.equal(result.content, content);
    assert.deepEqual(result.warnings, []);
  });

  it("keeps unsupported binary source explicit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "akl-governance-pdf-"));
    const settings = testSettings(root);
    const bytes = new TextEncoder().encode("%PDF-1.7");
    const objectKey = "doc_123/ver_456/source.pdf";
    await writeSource(root, objectKey, bytes);

    const result = await readGovernanceSourceContent(
      {
        document_id: "doc_123",
        document_version_id: "ver_456",
        source_file_uri: `s3://akl-documents/${objectKey}`,
        file_hash: sha256(bytes),
        viewer_mode: "pdf"
      },
      settings
    );

    assert.equal(result.extracted, false);
    assert.equal(result.content, "");
    assert.deepEqual(result.warnings, ["SOURCE_TEXT_EXTRACTION_UNSUPPORTED"]);
  });
});

async function writeSource(root: string, objectKey: string, bytes: Uint8Array) {
  const targetPath = path.join(root, "akl-documents", ...objectKey.split("/"));
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, bytes);
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function testSettings(root: string): SourceDownloadSettings {
  return {
    objectStorageRoot: root,
    bucket: "akl-documents",
    signingSecret: "test-governance-source-secret",
    publicDownloadBasePath: "/source/content",
    expiresInSeconds: 300
  };
}
