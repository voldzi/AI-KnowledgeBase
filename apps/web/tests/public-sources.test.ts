import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApiClients } from "../src/lib/api";
import { createMockContext } from "../src/lib/api/correlation";
import { publicSourceCollection, publicSourceTargetTotal } from "../src/lib/public-sources/catalog";
import { assertPublicSourceUrl, discoverPublicSourceCollection } from "../src/lib/public-sources/discovery";
import { synchronizePublicSource } from "../src/lib/public-sources/sync";
import { getUploadSettings } from "../src/lib/upload/preflight";

test("official source catalog targets the requested pilot corpus size", () => {
  const total = publicSourceTargetTotal();
  assert.ok(total >= 300);
  assert.ok(total <= 400);
});

test("fixed EUR-Lex collection returns only approved HTTPS sources", async () => {
  const result = await discoverPublicSourceCollection("eu-law");
  assert.ok(result.candidates.length >= 20);
  assert.ok(result.candidates.every((item) => item.sourceUrl.startsWith("https://publications.europa.eu/resource/celex/")));
  assert.ok(result.candidates.every((item) => item.canonicalUrl.startsWith("https://eur-lex.europa.eu/")));
});

test("e-Sbírka discovery uses credential-free open data and selects the current effective version", async () => {
  let requests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    requests += 1;
    assert.match(String(input), /^https:\/\/opendata\.eselpoint\.gov\.cz\/esel-esb\/eli\/cz\/sb\//);
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    assert.match(new Headers(init?.headers).get("accept") ?? "", /application\/ld\+json/);
    const path = new URL(String(input)).pathname;
    return new Response(JSON.stringify({
      "má-vyhlášené-znění": `${path.slice(1)}/0000-00-00`,
      "má-znění": [
        `${path.slice(1)}/0000-00-00`,
        `${path.slice(1)}/2025-01-01`,
        `${path.slice(1)}/2999-01-01`,
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/ld+json" },
    });
  };

  const collection = publicSourceCollection("czech-law");
  const result = await discoverPublicSourceCollection("czech-law", fetcher);
  const procurementAct = result.candidates.find((item) => item.title.startsWith("134/2016 Sb."));

  assert.equal(collection?.syncMode, "open_data");
  assert.equal(result.candidates.length, collection?.openDataActs?.length);
  assert.equal(result.pagesVisited, collection?.openDataActs?.length);
  assert.equal(requests, collection?.openDataActs?.length);
  assert.equal(result.warnings.length, 0);
  assert.equal(procurementAct?.canonicalUrl, "https://e-sbirka.gov.cz/sb/2016/134");
  assert.match(procurementAct?.sourceUrl ?? "", /^https:\/\/opendata\.eselpoint\.gov\.cz\/sparql\?/);
  assert.match(decodeURIComponent(procurementAct?.sourceUrl ?? ""), /2016\/134\/2025-01-01/);
});

test("ČSÚ collection keeps authoritative HTML catalog pages as searchable originals", async () => {
  const collection = publicSourceCollection("cz-statistics");
  const result = await discoverPublicSourceCollection(
    "cz-statistics",
    async (_input) => new Response("<html><body><main>Statistické produkty</main></body></html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    }),
  );

  assert.equal(collection?.allowHtml, true);
  assert.ok(result.candidates.some((item) => item.sourceUrl === "https://csu.gov.cz/katalog-produktu"));
  assert.ok(result.candidates.some((item) => item.sourceUrl === "https://csu.gov.cz/otevrena_data"));
});

test("ČSÚ HTML source is stored as an immutable controlled-document version", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "akb-public-csu-source-"));
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
    const bytes = new TextEncoder().encode("<html><body><main>Katalog produktů ČSÚ</main></body></html>");
    const transport = async (correlationId: string) => ({
      ...context,
      requestId: correlationId,
      correlationId,
    });
    const created = await synchronizePublicSource(
      {
        collectionId: "cz-statistics",
        sourceUrl: "https://csu.gov.cz/katalog-produktu",
        title: "Katalog produktů Českého statistického úřadu",
      },
      clients,
      context,
      async (_input, init) => {
        assert.match(new Headers(init?.headers).get("accept") ?? "", /text\/html/);
        return new Response(bytes, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Length": String(bytes.byteLength),
          },
        });
      },
      transport,
    );
    const details = created.version as typeof created.version & {
      file?: { mime_type?: string | null };
      source_location?: { file_name?: string | null };
    };

    assert.equal(created.action, "created");
    assert.equal(details.file?.mime_type, "text/html");
    assert.match(details.source_location?.file_name ?? "", /\.html$/);
  } finally {
    if (previousRoot === undefined) delete process.env.AKL_WEB_OBJECT_STORAGE_ROOT;
    else process.env.AKL_WEB_OBJECT_STORAGE_ROOT = previousRoot;
    if (previousEnvironment === undefined) delete process.env.AKL_ENV;
    else process.env.AKL_ENV = previousEnvironment;
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test("FitSM PPTX source keeps its presentation type instead of being mislabeled as DOCX", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "akb-public-fitsm-source-"));
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
    const packageMarker = new TextEncoder().encode("ppt/presentation.xml");
    const bytes = new Uint8Array(4 + packageMarker.byteLength);
    bytes.set([0x50, 0x4b, 0x03, 0x04]);
    bytes.set(packageMarker, 4);
    const transport = async (correlationId: string) => ({
      ...context,
      requestId: correlationId,
      correlationId,
    });
    const created = await synchronizePublicSource(
      {
        collectionId: "open-itsm",
        sourceUrl: "https://www.fitsm.eu/download/1552/",
        title: "Advanced Training in Service Operation and Control",
      },
      clients,
      context,
      async (_input, init) => {
        assert.match(new Headers(init?.headers).get("accept") ?? "", /presentationml/);
        return new Response(bytes, {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "Content-Disposition": "attachment; filename=FitSM_Advanced_Training_SOC_V3.4.1_DE.pptx",
            "Content-Length": String(bytes.byteLength),
          },
        });
      },
      transport,
    );
    const details = created.version as typeof created.version & {
      file?: { mime_type?: string | null };
      source_location?: { file_name?: string | null };
    };

    assert.equal(created.action, "created");
    assert.equal(
      details.file?.mime_type,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    assert.equal(details.source_location?.file_name, "FitSM_Advanced_Training_SOC_V3.4.1_DE.pptx");

    const mutableVersions = (clients.registry as unknown as {
      versions: Array<typeof created.version & {
        source_location?: {
          file_name?: string | null;
          content_type?: string | null;
          sha256?: string | null;
        } | null;
      }>;
    }).versions;
    const legacyVersion = mutableVersions.find(
      (version) => version.document_version_id === created.version.document_version_id,
    );
    assert.ok(legacyVersion?.source_location);
    legacyVersion.source_location.file_name = "FitSM_Advanced_Training_SOC_V3.4.1_DE.docx";
    legacyVersion.source_location.content_type =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    const repaired = await synchronizePublicSource(
      {
        collectionId: "open-itsm",
        sourceUrl: "https://www.fitsm.eu/download/1552/",
        title: "Advanced Training in Service Operation and Control",
      },
      clients,
      context,
      async () => new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": "attachment; filename=FitSM_Advanced_Training_SOC_V3.4.1_DE.docx",
          "Content-Length": String(bytes.byteLength),
        },
      }),
      transport,
    );
    const repairedDetails = repaired.version as typeof repaired.version & {
      source_location?: { file_name?: string | null; content_type?: string | null };
    };
    const repairedVersions = await clients.registry.listDocumentVersions(
      created.document.document_id,
      context,
    );

    assert.equal(repaired.action, "updated");
    assert.equal(repaired.version.file_hash, created.version.file_hash);
    assert.notEqual(repaired.version.version_label, created.version.version_label);
    assert.equal(repairedDetails.source_location?.file_name, "FitSM_Advanced_Training_SOC_V3.4.1_DE.pptx");
    assert.equal(
      repairedDetails.source_location?.content_type,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    assert.equal(repairedVersions.length, 2);
  } finally {
    if (previousRoot === undefined) delete process.env.AKL_WEB_OBJECT_STORAGE_ROOT;
    else process.env.AKL_WEB_OBJECT_STORAGE_ROOT = previousRoot;
    if (previousEnvironment === undefined) delete process.env.AKL_ENV;
    else process.env.AKL_ENV = previousEnvironment;
    await rm(storageRoot, { recursive: true, force: true });
  }
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
    const bytes = new TextEncoder().encode(
      '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>AI Act</p></body></html>',
    );
    let timedOut = false;
    const fetcher: typeof fetch = async (input, init) => {
      if (!timedOut) {
        timedOut = true;
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("accept"), "application/xhtml+xml");
      assert.equal(headers.get("accept-language"), "ces");
      assert.equal(headers.get("accept-max-cs-size"), String(getUploadSettings().maxFileBytes));
      if (String(input) === "https://publications.europa.eu/resource/celex/32024R1689") {
        return new Response(null, {
          status: 303,
          headers: {
            Location: "http://publications.europa.eu/resource/cellar/ai-act.0002.01/DOC_1",
          },
        });
      }
      assert.equal(
        String(input),
        "https://publications.europa.eu/resource/cellar/ai-act.0002.01/DOC_1",
      );
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "application/xhtml+xml;charset=UTF-8",
          "Content-Length": String(bytes.byteLength),
          ETag: '"official-v1"',
        },
      });
    };
    const input = {
      collectionId: "eu-law",
      sourceUrl: "https://publications.europa.eu/resource/celex/32024R1689",
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

test("e-Sbírka sync accepts the official SPARQL JSON original", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "akb-public-law-source-"));
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
    const bytes = new TextEncoder().encode(JSON.stringify({
      head: { vars: ["order", "citation", "text"] },
      results: { bindings: [{ text: { type: "literal", value: "Zadavatel postupuje transparentně." } }] },
    }));
    const fetcher: typeof fetch = async (_input, init) => {
      assert.match(new Headers(init?.headers).get("accept") ?? "", /sparql-results\+json/);
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "application/sparql-results+json; charset=utf-8",
          "Content-Length": String(bytes.byteLength),
        },
      });
    };
    const sourceUrl = new URL("https://opendata.eselpoint.gov.cz/sparql");
    sourceUrl.searchParams.set(
      "query",
      `SELECT ?order ?citation ?text WHERE {
  <https://opendata.eselpoint.gov.cz/esel-esb/eli/cz/sb/2016/134/2025-04-03> <https://slovník.gov.cz/datový/sbírka/pojem/má-fragment-znění> ?versionFragment .
  ?versionFragment <https://slovník.gov.cz/datový/sbírka/pojem/obsahuje-fragment> ?fragment .
  OPTIONAL { ?versionFragment <https://slovník.gov.cz/datový/sbírka/pojem/pořadí-fragmentu-znění-právního-aktu> ?order . }
  OPTIONAL { ?versionFragment <https://slovník.gov.cz/datový/sbírka/pojem/citace-označení-fragmentu-znění-právního-aktu> ?citation . }
  ?fragment <https://slovník.gov.cz/datový/sbírka/pojem/text-fragmentu> ?text .
} ORDER BY ?order`,
    );
    const transport = async (correlationId: string) => ({
      ...context,
      requestId: correlationId,
      correlationId,
    });

    const created = await synchronizePublicSource(
      {
        collectionId: "czech-law",
        sourceUrl: sourceUrl.toString(),
        canonicalUrl: "https://e-sbirka.gov.cz/sb/2016/134",
        title: "134/2016 Sb. – Zákon o zadávání veřejných zakázek",
      },
      clients,
      context,
      fetcher,
      transport,
    );
    const versions = await clients.registry.listDocumentVersions(created.document.document_id, context);
    const versionDetails = created.version as typeof created.version & {
      file?: { mime_type?: string | null };
      source_location?: { file_name?: string | null };
    };

    assert.equal(created.action, "created");
    assert.equal(versionDetails.file?.mime_type, "application/json");
    assert.equal(versionDetails.source_location?.file_name, "sb-2016-134-2025-04-03.json");
    assert.equal(versions.length, 1);
    await assert.rejects(
      synchronizePublicSource(
        {
          collectionId: "czech-law",
          sourceUrl: "https://opendata.eselpoint.gov.cz/sparql?query=SELECT+*+WHERE+%7B%3Fs+%3Fp+%3Fo%7D",
          canonicalUrl: "https://e-sbirka.gov.cz/sb/2016/134",
          title: "Neomezený dotaz",
        },
        clients,
        context,
        fetcher,
        transport,
      ),
      /valid legal-act version|reviewed fragment query/i,
    );
  } finally {
    if (previousRoot === undefined) delete process.env.AKL_WEB_OBJECT_STORAGE_ROOT;
    else process.env.AKL_WEB_OBJECT_STORAGE_ROOT = previousRoot;
    if (previousEnvironment === undefined) delete process.env.AKL_ENV;
    else process.env.AKL_ENV = previousEnvironment;
    await rm(storageRoot, { recursive: true, force: true });
  }
});
