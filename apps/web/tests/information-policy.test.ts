import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseInformationPolicy,
  parseIntegrationEnvelope,
  policyHash
} from "../src/lib/stratos/information-policy";

function policy() {
  return {
    schemaVersion: "stratos-information-policy-2",
    policyBindingId: "pol_crosslang01",
    policyVersion: "information-policy-2.0.0",
    handlingClass: "INTERNAL",
    legalClassification: "NONE",
    tlp: null,
    pap: null,
    contentCategories: ["CONTRACTUAL"],
    audience: {
      organizationId: "org_stratos",
      scopeType: "organization",
      scopeIds: [],
      recipientSubjectIds: []
    },
    obligations: ["AUDIT_ACCESS"],
    originatorId: "user_owner",
    issuedAt: "2026-07-12T10:00:00Z",
    reviewAt: null
  };
}

describe("STRATOS Information Policy V2", () => {
  it("accepts both Registry-generated pol_ and central pb_ binding ids", () => {
    assert.equal(parseInformationPolicy(policy()).policyBindingId, "pol_crosslang01");
    assert.equal(
      parseInformationPolicy({ ...policy(), policyBindingId: "pb_budget_projectflow_12345678" }).policyBindingId,
      "pb_budget_projectflow_12345678"
    );
    assert.throws(() => parseInformationPolicy({ ...policy(), policyBindingId: "binding_unregistered" }));
  });

  it("uses the same canonical SHA-256 as the Registry implementation", () => {
    const parsed = parseInformationPolicy(policy());
    assert.equal(policyHash(parsed), "sha256:001a7b09fc623cd5ddd2e477d8809ed8628a5c8659b92f8ff5e10cc7343bc930");
  });

  it("rejects classified content and unknown obligations", () => {
    assert.throws(
      () => parseInformationPolicy({ ...policy(), legalClassification: "D" }),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "LEGAL_CLASSIFICATION_UNSUPPORTED")
    );
    assert.throws(
      () => parseInformationPolicy({ ...policy(), obligations: ["UNKNOWN"] }),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "POLICY_OBLIGATION_UNKNOWN")
    );
  });

  it("preserves the Registry-issued policy hash for central governance verification", () => {
    const parsed = parseInformationPolicy(policy());
    const authoritativePolicyHash = `sha256:${"f".repeat(64)}`;
    const envelope = {
      schemaVersion: "stratos-integration-envelope-1",
      organizationId: "org_stratos",
      sourceSystem: "STRATOS_AIIP",
      externalRef: "aiip:idea:idea-123:requirement-card",
      actor: { type: "person", subjectId: "subject-aiip-123" },
      sourceResource: {
        governedResourceId: "gres-aiip-idea-123",
        application: "AIIP",
        resourceType: "idea",
        resourceId: "idea-123",
        sourceVersion: "idea-123-v1",
        scope: { type: "organization", id: "org_stratos" }
      },
      correlationId: "corr-12345678",
      idempotencyKey: "idem-12345678",
      policyBindingId: parsed.policyBindingId,
      policyVersion: parsed.policyVersion,
      policyHash: authoritativePolicyHash,
      classification: {
        handlingClass: parsed.handlingClass,
        legalClassification: "NONE",
        tlp: null,
        pap: null
      },
      payload: {
        operation: "document_upload",
        entityType: "InnovationRequest",
        entityId: "idea-123",
        sourceDocumentId: "/ideas/idea-123/documents/source-1",
        sha256: `sha256:${"a".repeat(64)}`
      }
    };
    const parsedEnvelope = parseIntegrationEnvelope(envelope, parsed);
    assert.equal(parsedEnvelope?.policyHash, authoritativePolicyHash);
    assert.equal(parsedEnvelope?.externalRef, "aiip:idea:idea-123:requirement-card");
    assert.equal(parsedEnvelope?.sourceResource.resourceId, "idea-123");
    assert.notEqual(parsedEnvelope?.externalRef, parsedEnvelope?.sourceResource.resourceId);
    assert.throws(() => parseIntegrationEnvelope({ ...envelope, policyHash: "sha256:not-a-digest" }, parsed));
    assert.throws(() => parseIntegrationEnvelope({ ...envelope, actor: { ...envelope.actor, delegated: true } }, parsed));
    assert.throws(() => parseIntegrationEnvelope({ ...envelope, payload: { ...envelope.payload, metadata: {} } }, parsed));
    assert.throws(() => parseIntegrationEnvelope({
      ...envelope,
      classification: { ...envelope.classification, legacy: "internal" }
    }, parsed));
  });
});
