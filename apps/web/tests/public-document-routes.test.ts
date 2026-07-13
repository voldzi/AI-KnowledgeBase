import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { GET as getPublicSource } from "@/app/api/public/documents/[publicSlug]/source/route";

const ENV_KEYS = [
  "AKL_REGISTRY_API_BASE_URL",
  "AKL_PUBLIC_DELIVERY_INTERNAL_TOKEN",
  "AKL_WEB_OBJECT_STORAGE_ROOT",
  "AKL_WEB_UPLOAD_BUCKET",
  "AKL_WEB_DOWNLOAD_SIGNING_SECRET",
  "AKL_PUBLIC_RATE_WINDOW_MS",
  "AKL_PUBLIC_RATE_PER_CLIENT_SLUG",
  "AKL_PUBLIC_RATE_GLOBAL",
  "AKL_PUBLIC_CONCURRENCY_PER_CLIENT",
  "AKL_PUBLIC_CONCURRENCY_GLOBAL",
  "AKL_PUBLIC_LIMITER_MAX_KEYS",
  "AKL_PUBLIC_TRUSTED_PROXY_HOPS",
  "AKL_PUBLIC_CLIENT_KEY_SECRET"
] as const;

test("public source route streams Range/ETag and holds global concurrency through the body", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "akb-public-route-"));
  const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  const bytes = Buffer.alloc(512 * 1024 + 31, 0x62);
  const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const objectKey = "public/route-guide.pdf";
  await mkdir(path.join(root, "akl-documents", "public"), { recursive: true });
  await writeFile(path.join(root, "akl-documents", objectKey), bytes);
  Object.assign(process.env, {
    AKL_REGISTRY_API_BASE_URL: "http://registry-api:8000/api/v1",
    AKL_PUBLIC_DELIVERY_INTERNAL_TOKEN: "test-public-route-internal-token-0000000000000000",
    AKL_WEB_OBJECT_STORAGE_ROOT: root,
    AKL_WEB_UPLOAD_BUCKET: "akl-documents",
    AKL_WEB_DOWNLOAD_SIGNING_SECRET: "test-public-route-download-secret-0000000000000000",
    AKL_PUBLIC_RATE_WINDOW_MS: "60000",
    AKL_PUBLIC_RATE_PER_CLIENT_SLUG: "100",
    AKL_PUBLIC_RATE_GLOBAL: "100",
    AKL_PUBLIC_CONCURRENCY_PER_CLIENT: "2",
    AKL_PUBLIC_CONCURRENCY_GLOBAL: "4",
    AKL_PUBLIC_LIMITER_MAX_KEYS: "100",
    AKL_PUBLIC_TRUSTED_PROXY_HOPS: "1",
    AKL_PUBLIC_CLIENT_KEY_SECRET: "test-public-client-key-secret-000000000000000000"
  });
  const resolution = {
    publication_id: "pub_route_1",
    public_slug: "public-route-guide",
    document_id: "doc_route_1",
    document_version_id: "ver_route_1",
    source_version: "ver_route_1",
    source_file_uri: `s3://akl-documents/${objectKey}`,
    filename: "route-guide.pdf",
    mime_type: "application/pdf",
    size_bytes: bytes.byteLength,
    sha256,
    policy_binding_id: "pb_route_public_1",
    policy_version: "information-policy-2.0.0",
    policy_hash: `sha256:${"c".repeat(64)}`,
    decision_id: "pdec_route_1"
  };
  globalThis.fetch = async () => Response.json(resolution);
  const context = { params: Promise.resolve({ publicSlug: "public-route-guide" }) };
  try {
    const partial = await getPublicSource(
      new Request("http://akb.local/api/public/documents/public-route-guide/source", {
        headers: { Range: "bytes=4096-8191", "X-Forwarded-For": "203.0.113.10" }
      }),
      context
    );
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-range"), `bytes 4096-8191/${bytes.byteLength}`);
    assert.equal(partial.headers.get("accept-ranges"), "bytes");
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(4096, 8192));
    const etag = partial.headers.get("etag");
    assert.ok(etag);

    const notModified = await getPublicSource(
      new Request("http://akb.local/api/public/documents/public-route-guide/source", {
        headers: { "If-None-Match": etag!, "X-Forwarded-For": "203.0.113.10" }
      }),
      context
    );
    assert.equal(notModified.status, 304);
    assert.equal(notModified.headers.get("content-length"), String(bytes.byteLength));

    const invalidRange = await getPublicSource(
      new Request("http://akb.local/api/public/documents/public-route-guide/source", {
        headers: { Range: "bytes=999999999-", "X-Forwarded-For": "203.0.113.10" }
      }),
      context
    );
    assert.equal(invalidRange.status, 416);
    assert.equal(invalidRange.headers.get("content-range"), `bytes */${bytes.byteLength}`);

    process.env.AKL_PUBLIC_CONCURRENCY_GLOBAL = "1";
    const held = await getPublicSource(
      new Request("http://akb.local/api/public/documents/public-route-guide/source", {
        headers: { "X-Forwarded-For": "203.0.113.20" }
      }),
      context
    );
    assert.equal(held.status, 200);
    const globallyLimited = await getPublicSource(
      new Request("http://akb.local/api/public/documents/public-route-guide/source", {
        headers: { "X-Forwarded-For": "203.0.113.21" }
      }),
      context
    );
    assert.equal(globallyLimited.status, 429);
    assert.equal(globallyLimited.headers.get("retry-after"), "60");
    await held.arrayBuffer();

    const afterRelease = await getPublicSource(
      new Request("http://akb.local/api/public/documents/public-route-guide/source", {
        headers: { "X-Forwarded-For": "203.0.113.21" }
      }),
      context
    );
    assert.equal(afterRelease.status, 200);
    await afterRelease.arrayBuffer();
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
