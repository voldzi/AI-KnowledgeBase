import type { DocumentVersion } from "@/lib/types";

export function latestDocumentVersion(versions: DocumentVersion[]): DocumentVersion | undefined {
  return [...versions].sort((left, right) => right.created_at.localeCompare(left.created_at)
    || right.document_version_id.localeCompare(left.document_version_id))[0];
}

export function selectedDocumentVersion(versions: DocumentVersion[], requestedId: string | null | undefined): DocumentVersion | undefined {
  if (requestedId) return versions.find((version) => version.document_version_id === requestedId);
  return versions.find((version) => version.status === "valid") ?? latestDocumentVersion(versions);
}
