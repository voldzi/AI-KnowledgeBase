import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

test("official-source worker advances a bounded durable pilot without duplicating completed candidates", async () => {
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
        candidate("https://e-sbirka.gov.cz/sb/1999/106/2023-01-01", "1999-106"),
        candidate("https://e-sbirka.gov.cz/sb/1999/106/2024-01-01", "1999-106"),
        candidate("https://e-sbirka.gov.cz/sb/2004/500/2024-01-01", "2004-500"),
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
    assert.equal(synchronized.length, 3);
    assert.match(synchronized[0], /1999\/106/);
    assert.match(synchronized[1], /1999\/106/);
    assert.match(synchronized[2], /2004\/500/);
    const state = JSON.parse(await readFile(join(root, "state.json"), "utf8"));
    assert.equal(Object.keys(state.completed).length, 3);
    await runWorker(env, "--health");
  } finally {
    server.close();
  }
});

function candidate(sourceUrl: string, suffix: string) {
  return { title: suffix, sourceUrl, canonicalUrl: sourceUrl.replace(/\/\d{4}-\d{2}-\d{2}$/, ""), versionLabel: "účinné-od-2024-01-01",
    effectiveFrom: "2024-01-01", effectiveTo: null, temporalStatus: "current" };
}

async function runWorker(env: NodeJS.ProcessEnv, argument = "--once"): Promise<void> {
  const child = spawn(process.execPath, [join(process.cwd(), "official-source-worker.mjs"), argument], { env, stdio: ["ignore", "pipe", "pipe"] });
  const stderr: Buffer[] = [];
  child.stderr.on("data", (value) => stderr.push(Buffer.from(value)));
  const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
  assert.equal(code, 0, Buffer.concat(stderr).toString("utf8"));
}
