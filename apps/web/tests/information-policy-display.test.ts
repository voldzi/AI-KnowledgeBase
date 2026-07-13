import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  documentInformationPolicyDetails,
  versionInformationPolicyDetails,
} from "../src/lib/information-policy-display";
import type {
  Document,
  DocumentPublication,
  DocumentVersion,
  InformationPolicyBindingSummary,
} from "../src/lib/types";

const hash = `sha256:${"a".repeat(64)}`;
const policy: InformationPolicyBindingSummary = {
  schemaVersion: "stratos-information-policy-2",
  policyBindingId: "pb_akb_public_12345678",
  policyVersion: "information-policy-2.0.0",
  handlingClass: "PUBLIC",
  legalClassification: "NONE",
  tlp: "TLP:CLEAR",
  pap: "PAP:CLEAR",
  contentCategories: ["PUBLIC_INFORMATION"],
  audience: {
    organizationId: "org_stratos",
    scopeType: "public",
  },
  obligations: ["AUDIT_ACCESS"],
};

const document = {
  document_id: "doc_public",
  policy_binding_id: policy.policyBindingId,
  policy_version: policy.policyVersion,
  policy_hash: hash,
  policy_summary: policy,
} as Document;

const version = {
  document_id: document.document_id,
  document_version_id: "ver_public_1",
  version_label: "1.0",
  policy_binding_id: policy.policyBindingId,
  policy_version: policy.policyVersion,
  policy_hash: hash,
  policy_summary: policy,
} as DocumentVersion;

const publication = {
  document_id: document.document_id,
  document_version_id: version.document_version_id,
  source_version: version.document_version_id,
  policy_binding_id: policy.policyBindingId,
  policy_version: policy.policyVersion,
  policy_hash: hash,
  status: "PUBLISHED",
  public_slug: "public-example",
  published_at: "2026-07-13T10:00:00Z",
  revoked_at: null,
} as DocumentPublication;

describe("AKB information policy display", () => {
  it("uses the immutable version coordinates and verified publication lineage", () => {
    const details = versionInformationPolicyDetails(version, publication);
    assert.equal(details?.policyBindingId, policy.policyBindingId);
    assert.equal(details?.audience.scopeType, "public");
    assert.deepEqual(details?.publication, {
      status: "PUBLISHED",
      publicSlug: "public-example",
      publishedAt: "2026-07-13T10:00:00Z",
      revokedAt: null,
    });
  });

  it("distinguishes a known missing publication from an unavailable status", () => {
    assert.deepEqual(versionInformationPolicyDetails(version, null)?.publication, {
      status: "NOT_PUBLISHED",
    });
    assert.equal(versionInformationPolicyDetails(version)?.publication, null);
  });

  it("fails closed on stale policy or publication coordinates", () => {
    assert.equal(
      documentInformationPolicyDetails({ ...document, policy_binding_id: "pb_stale_binding_12345678" }),
      null,
    );
    assert.equal(
      versionInformationPolicyDetails(version, {
        ...publication,
        policy_hash: `sha256:${"b".repeat(64)}`,
      })?.publication,
      null,
    );
  });
});
