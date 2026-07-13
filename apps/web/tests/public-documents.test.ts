import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  fetchPublicDocumentMetadata,
  openPublicSource,
  parsePublicByteRange,
  parseInternalPublicDocumentSource,
  parsePublicDocumentMetadata,
  publicEtagMatches,
  publicSourceEtag,
  PublicDocumentDeliveryError,
} from "@/lib/public-documents";
import {
  buildPublicDocumentPageModel,
  formatFileSize,
  formatValidity,
  publicDocumentPageHeaders,
  renderPublicDocumentPage,
  renderPublicDocumentUnavailablePage
} from "@/lib/public-document-page";

const hash = `sha256:${"a".repeat(64)}`;

function publicMetadata() {
  return {
    snapshot: {
      schemaVersion: "akb-public-document-1",
      documentId: "doc_public_1",
      documentVersionId: "ver_public_1",
      title: "Public guide",
      documentType: "manual",
      versionLabel: "1.0",
      validFrom: null,
      validTo: null,
      publishedAt: "2026-07-13T12:00:00Z",
      description: "Approved public summary.",
      file: {
        filename: "public-guide.pdf",
        mimeType: "application/pdf",
        sizeBytes: 123,
        sha256: hash
      }
    },
    decision_id: "pdec_public_1"
  };
}

test("public metadata parser is an exact sanitizing allowlist", () => {
  const parsed = parsePublicDocumentMetadata(publicMetadata());
  assert.equal(parsed.snapshot.title, "Public guide");
  assert.equal(JSON.stringify(parsed).includes("s3://"), false);
  assert.equal(JSON.stringify(parsed).includes("source_file_uri"), false);

  assert.throws(
    () =>
      parsePublicDocumentMetadata({
        ...publicMetadata(),
        source_file_uri: "s3://private/leak.pdf"
      }),
    (error: unknown) =>
      error instanceof PublicDocumentDeliveryError &&
      error.code === "PUBLIC_DELIVERY_UPSTREAM_INVALID"
  );
  assert.throws(
    () =>
      parsePublicDocumentMetadata({
        ...publicMetadata(),
        snapshot: {
          ...publicMetadata().snapshot,
          chunks: ["secret chunk"]
        }
      }),
    PublicDocumentDeliveryError
  );
});

test("anonymous human page model contains only approved snapshot fields and verified download route", () => {
  const metadata = parsePublicDocumentMetadata(publicMetadata());
  const model = buildPublicDocumentPageModel(metadata, "public-guide", "/akb/");

  assert.deepEqual(Object.keys(model).sort(), [
    "description",
    "documentType",
    "downloadHref",
    "fileSize",
    "filename",
    "mimeType",
    "publishedAt",
    "sha256",
    "title",
    "validity",
    "versionLabel"
  ]);
  assert.equal(model.downloadHref, "/akb/api/public/documents/public-guide/source");
  assert.equal(model.title, "Public guide");
  assert.equal(JSON.stringify(model).includes("decision_id"), false);
  assert.equal(JSON.stringify(model).includes("source_file_uri"), false);
  assert.equal(formatFileSize(1536), "1,5 KiB");
  assert.equal(formatValidity(null, null), "Bez omezení platnosti");
});

test("anonymous human page is escaped, script-free and covered by security headers", () => {
  const metadata = parsePublicDocumentMetadata(publicMetadata());
  const model = buildPublicDocumentPageModel(
    { ...metadata, snapshot: { ...metadata.snapshot, title: "Guide <script>alert(1)</script>" } },
    "public-guide",
    "/akb"
  );
  const html = renderPublicDocumentPage(model);
  const unavailable = renderPublicDocumentUnavailablePage();
  const headers = publicDocumentPageHeaders();

  assert.match(html, /Guide &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /href="\/akb\/api\/public\/documents\/public-guide\/source"/);
  assert.doesNotMatch(html, /decision_id|source_file_uri|s3:\/\//);
  assert.match(unavailable, /Dokument není dostupný/);
  assert.equal(headers["Cache-Control"], "no-store, max-age=0");
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.match(headers["Content-Security-Policy"], /script-src 'none'/);
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["X-Frame-Options"], "DENY");
});

