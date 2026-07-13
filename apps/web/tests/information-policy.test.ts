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

  it("binds the integration envelope to the exact policy hash", () => {
    const parsed = parseInformationPolicy(policy());
    const envelope = {
      schemaVersion: "stratos-integration-envelope-1",
      organizationId: "org_stratos",
      sourceSystem: "STRATOS_AIIP",
      externalRef: "idea-123",
      actor: { type: "service", subjectId: "aiip-service" },
      correlationId: "corr-12345678",
      idempotencyKey: "idem-12345678",
      policyBindingId: parsed.policyBindingId,
      policyVersion: parsed.policyVersion,
      policyHash: policyHash(parsed),
      classification: {
        handlingClass: parsed.handlingClass,
        legalClassification: "NONE",
        tlp: null,
        pap: null
      },
      payload: { documentType: "ai_requirement_card" }
    };
    assert.equal(parseIntegrationEnvelope(envelope, parsed)?.policyHash, policyHash(parsed));
    assert.throws(() => parseIntegrationEnvelope({ ...envelope, policyHash: `sha256:${"f".repeat(64)}` }, parsed));
  });
});
