import type { DocumentVersion, IngestionJob } from "@/lib/types";

export interface ExternalUploadIdentity {
  document_id: string;
  tenant_id: string;
  external_system: string;
  external_ref: string;
}

export interface ExpectedExternalUploadIdentity {
  documentId: string;
  tenantId?: string | null;
  externalSystem?: string | null;
  externalRef?: string | null;
}

export type UploadVersionResolution =
  | { kind: "create" }
  | { kind: "replay"; version: DocumentVersion }
  | { kind: "conflict"; version: DocumentVersion };

export function resolveUploadVersion(
  versions: readonly DocumentVersion[],
  versionLabel: string,
  fileHash: string,
): UploadVersionResolution {
  const normalizedLabel = versionLabel.trim();
  const sameLabel = versions.find((version) => version.version_label === normalizedLabel);
  if (!sameLabel) return { kind: "create" };
  if (normalizeHash(sameLabel.file_hash) === normalizeHash(fileHash)) {
    return { kind: "replay", version: sameLabel };
  }
  return { kind: "conflict", version: sameLabel };
}

export function latestIngestionJobForVersion(
  jobs: readonly IngestionJob[],
  documentVersionId: string,
): IngestionJob | null {
  return jobs
    .filter((job) => job.document_version_id === documentVersionId)
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0] ?? null;
}

export function externalUploadIdentityMismatches(
  actual: ExternalUploadIdentity,
  expected: ExpectedExternalUploadIdentity,
): string[] {
  const mismatches: string[] = [];
  if (actual.document_id !== expected.documentId) mismatches.push("document_id");
  if (expected.tenantId && actual.tenant_id !== expected.tenantId) mismatches.push("tenant_id");
  if (expected.externalSystem && actual.external_system !== expected.externalSystem) {
    mismatches.push("external_system");
  }
  if (expected.externalRef && actual.external_ref !== expected.externalRef) mismatches.push("external_ref");
  return mismatches;
}

function normalizeHash(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}
