import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApiClients } from "../src/lib/api";
import { createMockContext } from "../src/lib/api/correlation";
import { publicSourceTargetTotal } from "../src/lib/public-sources/catalog";
import { assertPublicSourceUrl, discoverPublicSourceCollection } from "../src/lib/public-sources/discovery";
import { synchronizePublicSource } from "../src/lib/public-sources/sync";

test("official source catalog targets the requested pilot corpus size", () => {
  const total = publicSourceTargetTotal();
  assert.ok(total >= 300);
  assert.ok(total <= 400);
});

test("fixed EUR-Lex collection returns only approved HTTPS sources", async () => {
  const result = await discoverPublicSourceCollection("eu-law");
  assert.ok(result.candidates.length >= 20);
  assert.ok(result.candidates.every((item) => item.sourceUrl.startsWith("https://eur-lex.europa.eu/")));
});

test("crawler discovers documents and refuses links outside the collection allowlist", async () => {
  const html = `
    <a href="/docs/good.pdf">Metodika PDF</a>
    <a href="https://evil.invalid/private.pdf">Cizí dokument</a>
    <a href="/cs/infoservis/dokumenty-a-publikace/detail/">Detail</a>
  `;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/detail/")) {
      return new Response('<a href="/docs/second.docx">Druhá metodika</a>', {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  };
  const result = await discoverPublicSourceCollection("nukib-support", fetcher);
  assert.deepEqual(
    result.candidates.map((item) => item.sourceUrl),
    ["https://nukib.gov.cz/docs/second.docx", "https://nukib.gov.cz/docs/good.pdf"],
  );
  assert.throws(
    () => assertPublicSourceUrl("nukib-support", "https://127.0.0.1/private.pdf"),
    /not allowed|approved/i,
  );
});

test("crawler converts Archi.gov.cz media-manager links to immutable document downloads", async () => {
  const html = `
    <a href="/znalostni_baze:start?image=znalostni_baze%3Adoporuceni_4_v3.docx&ns=znalostni_baze&tab_details=view&do=media">
      Doporučení 4 DOCX
    </a>
  `;
  const result = await discoverPublicSourceCollection(
    "dia-architecture",
    async (_input) => new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    }),
  );
  assert.equal(result.candidates.length, 1);
  assert.equal(
    result.candidates[0]?.sourceUrl,
    "https://archi.gov.cz/_media/znalostni_baze:doporuceni_4_v3.docx",
  );
});

test("official source sync stores, publishes, ingests and idempotently reuses one immutable version", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "akb-public-source-"));
  const previousRoot = process.env.AKL_WEB_OBJECT_STORAGE_ROOT;
  const previousEnvironment = process.env.AKL_ENV;
  process.env.AKL_WEB_OBJECT_STORAGE_ROOT = storageRoot;
  process.env.AKL_ENV = "test";
  try {
    const clients = createApiClients({
      env: {
        AKL_ENV: "test",
        AKL_API_CLIENT_MODE: "mock",
        AKL_AUTH_MODE: "mock",
      },
    });
    const context = createMockContext({ subjectId: "public_source_manager" });
    const bytes = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF");
    const fetcher: typeof fetch = async () => new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": 'attachment; filename="ai-act.pdf"',
        ETag: '"official-v1"',
      },
    });
    const input = {
      collectionId: "eu-law",
      sourceUrl: "https://eur-lex.europa.eu/legal-content/CS/TXT/PDF/?uri=CELEX:32024R1689",
      canonicalUrl: "https://eur-lex.europa.eu/legal-content/CS/TXT/?uri=CELEX:32024R1689",
      title: "Nařízení o umělé inteligenci (AI Act)",
    };
    const transport = async (correlationId: string) => ({
      ...context,
      requestId: correlationId,
      correlationId,
    });

    const created = await synchronizePublicSource(input, clients, context, fetcher, transport);
    const replayed = await synchronizePublicSource(input, clients, context, fetcher, transport);
    const documents = await clients.registry.listDocuments(context, { tag: "official-public-reference" });
    const versions = await clients.registry.listDocumentVersions(created.document.document_id, context);

    assert.equal(created.action, "created");
    assert.equal(created.document.status, "valid");
    assert.equal(created.version.status, "valid");
    assert.equal(created.job?.status, "queued");
    assert.equal(replayed.action, "unchanged");
    assert.equal(documents.length, 1);
    assert.equal(versions.length, 1);
    assert.equal(documents[0]?.metadata?.audience, "organization");
    assert.equal(documents[0]?.metadata?.anonymous_publication, false);
  } finally {
    if (previousRoot === undefined) delete process.env.AKL_WEB_OBJECT_STORAGE_ROOT;
    else process.env.AKL_WEB_OBJECT_STORAGE_ROOT = previousRoot;
    if (previousEnvironment === undefined) delete process.env.AKL_ENV;
    else process.env.AKL_ENV = previousEnvironment;
    await rm(storageRoot, { recursive: true, force: true });
  }
});
