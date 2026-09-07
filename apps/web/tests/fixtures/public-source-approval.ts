import { officialSourceRecordId } from "../../src/lib/public-sources/approved-collections-client";
import { publicSourceCollection } from "../../src/lib/public-sources/catalog";
import type { PreparedPublicSource, PreparePublicSourceRequest } from "../../src/lib/public-sources/approved-collections";
import { createDefaultInformationPolicy } from "../../src/lib/stratos/information-policy";

/** Explicit central preparation fixture; never installed as a runtime fallback. */
export async function prepareApprovedSourceFixture(request: PreparePublicSourceRequest): Promise<PreparedPublicSource> {
  const collection = publicSourceCollection(request.collectionId)!;
  return {
    schemaVersion: "stratos-official-source-preparation-1", collectionId: request.collectionId,
    collectionRevision: request.expectedCollectionRevision, sourceUrl: request.sourceUrl,
    canonicalUrl: request.canonicalUrl, title: request.title, documentType: collection.documentType,
    documentProfile: {
      profile: { id: "akb.official-public-reference", revision: "1" },
      authorship: [{ kind: "external_authority", id: "authority_official", evidenceReference: "evidence_authority" }],
      provenance: { sourceSystem: "AKB_OFFICIAL_SOURCE", sourceRecordId: officialSourceRecordId(request.collectionId, request.canonicalUrl),
        sourceGovernedResourceId: `source_${officialSourceRecordId(request.collectionId, request.canonicalUrl).slice(-32)}` },
      accountability: { ownerSubjectId: "public_source_manager", gestor: { kind: "organization_unit", id: "unit_source_stewards" } },
    },
    documentVersionProfile: {
      lifecycle: { mode: request.effectiveFrom ? request.effectiveTo ? "fixed_interval" : "until_superseded" : "record",
        effectiveFrom: request.effectiveFrom, effectiveTo: request.effectiveTo, recordedOn: request.effectiveFrom ? null : "2026-01-01",
        reviewAt: "2027-01-01", reviewRuleId: "akb.review.annual", retentionRuleId: "akb.retention.organizational-record" },
      domain_evidence: { family: "official_public_reference", authorityReference: "authority_official", canonicalSourceUrl: request.canonicalUrl,
        collectionId: request.collectionId, sourceKind: collection.documentType === "regulation" ? "regulation" : "reference",
        effectiveDateEvidenceReference: request.effectiveFrom ? "evidence_effectivity" : null },
    },
    informationPolicy: { ...createDefaultInformationPolicy({ classification: "public", ownerSubjectId: "public_source_manager", tlp: "TLP:CLEAR" }), policyBindingId: "pol_official_source_fixture", issuedAt: "2026-01-01T00:00:00Z" },
  };
}