test("each metadata request performs a fresh no-store anonymous Registry request", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(publicMetadata()), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  const options = {
    env: { AKL_REGISTRY_API_BASE_URL: "http://registry-api:8000/api/v1" },
    fetcher
  };

  await fetchPublicDocumentMetadata("public-guide", options);
  await fetchPublicDocumentMetadata("public-guide", options);

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, "http://registry-api:8000/api/v1/public/documents/public-guide");
    assert.equal(call.init?.cache, "no-store");
    assert.equal(new Headers(call.init?.headers).has("Authorization"), false);
  }
});

test("Registry capacity 429 is preserved with a bounded Retry-After", async () => {
  await assert.rejects(
    () =>
      fetchPublicDocumentMetadata("public-guide", {
        env: { AKL_REGISTRY_API_BASE_URL: "http://registry-api:8000/api/v1" },
        fetcher: async () =>
          new Response(null, {
            status: 429,
            headers: { "Retry-After": "17" }
          })
      }),
    (error: unknown) =>
      error instanceof PublicDocumentDeliveryError &&
      error.status === 429 &&
      error.code === "PUBLIC_RATE_LIMITED" &&
      error.retryAfterSeconds === 17
  );
});

test("internal source descriptor is exact and binds source version to document version", () => {
  const value = {
    publication_id: "pub_public_1",
    public_slug: "public-guide",
    document_id: "doc_public_1",
    document_version_id: "ver_public_1",
    source_version: "ver_public_1",
    source_file_uri: "s3://akl-documents/public/public-guide.pdf",
    filename: "public-guide.pdf",
    mime_type: "application/pdf",
    size_bytes: 123,
    sha256: hash,
    policy_binding_id: "pb_akb_public_1",
    policy_version: "information-policy-2.0.0",
    policy_hash: `sha256:${"b".repeat(64)}`,
    decision_id: "pdec_public_1"
  };
  assert.equal(parseInternalPublicDocumentSource(value).source_version, "ver_public_1");
  assert.throws(
    () => parseInternalPublicDocumentSource({ ...value, source_version: "ver_other" }),
    PublicDocumentDeliveryError
  );
  assert.throws(
    () => parseInternalPublicDocumentSource({ ...value, extracted_text: "secret" }),
    PublicDocumentDeliveryError
  );
});

