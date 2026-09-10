import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import "./helpers/next-server-navigation";
import { NextRequest } from "next/server";
import { GET as collectionsGet } from "../src/app/api/public-sources/collections/route";
import { POST as sourceSyncPost } from "../src/app/api/public-sources/sync/route";
import { createApiClients } from "../src/lib/api";
import { getAklConfig } from "../src/lib/api/config";
import { createMockContext } from "../src/lib/api/correlation";
import { canonicalDocumentSnapshot } from "../src/lib/documents/document-profile";
import { listApprovedPublicSourceCollections, preparePublicSource, validatePreparedPublicSource } from "../src/lib/public-sources/approved-collections-client";
import { officialSourceServiceRequestContext, resetOfficialSourceServiceTokenCacheForTests } from "../src/lib/public-sources/automation-service-identity";
import type { PreparePublicSourceRequest, PreparedPublicSource } from "../src/lib/public-sources/approved-collections";
import { synchronizePublicSource } from "../src/lib/public-sources/sync";
import { ApiClientError } from "../src/lib/types";
import { prepareApprovedSourceFixture } from "./fixtures/public-source-approval";

const context = createMockContext({ subjectId: "public_source_manager", accessToken: "fixture-actor-access" });
const endpoint = "https://stratos.example/api/v1/integrations/akb/official-sources";
const request: PreparePublicSourceRequest = { collectionId: "cz-statistics", expectedCollectionRevision: "r1",
  sourceUrl: "https://csu.gov.cz/katalog-produktu", canonicalUrl: "https://csu.gov.cz/katalog-produktu", title: "Statistický katalog",
  effectiveFrom: null, effectiveTo: null };
const syncInput = { collectionId: request.collectionId, collectionRevision: "r1", sourceUrl: request.sourceUrl, title: request.title };
const listItem = { collectionId: "cz-statistics", revision: "r1", displayName: "Statistiky", authorityDisplayName: "ČSÚ",
  ownerDisplayName: "Vlastník zdrojů", gestorDisplayName: "Správa znalostí", reviewRuleLabel: "Roční kontrola",
  profile: { id: "akb.official-public-reference", revision: "1" }, tlp: "TLP:CLEAR" };
const clients = () => createApiClients({ env: { AKL_ENV: "test", AKL_API_CLIENT_MODE: "mock", AKL_AUTH_MODE: "mock" } });
const noBytes: typeof fetch = async () => { assert.fail("Document bytes must not be fetched before admission"); };

test("approved collection client forwards actor only to the configured nonredirecting central API", async () => {
  const result = await listApprovedPublicSourceCollections(context, async (url, init) => {
    assert.equal(String(url), `${endpoint}/collections`);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-actor-access");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    return Response.json({ schemaVersion: "stratos-official-source-collections-1", collections: [listItem] });
  }, endpoint);
  assert.equal(result[0]?.ownerDisplayName, "Vlastník zdrojů");
});

test("approved collection client accepts only the dedicated automation service identity", async () => {
  const automationContext = { ...context, serviceClientId: "svc-akb-official-source-sync" };
  const result = await listApprovedPublicSourceCollections(automationContext, async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-actor-access");
    return Response.json({ schemaVersion: "stratos-official-source-collections-1", collections: [listItem] });
  }, endpoint);
  assert.equal(result.length, 1);
  await assert.rejects(listApprovedPublicSourceCollections({ ...context, serviceClientId: "shared-service" }, noBytes, endpoint), {
    code: "PUBLIC_SOURCE_APPROVAL_UNAVAILABLE",
  });
});

