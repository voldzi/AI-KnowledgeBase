import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultInformationPolicy, parseDocumentInformationPolicy, parseInformationPolicy } from "../src/lib/stratos/information-policy";
import { synchronizePublicSource } from "../src/lib/public-sources/sync";
import { createApiClients } from "../src/lib/api";
import { createMockContext } from "../src/lib/api/correlation";
import { prepareApprovedSourceFixture } from "./fixtures/public-source-approval";

describe("mandatory AKB document TLP", () => {
  const policy = createDefaultInformationPolicy({ classification: "internal", ownerSubjectId: "owner_one", tlp: "TLP:AMBER" });
  for (const tlp of [undefined, null, "", "TLP:WHITE", "CLEAR"]) {
    it(`rejects ${String(tlp)} without inventing a label`, () => {
      assert.throws(() => parseDocumentInformationPolicy({ ...policy, tlp }));
    });
  }
  it("keeps the shared defensive parser distinct from document admission", () => {
    assert.equal(parseInformationPolicy({ ...policy, tlp: null }).tlp, null);
    assert.throws(() => createDefaultInformationPolicy({ classification: "public", ownerSubjectId: "owner_one", tlp: null }));
  });
  for (const tlp of ["TLP:CLEAR", "TLP:GREEN", "TLP:AMBER", "TLP:AMBER+STRICT", "TLP:RED"]) {
    it(`accepts explicit ${tlp} with its required audience`, () => {
      const value = createDefaultInformationPolicy({ classification: "internal", ownerSubjectId: "owner_one", tlp, recipientSubjectIds: tlp === "TLP:RED" ? ["recipient_one"] : [] });
      assert.equal(value.tlp, tlp);
    });
  }
  it("does not make a RED audience out of an empty recipient selection", () => {
    assert.throws(() => createDefaultInformationPolicy({ classification: "restricted", ownerSubjectId: "owner_one", tlp: "TLP:RED" }));
  });
});

describe("official collection admission", () => {
  const clients = createApiClients({ env: { AKL_ENV: "test", AKL_API_CLIENT_MODE: "mock", AKL_AUTH_MODE: "mock" } });
  const context = createMockContext({ subjectId: "public_source_manager" });
  const fetcher: typeof fetch = async () => { assert.fail("Unapproved source must not be downloaded"); };
  it("requires an approved collection selection before downloading a new source", async () => {
    await assert.rejects(synchronizePublicSource({ collectionId: "cz-statistics", collectionRevision: "", sourceUrl: "https://csu.gov.cz/katalog-produktu", title: "Statistics" }, clients, context, fetcher), { code: "PUBLIC_SOURCE_APPROVAL_REQUIRED" });
  });
  it("rejects a collection with correctly formed but missing TLP", async () => {
    await assert.rejects(synchronizePublicSource({ collectionId: "cz-statistics", collectionRevision: "r1", sourceUrl: "https://csu.gov.cz/katalog-produktu", title: "Statistics" }, clients, context, fetcher, undefined,
      async (request) => { const result = await prepareApprovedSourceFixture(request); result.informationPolicy.tlp = null; return result; }), { code: "PUBLIC_SOURCE_APPROVAL_UNAVAILABLE" });
  });
  it("requires verified regulation effectivity without substituting capture time", async () => {
    await assert.rejects(synchronizePublicSource({ collectionId: "eu-law", collectionRevision: "r1", sourceUrl: "https://publications.europa.eu/resource/celex/32016R0679", title: "Regulation" }, clients, context, fetcher), { code: "PUBLIC_SOURCE_EFFECTIVITY_REQUIRED" });
  });
});