test("public source opens a bounded-memory verified stream and supports exact ranges", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "akb-public-source-"));
  const originalRoot = process.env.AKL_WEB_OBJECT_STORAGE_ROOT;
  const originalBucket = process.env.AKL_WEB_UPLOAD_BUCKET;
  const originalSecret = process.env.AKL_WEB_DOWNLOAD_SIGNING_SECRET;
  const bytes = Buffer.alloc(8 * 1024 * 1024 + 17, 0x61);
  const sourceHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const objectKey = "public/public-guide.pdf";
  await mkdir(path.join(root, "akl-documents", "public"), { recursive: true });
  await writeFile(path.join(root, "akl-documents", objectKey), bytes);
  process.env.AKL_WEB_OBJECT_STORAGE_ROOT = root;
  process.env.AKL_WEB_UPLOAD_BUCKET = "akl-documents";
  process.env.AKL_WEB_DOWNLOAD_SIGNING_SECRET = "test-download-secret-for-public-documents";
  try {
    const source = await openPublicSource({
      publication_id: "pub_public_1",
      public_slug: "public-guide",
      document_id: "doc_public_1",
      document_version_id: "ver_public_1",
      source_version: "ver_public_1",
      source_file_uri: `s3://akl-documents/${objectKey}`,
      filename: "public-guide.pdf",
      mime_type: "application/pdf",
      size_bytes: bytes.byteLength,
      sha256: sourceHash,
      policy_binding_id: "pb_akb_public_1",
      policy_version: "information-policy-2.0.0",
      policy_hash: `sha256:${"b".repeat(64)}`,
      decision_id: "pdec_public_1"
    });
    const reader = source.openStream().getReader();
    const chunks: Uint8Array[] = [];
    let maximumChunk = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      chunks.push(chunk.value);
      maximumChunk = Math.max(maximumChunk, chunk.value.byteLength);
    }
    assert.deepEqual(Buffer.concat(chunks), bytes);
    assert.ok(maximumChunk <= 64 * 1024);
    assert.equal(source.sha256, sourceHash);

    const rangedSource = await openPublicSource({
      publication_id: "pub_public_1",
      public_slug: "public-guide",
      document_id: "doc_public_1",
      document_version_id: "ver_public_1",
      source_version: "ver_public_1",
      source_file_uri: `s3://akl-documents/${objectKey}`,
      filename: "public-guide.pdf",
      mime_type: "application/pdf",
      size_bytes: bytes.byteLength,
      sha256: sourceHash,
      policy_binding_id: "pb_akb_public_1",
      policy_version: "information-policy-2.0.0",
      policy_hash: `sha256:${"b".repeat(64)}`,
      decision_id: "pdec_public_range"
    });
    const range = parsePublicByteRange("bytes=1024-2047", rangedSource.sizeBytes);
    assert.deepEqual(range, { start: 1024, end: 2047, length: 1024 });
    const rangedBytes = Buffer.from(
      await new Response(rangedSource.openStream(range!.start, range!.end)).arrayBuffer()
    );
    assert.deepEqual(rangedBytes, bytes.subarray(1024, 2048));
    assert.deepEqual(parsePublicByteRange("bytes=-10", bytes.byteLength), {
      start: bytes.byteLength - 10,
      end: bytes.byteLength - 1,
      length: 10
    });
    assert.throws(() => parsePublicByteRange("bytes=999999999-", bytes.byteLength), PublicDocumentDeliveryError);
    const etag = publicSourceEtag(sourceHash);
    assert.equal(publicEtagMatches(etag, etag), true);
    assert.equal(publicEtagMatches(`W/${etag}`, etag), true);
    assert.equal(publicEtagMatches('"different"', etag), false);

    await assert.rejects(
      () =>
        openPublicSource({
          publication_id: "pub_public_1",
          public_slug: "public-guide",
          document_id: "doc_public_1",
          document_version_id: "ver_public_1",
          source_version: "ver_public_1",
          source_file_uri: `s3://akl-documents/${objectKey}`,
          filename: "public-guide.pdf",
          mime_type: "application/pdf",
          size_bytes: bytes.byteLength,
          sha256: `sha256:${"f".repeat(64)}`,
          policy_binding_id: "pb_akb_public_1",
          policy_version: "information-policy-2.0.0",
          policy_hash: `sha256:${"b".repeat(64)}`,
          decision_id: "pdec_public_2"
        })
    );
    await assert.rejects(
      () =>
        openPublicSource({
          publication_id: "pub_public_1",
          public_slug: "public-guide",
          document_id: "doc_public_1",
          document_version_id: "ver_public_1",
          source_version: "ver_public_1",
          source_file_uri: `s3://akl-documents/${objectKey}`,
          filename: "public-guide.pdf",
          mime_type: "text/plain",
          size_bytes: bytes.byteLength,
          sha256: sourceHash,
          policy_binding_id: "pb_akb_public_1",
          policy_version: "information-policy-2.0.0",
          policy_hash: `sha256:${"b".repeat(64)}`,
          decision_id: "pdec_public_3"
        })
    );
  } finally {
    if (originalRoot === undefined) delete process.env.AKL_WEB_OBJECT_STORAGE_ROOT;
    else process.env.AKL_WEB_OBJECT_STORAGE_ROOT = originalRoot;
    if (originalBucket === undefined) delete process.env.AKL_WEB_UPLOAD_BUCKET;
    else process.env.AKL_WEB_UPLOAD_BUCKET = originalBucket;
    if (originalSecret === undefined) delete process.env.AKL_WEB_DOWNLOAD_SIGNING_SECRET;
    else process.env.AKL_WEB_DOWNLOAD_SIGNING_SECRET = originalSecret;
    await rm(root, { recursive: true, force: true });
  }
});