test("automation obtains only the exact dedicated OAuth client identity", async () => {
  const config = getAklConfig({
    AKL_ENV: "test", AKL_API_CLIENT_MODE: "mock", AKL_AUTH_MODE: "oidc",
    AKL_WEB_OIDC_ISSUER: "https://login.example/realms/stratos",
    AKL_WEB_PUBLIC_BASE_URL: "https://akb.example", AKL_WEB_SESSION_SECRET: "test-session-secret",
    AKL_WEB_STRATOS_AUTH_ME_URL: "https://stratos.example/api/v1/auth/me",
    AKB_OFFICIAL_SOURCE_AUTOMATION_ENABLED: "true",
    AKB_OFFICIAL_SOURCE_TOKEN_URL: "https://login.example/token",
    AKB_OFFICIAL_SOURCE_CLIENT_ID: "svc-akb-official-source-sync",
    AKB_OFFICIAL_SOURCE_CLIENT_SECRET: "test-only-client-secret",
    AKB_OFFICIAL_SOURCE_INTERNAL_SECRET: "test-only-internal-secret-at-least-32-bytes",
  });
  const savedFetch = globalThis.fetch;
  try {
    for (const clientId of ["svc-akb-official-source-sync", "shared-service"]) {
      resetOfficialSourceServiceTokenCacheForTests();
      globalThis.fetch = async (_url, init) => {
        assert.equal(new URLSearchParams(String(init?.body)).get("client_id"), "svc-akb-official-source-sync");
        return Response.json({ access_token: jwt({
          sub: "service-subject", azp: clientId, client_id: clientId,
          preferred_username: `service-account-${clientId}`,
          aud: ["akl-api", "stratos-official-sources"],
        }), expires_in: 300 });
      };
      if (clientId === "svc-akb-official-source-sync") {
        const serviceContext = await officialSourceServiceRequestContext("correlation", config);
        assert.equal(serviceContext.serviceClientId, clientId);
        assert.equal(serviceContext.subjectId, "service-subject");
      } else {
        await assert.rejects(officialSourceServiceRequestContext("correlation", config), {
          code: "OFFICIAL_SOURCE_AUTOMATION_UNAVAILABLE",
        });
      }
    }
  } finally {
    globalThis.fetch = savedFetch;
    resetOfficialSourceServiceTokenCacheForTests();
  }
});

for (const status of [404, 500, 503]) test(`missing/unavailable central contract (${status}) never turns local discovery into approval`, async () => {
  await assert.rejects(listApprovedPublicSourceCollections(context, async () => new Response(null, { status }), endpoint), { status: 503, code: "PUBLIC_SOURCE_APPROVAL_UNAVAILABLE" });
});
for (const malformed of [
  { schemaVersion: "stratos-official-source-collections-1", collections: [{ ...listItem, active: true }] },
  { schemaVersion: "stratos-official-source-collections-1", collections: [{ ...listItem, tlp: null }] },
  { schemaVersion: "stratos-official-source-collections-1", collections: [listItem, listItem] },
  { schemaVersion: "stratos-official-source-collections-1", collections: [{ ...listItem, profile: { id: listItem.profile.id, revision: "unknown" } }] },
]) test("malformed approval collection projection is unavailable", async () => {
  await assert.rejects(listApprovedPublicSourceCollections(context, async () => Response.json(malformed), endpoint), { status: 503 });
});
test("central response is bounded and missing configuration performs no network request", async () => {
  await assert.rejects(listApprovedPublicSourceCollections(context, noBytes, ""), { status: 503 });
  await assert.rejects(listApprovedPublicSourceCollections({ ...context, accessToken: undefined }, noBytes, endpoint), { status: 503 });
  await assert.rejects(listApprovedPublicSourceCollections(context, async () => Response.json({ padding: "x".repeat(300_000) }), endpoint), { status: 503 });
});
test("source preparation binds exact source and complete metadata before intake", async () => {
  const prepared = await preparePublicSource(request, context, async (url, init) => {
    assert.equal(String(url), `${endpoint}/sources/prepare`);
    assert.deepEqual(JSON.parse(String(init?.body)), { schemaVersion: "stratos-official-source-prepare-1", ...request });
    return Response.json(await prepareApprovedSourceFixture(request));
  }, endpoint);
  assert.equal(prepared.documentProfile.provenance.sourceSystem, "AKB_OFFICIAL_SOURCE");
  assert.equal(prepared.documentVersionProfile.lifecycle.mode, "record");
});
test("revoked or stale collection prevents source preparation", async () => {
  for (const status of [403, 409]) await assert.rejects(preparePublicSource(request, context, async () => new Response(null, { status }), endpoint), { status });
});

const mutations: Array<[string, (prepared: PreparedPublicSource) => void]> = [
  ["wrong source record", (p) => { p.documentProfile.provenance.sourceRecordId = "collection_only"; }],
  ["missing exact governed source", (p) => { p.documentProfile.provenance.sourceGovernedResourceId = null; }],
  ["different canonical source", (p) => { p.documentVersionProfile.domain_evidence.canonicalSourceUrl = "https://csu.gov.cz/other"; }],
  ["different collection", (p) => { p.documentVersionProfile.domain_evidence.collectionId = "other"; }],
  ["missing issuer evidence", (p) => { p.documentProfile.authorship[0]!.evidenceReference = ""; }],
  ["missing review", (p) => { p.documentVersionProfile.lifecycle.reviewAt = null; }],
  ["missing TLP", (p) => { p.informationPolicy.tlp = null; }],
  ["caller activity is not proof", (p) => { Object.assign(p.documentProfile.accountability, { active: true }); }],
];
for (const [label, mutate] of mutations) test(`invalid preparation: ${label} stops before root registration or source bytes`, async () => {
  const api = clients();
  api.registry.createDocument = async () => { assert.fail("Invalid preparation must not register a root"); };
  await assert.rejects(synchronizePublicSource(syncInput, api, context, noBytes, undefined, async (input) => {
    const prepared = await prepareApprovedSourceFixture(input); mutate(prepared); return prepared;
  }), { status: 503, code: "PUBLIC_SOURCE_APPROVAL_UNAVAILABLE" });
});

