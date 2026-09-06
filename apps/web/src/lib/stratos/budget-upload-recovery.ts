import { ApiClientError, type DocumentVersion } from "@/lib/types";
import {
  verifyPersistedUploadedObject,
  type UploadSettings,
  type UploadTokenPayload,
} from "@/lib/upload/preflight";

/** Verify the original Registry object after the new session was verified. */
export async function verifyCanonicalBudgetUploadObject(input: {
  version: DocumentVersion;
  upload: UploadTokenPayload;
  settings: UploadSettings;
  scanRequired: boolean;
}): Promise<void> {
  const { version, upload, settings, scanRequired } = input;
  if (
    version.document_id !== upload.document_id
    || version.file_hash !== upload.sha256
    || !version.file_id
    || version.policy_binding_id !== upload.policy_binding_id
    || version.policy_version !== upload.policy_version
    || version.policy_hash !== upload.policy_hash
  ) {
    throw new ApiClientError(
      "Registry returned a conflicting canonical Budget upload identity.",
      502,
      "STRATOS_BUDGET_VERSION_CONFLICT",
      upload.governance_correlation_id ?? "web-stratos-budget-bridge",
    );
  }
  if (scanRequired && (
    version.content_security_status !== "clean"
    || version.content_security_engine !== "clamav"
    || !Number.isFinite(Date.parse(version.content_security_scanned_at ?? ""))
  )) {
    throw new ApiClientError(
      "The canonical Budget file has no confirmed clean intake evidence.",
      409,
      "DOCUMENT_INTAKE_SCAN_REQUIRED",
      upload.governance_correlation_id ?? "web-stratos-budget-bridge",
    );
  }

  if (version.source_file_uri === upload.source_file_uri) return;

  // Only the configured bucket and the exact document's generated intake keys
  // may be read. A Registry response cannot turn recovery into a URL fetch or
  // a lookup in another document's object-storage namespace.
  const prefix = `s3://${settings.bucket}/`;
  const objectKey = version.source_file_uri.startsWith(prefix)
    ? version.source_file_uri.slice(prefix.length)
    : "";
  const segments = objectKey.split("/");
  if (
    segments.length !== 5
    || segments[0] !== upload.document_id
    || segments[1] !== "draft"
    || !/^\d{4}-\d{2}-\d{2}$/.test(segments[2] ?? "")
    || !/^upl_[a-f0-9]{32}$/.test(segments[3] ?? "")
    || segments[4] !== upload.file_name
    || segments.some((segment) => !segment || /[\\%?#\u0000-\u001f]/.test(segment)
      || segment === "." || segment === "..")
  ) {
    throw new ApiClientError(
      "Registry returned an invalid canonical Budget upload object.",
      502,
      "STRATOS_BUDGET_SOURCE_CONFLICT",
      upload.governance_correlation_id ?? "web-stratos-budget-bridge",
    );
  }

  // These coordinates are used only for storage verification, never issued as
  // a signed session. Hash, size and file metadata remain the verified input.
  await verifyPersistedUploadedObject({
    ...upload,
    bucket: settings.bucket,
    object_key: objectKey,
    source_file_uri: version.source_file_uri,
  }, settings);
}
