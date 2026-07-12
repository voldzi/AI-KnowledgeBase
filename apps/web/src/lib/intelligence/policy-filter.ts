import type { ApiRequestContext, Document, EntitySearchHit } from "@/lib/types";

export interface AuthorizedIndexSelection {
  documentIds: string[];
  policyHashes?: Record<string, string[]>;
}

export function authorizedIndexSelection(
  documents: Document[],
  context: Pick<ApiRequestContext, "roles" | "capabilities">,
): AuthorizedIndexSelection {
  if (!usesCapabilityModel(context)) {
    return { documentIds: documents.map((document) => document.document_id) };
  }

  const policyHashes: Record<string, string[]> = {};
  for (const document of documents) {
    if (document.policy_hash) {
      policyHashes[document.document_id] = [document.policy_hash];
    }
  }
  return {
    documentIds: Object.keys(policyHashes),
    policyHashes,
  };
}

export function indexHitMatchesSelection(
  hit: Pick<EntitySearchHit, "document_id" | "policy_hash">,
  selection: AuthorizedIndexSelection,
): boolean {
  if (!selection.documentIds.includes(hit.document_id)) return false;
  if (!selection.policyHashes) return true;
  return Boolean(hit.policy_hash && selection.policyHashes[hit.document_id]?.includes(hit.policy_hash));
}

function usesCapabilityModel(
  context: Pick<ApiRequestContext, "roles" | "capabilities">,
): boolean {
  return Boolean(
    context.capabilities?.length
    || context.roles?.some((role) => role === "stratos_user" || role === "stratos_admin")
  );
}
