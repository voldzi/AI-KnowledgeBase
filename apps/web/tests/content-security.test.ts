import assert from "node:assert/strict";
import net from "node:net";
import { afterEach, describe, it } from "node:test";

import {
  assertContentMatchesDeclaredType,
  contentSecurityReadiness,
  inspectDocumentContent,
  type ContentSecuritySettings,
} from "../src/lib/upload/content-security";
import { UploadPreflightError } from "../src/lib/upload/preflight";

const servers: net.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(
    (server) => new Promise<void>((resolve) => server.close(() => resolve())),
  ));
});

describe("document content security", () => {
  it("checks scanner readiness using VERSION without submitting document bytes", async () => {
    for (const version of [
      "ClamAV 1.4.3/27632/Sat Jul 25 00:00:00 2026",
      "ClamAV 1.4.3-rc/27632",
    ]) {
      const { port, server, commands } = await fakeClamd("stream: OK", version);
      servers.push(server);

      assert.equal(await contentSecurityReadiness(settings(port)), "ready");
      assert.deepEqual(commands, ["VERSION"]);
    }
  });

  it("does not report readiness for malformed or incomplete scanner versions", async () => {
    for (const version of [
      "COMMAND UNAVAILABLE",
      "UNKNOWN COMMAND",
      "stream: OK",
      "ClamAV 1.4.3",
      "ClamAV /27632/Sat Jul 25 00:00:00 2026",
      "ClamAV invalid/27632",
      "ClamAV 1.4.3/not-loaded",
      "ClamAV 1.4.3/27632/",
      "ClamAV 1.4.3/27632/Sat Jul 25 00:00:00 2026\nUNKNOWN COMMAND",
    ]) {
      const { port, server } = await fakeClamd("stream: OK", version);
      servers.push(server);

      assert.equal(await contentSecurityReadiness(settings(port)), "not_ready", version);
    }
  });

  it("preserves required and optional disabled-scanner readiness", async () => {
    const disabled = { ...settings(1), mode: "disabled" as const };
    assert.equal(await contentSecurityReadiness(disabled), "not_ready");
    assert.equal(await contentSecurityReadiness({ ...disabled, required: false }), "disabled");
  });

  it("accepts a matching document only after a clean clamd verdict", async () => {
    const { port, server } = await fakeClamd("stream: OK");
    servers.push(server);

    const result = await inspectDocumentContent(
      new TextEncoder().encode("%PDF-1.7\nsafe"),
      "application/pdf",
      settings(port),
    );

    assert.equal(result.status, "clean");
    assert.equal(result.engine, "clamav");
    assert.equal(result.engine_version, "1.4.3");
    assert.equal(result.signature_version, "27632");
    assert.equal(result.signature_name, null);
  });

  it("fails closed when clamd detects malware", async () => {
    const { port, server } = await fakeClamd(
      "stream: Eicar-Signature FOUND",
    );
    servers.push(server);

    await assert.rejects(
      () => inspectDocumentContent(
        new TextEncoder().encode("%PDF-1.7\nunsafe"),
        "application/pdf",
        settings(port),
      ),
      (error: unknown) => error instanceof UploadPreflightError
        && error.code === "UPLOAD_MALWARE_DETECTED",
    );
  });

  it("rejects a clean scan with invalid engine or signature metadata", async () => {
    const { port, server } = await fakeClamd("stream: OK", "COMMAND UNAVAILABLE");
    servers.push(server);

    await assert.rejects(
      () => inspectDocumentContent(
        new TextEncoder().encode("%PDF-1.7\nsafe"),
        "application/pdf",
        settings(port),
      ),
      (error: unknown) => error instanceof UploadPreflightError
        && error.code === "CONTENT_SECURITY_INVALID_RESPONSE",
    );
  });

  it("fails closed when the scanner is unavailable", async () => {
    const unavailablePort = await unusedPort();
    await assert.rejects(
      () => inspectDocumentContent(
        new TextEncoder().encode("%PDF-1.7\nsafe"),
        "application/pdf",
        settings(unavailablePort),
      ),
      (error: unknown) => error instanceof UploadPreflightError
        && error.code === "CONTENT_SECURITY_UNAVAILABLE",
    );
  });

  it("rejects content that does not match its declared type", () => {
    assert.throws(
      () => assertContentMatchesDeclaredType(
        new TextEncoder().encode("not a PDF"),
        "application/pdf",
      ),
      (error: unknown) => error instanceof UploadPreflightError
        && error.code === "UPLOAD_CONTENT_SIGNATURE_MISMATCH",
    );
  });
});

function settings(port: number): ContentSecuritySettings {
  return {
    mode: "clamd",
    required: true,
    host: "127.0.0.1",
    port,
    connectTimeoutMs: 500,
    scanTimeoutMs: 2_000,
    maxFileBytes: 1024 * 1024,
  };
}

async function fakeClamd(
  scanResponse: string,
  versionResponse = "ClamAV 1.4.3/27632/Sat Jul 25 00:00:00 2026",
): Promise<{
  port: number;
  server: net.Server;
  commands: string[];
}> {
  const commands: string[] = [];
  const server = net.createServer((socket) => {
    let request = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      request = Buffer.concat([request, bytes]);
      if (request.subarray(0, 9).toString("utf8") === "zVERSION\0") {
        commands.push("VERSION");
        socket.end(`${versionResponse}\0`);
        return;
      }
      if (
        request.subarray(0, 10).toString("utf8") === "zINSTREAM\0"
        && request.byteLength >= 14
        && request.subarray(-4).equals(Buffer.alloc(4))
      ) {
        commands.push("INSTREAM");
        socket.end(`${scanResponse}\0`);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  return { port: address.port, server, commands };
}

async function unusedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
