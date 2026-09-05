import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseInformationPolicy,
  parseStratosBudgetIntegrationEnvelope,
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

  it("accepts only a canonical, contract-bound STRATOS_BUDGET envelope and budget scope", () => {
    const parsedPolicy = parseInformationPolicy(policy());
    const canonicalHash = policyHash(parsedPolicy);
    const envelope = {
      schemaVersion: "stratos-integration-envelope-1",
      organizationId: "org_stratos",
      sourceSystem: "STRATOS_BUDGET",
      externalRef: "contract:contract-123:document:dodatek-01",
      actor: { type: "person", subjectId: "subject-budget-123" },
      correlationId: "corr-budget-12345678",
      idempotencyKey: "budget-contract-upload:12345678",
      policyBindingId: parsedPolicy.policyBindingId,
      policyVersion: parsedPolicy.policyVersion,
      policyHash: canonicalHash,
      classification: {
        handlingClass: parsedPolicy.handlingClass,
        legalClassification: "NONE",
        tlp: parsedPolicy.tlp,
        pap: parsedPolicy.pap
      },
      payload: {
        contractId: "contract-123",
        financialScopeKey: "budget:sekce-it",
        fileHash: `sha256:${"b".repeat(64)}`
      }
    };
    const governanceScope = { type: "budget_scope", id: "budget:sekce-it" };

    const parsedEnvelope = parseStratosBudgetIntegrationEnvelope(
      envelope,
      parsedPolicy,
      governanceScope,
    );
    assert.equal(parsedEnvelope.sourceSystem, "STRATOS_BUDGET");
    assert.equal(parsedEnvelope.payload.contractId, "contract-123");
    assert.equal(parsedEnvelope.payload.financialScopeKey, "budget:sekce-it");
    assert.equal(parsedEnvelope.policyHash, canonicalHash);

    assert.throws(() => parseStratosBudgetIntegrationEnvelope(
      { ...envelope, unsupportedField: true },
      parsedPolicy,
      governanceScope,
    ));
    assert.throws(() => parseStratosBudgetIntegrationEnvelope(
      { ...envelope, payload: { ...envelope.payload, metadata: {} } },
      parsedPolicy,
      governanceScope,
    ));
    assert.throws(() => parseStratosBudgetIntegrationEnvelope(
      { ...envelope, policyHash: `sha256:${"f".repeat(64)}` },
      parsedPolicy,
      governanceScope,
    ));
    assert.throws(() => parseStratosBudgetIntegrationEnvelope(
      envelope,
      parsedPolicy,
      { type: "organization", id: "org_stratos" },
    ));
    assert.throws(() => parseStratosBudgetIntegrationEnvelope(
      { ...envelope, externalRef: "contract:another-contract" },
      parsedPolicy,
      governanceScope,
    ));
    assert.throws(() => parseStratosBudgetIntegrationEnvelope(
      { ...envelope, actor: { type: "service", subjectId: "service-budget" } },
      parsedPolicy,
      governanceScope,
    ));
  });
});
