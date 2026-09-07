import type { DocumentProfileInput, DocumentVersionProfileInput, DocumentRootSnapshot } from "../../src/lib/documents/document-profile";

// Explicit local catalog fixtures. These references are test inputs, never authority proofs.
export function budgetContractProfile(): DocumentProfileInput {
  return {
    profile: { id: "akb.contract", revision: "1" },
    authorship: [{ kind: "organization", id: "supplier-test", evidenceReference: "contract-signatures-test" }],
    provenance: { sourceSystem: "STRATOS_BUDGET", sourceRecordId: "contract-123", sourceGovernedResourceId: "gres_budget_contract_123" },
    accountability: { ownerSubjectId: "subject-document-owner", gestor: { kind: "organization_unit", id: "legal-test" } },
  };
}

export function contractVersionProfile(): DocumentVersionProfileInput {
  return {
    expected_root_metadata_revision: "root-revision-test-1",
    lifecycle: { mode: "fixed_interval", effectiveFrom: "2026-01-01", effectiveTo: "2028-12-31", recordedOn: null,
      reviewAt: "2027-01-01", reviewRuleId: "akb.review.annual", retentionRuleId: "akb.retention.organizational-record" },
    domain_evidence: { family: "contract", contractReference: "contract-123", partyReferences: ["supplier-test", "org_stratos"],
      executionStatus: "signed", executionEvidenceReference: "contract-signatures-test" },
  };
}

export function nativeContractSnapshot(documentId: string): DocumentRootSnapshot {
  const profile = budgetContractProfile();
  return { ...profile, schemaVersion: "stratos-document-root-1", organizationId: "org_stratos", documentId,
    metadataRevision: "root-revision-test-1", documentType: "contract",
    provenance: { sourceSystem: "AKB", sourceRecordId: documentId, sourceGovernedResourceId: null } };
}
