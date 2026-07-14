import type {
  Document,
  EntitySearchHit,
  IntelligenceDocumentCoordinate,
} from "@/lib/types";

export interface AuthorizedIndexSelection {
  documentIds: string[];
  policyHashes?: Record<string, string[]>;
  documentVersions?: Record<string, string[]>;
}

export function exactAuthorizedIndexSelection(
  documents: IntelligenceDocumentCoordinate[],
): AuthorizedIndexSelection {
  return {
    documentIds: documents.map((document) => document.document_id),
    policyHashes: Object.fromEntries(
      documents.map((document) => [document.document_id, [document.policy_hash]]),
    ),
    documentVersions: Object.fromEntries(
      documents.map((document) => [
        document.document_id,
        [document.document_version_id],
      ]),
    ),
  };
}

/**
 * Produces candidates only. A Registry-issued intelligence authorization is
 * the sole source of exact versions and policy hashes; document DTO fields or
 * static token roles must never be promoted into an authorization decision.
 */
export function candidateIndexSelection(
  documents: Document[],
): AuthorizedIndexSelection {
  return {
    documentIds: [...new Set(documents.map((document) => document.document_id))]
      .filter(Boolean)
      .sort(),
  };
}

export function indexHitMatchesSelection(
  hit: Pick<EntitySearchHit, "document_id" | "document_version_id" | "policy_hash">,
  selection: AuthorizedIndexSelection,
): boolean {
  if (!selection.documentIds.includes(hit.document_id)) return false;
  if (
    selection.documentVersions &&
    !selection.documentVersions[hit.document_id]?.includes(hit.document_version_id)
  ) {
    return false;
  }
  if (!selection.policyHashes) return true;
  return Boolean(hit.policy_hash && selection.policyHashes[hit.document_id]?.includes(hit.policy_hash));
}