test("regulation cannot receive fabricated capture-date effectivity or missing legal evidence", async () => {
  const legalRequest = { ...request, collectionId: "eu-law", canonicalUrl: "https://eur-lex.europa.eu/legal-content/CS/TXT/?uri=CELEX:32016R0679",
    sourceUrl: "https://publications.europa.eu/resource/celex/32016R0679", effectiveFrom: "2018-05-25" };
  const prepared = await prepareApprovedSourceFixture(legalRequest);
  prepared.documentVersionProfile.domain_evidence.effectiveDateEvidenceReference = null;
  assert.throws(() => validatePreparedPublicSource(prepared, legalRequest, context), { status: 503 });
});

test("root authorization failure stops intake after preparation and root registration", async () => {
  const api = clients();
  api.registry.authorizeDocument = async () => ({ allowed: false, reason: "Revoked source", reason_codes: ["REVOKED"], constraints: {} });
  await assert.rejects(synchronizePublicSource(syncInput, api, context, noBytes, undefined, prepareApprovedSourceFixture), { status: 403 });
});

test("existing root is refreshed; changed current authority is not hidden by a stale list projection", async () => {
  const api = clients();
  const prepared = await prepareApprovedSourceFixture(request);
  const document = await api.registry.createDocument({ title: request.title, document_type: "methodology", classification: "public",
    owner_id: prepared.documentProfile.accountability.ownerSubjectId, gestor_unit: "unit_source_stewards", tags: [],
    document_profile: prepared.documentProfile, information_policy: prepared.informationPolicy,
    metadata: { canonical_url: request.canonicalUrl, collection_id: request.collectionId, collection_revision: "r1" } }, context);
  api.registry.listDocuments = async () => [document];
  api.registry.getDocument = async () => {
    const changed = structuredClone(document);
    changed.document_profile!.accountability.ownerSubjectId = "changed_owner";
    changed.current_root_snapshot_hash = `sha256:${createHash("sha256").update(canonicalDocumentSnapshot(changed.document_profile)).digest("hex")}`;
    return changed;
  };
  await assert.rejects(synchronizePublicSource(syncInput, api, context, noBytes, undefined, prepareApprovedSourceFixture), { status: 409, code: "PUBLIC_SOURCE_ROOT_METADATA_CONFLICT" });
});

test("actual BFF rejects client-supplied authority and reports missing upstream approval without downloading", async () => {
  const keys = ["AKL_ENV", "AKL_API_CLIENT_MODE", "AKL_AUTH_MODE", "AKL_STRATOS_OFFICIAL_SOURCES_URL"];
  const before = keys.map((key) => [key, process.env[key]] as const);
  const savedFetch = globalThis.fetch;
  Object.assign(process.env, { AKL_ENV: "test", AKL_API_CLIENT_MODE: "mock", AKL_AUTH_MODE: "mock", AKL_STRATOS_OFFICIAL_SOURCES_URL: "" });
  globalThis.fetch = noBytes;
  try {
    const response = await collectionsGet(new NextRequest("http://akb.local/api/public-sources/collections"));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const injected = await sourceSyncPost(new NextRequest("http://akb.local/api/public-sources/sync", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ collection_id: request.collectionId, collection_revision: "r1", source_url: request.sourceUrl, title: request.title, information_policy: { tlp: "TLP:CLEAR" } }) }));
    assert.equal(injected.status, 422);
    assert.equal((await injected.json()).error.code, "PUBLIC_SOURCE_REQUEST_INVALID");
  } finally {
    globalThis.fetch = savedFetch;
    for (const [key, value] of before) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("central outage before prepare does not reach the Registry or the source", async () => {
  const api = clients();
  api.registry.listDocuments = async () => { assert.fail("Registry lookup must wait for central preparation"); };
  await assert.rejects(synchronizePublicSource(syncInput, api, context, noBytes, undefined, async () => {
    throw new ApiClientError("Unavailable", 503, "PUBLIC_SOURCE_APPROVAL_UNAVAILABLE", "test");
  }), { status: 503 });
});

function jwt(claims: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify(claims)).toString("base64url"),
    "signature",
  ].join(".");
}
