import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

test("official-source worker prioritizes current laws before historical versions without duplicates", async () => {
  const root = await mkdtemp(join(tmpdir(), "akb-official-source-worker-"));
  const secretFile = join(root, "secret");
  const secret = "test-official-source-secret-at-least-32-bytes";
  await writeFile(secretFile, secret, { mode: 0o600 });
  const synchronized: string[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    assert.equal(request.headers["x-akb-official-source-automation"], secret);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.setHeader("content-type", "application/json");
    if (body.action === "discover") {
      response.end(JSON.stringify({ collectionRevision: "r1", collectionId: "czech-law", pagesVisited: 2, warnings: [], candidates: [
        candidate("https://e-sbirka.gov.cz/sb/1999/106/2023-01-01", "1999-106", "2023-01-01", "2023-12-31", "historical"),
        candidate("https://e-sbirka.gov.cz/sb/1999/106/2024-01-01", "1999-106", "2024-01-01", null, "current"),
        candidate("https://e-sbirka.gov.cz/sb/2004/500/2024-01-01", "2004-500", "2024-01-01", null, "current"),
      ] }));
      return;
    }
    assert.equal(body.action, "sync");
    synchronized.push(body.source.sourceUrl);
    response.end(JSON.stringify({ action: "created", sha256: "a".repeat(64) }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const env = {
    ...process.env,
    AKB_OFFICIAL_SOURCE_AUTOMATION_ENABLED: "true",
    AKB_OFFICIAL_SOURCE_WEB_URL: `http://127.0.0.1:${address.port}`,
    AKB_OFFICIAL_SOURCE_INTERNAL_SECRET_FILE: secretFile,
    AKB_OFFICIAL_SOURCE_STATE_DIR: root,
    AKB_OFFICIAL_SOURCE_MAX_NEW_PER_RUN: "1",
    AKB_OFFICIAL_SOURCE_START_DELAY_SECONDS: "0",
  };
  try {
    await runWorker(env);
    await runWorker(env);
    await runWorker(env);
    assert.equal(synchronized.length, 3);
    assert.match(synchronized[0], /1999\/106/);
    assert.match(synchronized[1], /2004\/500/);
    assert.match(synchronized[2], /1999\/106/);
    const state = JSON.parse(await readFile(join(root, "state.json"), "utf8"));
    assert.equal(Object.keys(state.completed).length, 3);
    await runWorker(env, "--health");
  } finally {
    server.close();
  }
});

test("official-source worker trusts an explicit future temporal status", async () => {
  const root = await mkdtemp(join(tmpdir(), "akb-official-source-temporal-"));
  const secretFile = join(root, "secret");
  const secret = "test-official-source-secret-at-least-32-bytes";
  await writeFile(secretFile, secret, { mode: 0o600 });
  const synchronized: string[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.setHeader("content-type", "application/json");
    if (body.action === "discover") {
      response.end(JSON.stringify({ collectionRevision: "r1", candidates: [
        candidate("https://e-sbirka.gov.cz/sb/1995/90/2026-01-15", "current", "2026-01-15", null, "current"),
        candidate("https://e-sbirka.gov.cz/sb/1995/90/2027-01-01", "future", "2025-01-01", null, "future"),
      ] }));
      return;
    }
    synchronized.push(body.source.sourceUrl);
    response.end(JSON.stringify({ action: "created", sha256: "c".repeat(64) }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await runWorker({ ...process.env, AKB_OFFICIAL_SOURCE_AUTOMATION_ENABLED: "true",
      AKB_OFFICIAL_SOURCE_WEB_URL: `http://127.0.0.1:${address.port}`,
      AKB_OFFICIAL_SOURCE_INTERNAL_SECRET_FILE: secretFile, AKB_OFFICIAL_SOURCE_STATE_DIR: root,
      AKB_OFFICIAL_SOURCE_MAX_NEW_PER_RUN: "1", AKB_OFFICIAL_SOURCE_START_DELAY_SECONDS: "0" });
    assert.deepEqual(synchronized, ["https://e-sbirka.gov.cz/sb/1995/90/2026-01-15"]);
  } finally { server.close(); }
});

test("official-source worker backs off a rejected law so later laws can progress", async () => {
  const root = await mkdtemp(join(tmpdir(), "akb-official-source-backoff-"));
  const secretFile = join(root, "secret");
  const secret = "test-official-source-secret-at-least-32-bytes";
  await writeFile(secretFile, secret, { mode: 0o600 });
  const synchronized: string[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.setHeader("content-type", "application/json");
    if (body.action === "discover") {
      response.end(JSON.stringify({ collectionRevision: "r1", candidates: [
        candidate("https://e-sbirka.gov.cz/sb/2024/1/2024-02-01", "rejected", "2024-02-01", null, "current"),
        candidate("https://e-sbirka.gov.cz/sb/1999/106/2024-01-01", "valid", "2024-01-01", null, "current"),
      ] }));
      return;
    }
    synchronized.push(body.source.sourceUrl);
    if (body.source.title === "rejected") {
      response.statusCode = 422;
      response.end(JSON.stringify({ error: { code: "PUBLIC_SOURCE_APPROVAL_DENIED" } }));
      return;
    }
    response.end(JSON.stringify({ action: "created", sha256: "b".repeat(64) }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const env = { ...process.env, AKB_OFFICIAL_SOURCE_AUTOMATION_ENABLED: "true",
    AKB_OFFICIAL_SOURCE_WEB_URL: `http://127.0.0.1:${address.port}`,
    AKB_OFFICIAL_SOURCE_INTERNAL_SECRET_FILE: secretFile, AKB_OFFICIAL_SOURCE_STATE_DIR: root,
    AKB_OFFICIAL_SOURCE_MAX_NEW_PER_RUN: "1", AKB_OFFICIAL_SOURCE_FAILURE_BACKOFF_SECONDS: "3600",
    AKB_OFFICIAL_SOURCE_START_DELAY_SECONDS: "0" };
  try {
    await runWorker(env);
    await runWorker(env);
    assert.match(synchronized[0], /2024\/1/);
    assert.match(synchronized[1], /1999\/106/);
    const state = JSON.parse(await readFile(join(root, "state.json"), "utf8"));
    assert.equal(Object.keys(state.completed).length, 1);
    assert.equal(Object.keys(state.failures).length, 1);
  } finally { server.close(); }
});

function candidate(sourceUrl: string, suffix: string, effectiveFrom: string, effectiveTo: string | null, temporalStatus: string) {
  return { title: suffix, sourceUrl, canonicalUrl: sourceUrl.replace(/\/\d{4}-\d{2}-\d{2}$/, ""), versionLabel: "účinné-od-2024-01-01",
    effectiveFrom, effectiveTo, temporalStatus };
}

async function runWorker(env: NodeJS.ProcessEnv, argument = "--once"): Promise<void> {
  const child = spawn(process.execPath, [join(process.cwd(), "official-source-worker.mjs"), argument], { env, stdio: ["ignore", "pipe", "pipe"] });
  const stderr: Buffer[] = [];
  child.stderr.on("data", (value) => stderr.push(Buffer.from(value)));
  const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
  assert.equal(code, 0, Buffer.concat(stderr).toString("utf8"));
}
