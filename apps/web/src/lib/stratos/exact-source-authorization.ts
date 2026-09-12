import type { DocumentAuthorizationDecision } from "@/lib/types/api";

export interface ExactSourceAuthorityCoordinates {
  documentId: string;
  documentVersionId: string;
  policyBindingId: string | null;
  policyVersion: string | null;
  policyHash: string | null;
}

export interface ExactSourceAuthorizationFailure {
  code: "EXACT_SOURCE_ACCESS_DENIED" | "EXACT_SOURCE_AUTHORITY_STALE";
  status: 403 | 409;
  message: string;
}

function optionalAuthorityCoordinate(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function exactSourceAuthorizationFailure(
  decision: DocumentAuthorizationDecision,
  expected: ExactSourceAuthorityCoordinates
): ExactSourceAuthorizationFailure | null {
  if (!decision.allowed) {
    return {
      code: "EXACT_SOURCE_ACCESS_DENIED",
      status: 403,
      message: "Current authority denies access to the exact document version."
    };
  }
  const constraints = decision.constraints;
  if (
    constraints.document_id !== expected.documentId ||
    constraints.document_version_id !== expected.documentVersionId ||
    optionalAuthorityCoordinate(constraints.policy_binding_id) !== expected.policyBindingId ||
    optionalAuthorityCoordinate(constraints.policy_version) !== expected.policyVersion ||
    optionalAuthorityCoordinate(constraints.policy_hash) !== expected.policyHash
  ) {
    return {
      code: "EXACT_SOURCE_AUTHORITY_STALE",
      status: 409,
      message: "Current authority did not confirm the requested immutable source coordinates."
    };
  }
  return null;
}
