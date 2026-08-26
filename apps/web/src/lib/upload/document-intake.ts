import {
  effectiveIntakeMaxFileBytes,
  getContentSecuritySettings,
  inspectDocumentContent,
  type ContentSecurityResult,
} from "@/lib/upload/content-security";
import {
  createUploadReceipt,
  persistQuarantinedUploadObject,
  promoteQuarantinedUploadObject,
  readBoundedUploadContent,
  retainQuarantinedUploadObject,
  UploadPreflightError,
  type UploadReceiptContentSecurity,
  type UploadSettings,
  type UploadTokenPayload,
} from "@/lib/upload/preflight";
import { withAppBasePath } from "@/lib/app-url";

export const DOCUMENT_INTAKE_CONTENT_BASE_PATH = "/api/document-intake/v1/sessions";

const SUPPORTED_UPLOAD_PURPOSES = new Set([
  "controlled-document-upload",
  "official-public-source-sync",
  "stratos-budget-upload",
]);

export interface DocumentIntakeAcceptedUpload {
  uploaded: true;
  intake_status: "clean" | "accepted_without_external_scan";
  upload_receipt: string;
  upload_session_id: string;
  source_file_uri: string;
  file: {
    filename: string;
    mime_type: string;
    size_bytes: number;
    sha256: string;
  };
  content_security: UploadReceiptContentSecurity;
}

export function applyDocumentIntakeSettings(
  settings: UploadSettings,
): UploadSettings {
  return {
    ...settings,
    maxFileBytes: effectiveIntakeMaxFileBytes(settings.maxFileBytes),
    publicUploadBasePath: withAppBasePath(DOCUMENT_INTAKE_CONTENT_BASE_PATH),
  };
}

export function assertDocumentIntakePurpose(payload: UploadTokenPayload): void {
  if (!payload.purpose || !SUPPORTED_UPLOAD_PURPOSES.has(payload.purpose)) {
    throw new UploadPreflightError(
      401,
      "UPLOAD_TOKEN_PURPOSE_MISMATCH",
      "Upload token is not valid for the Document Intake endpoint.",
    );
  }
}

export async function acceptDocumentIntakeContent(input: {
  request: Request;
  sessionId: string;
  uploadToken: string;
  payload: UploadTokenPayload;
  settings: UploadSettings;
}): Promise<DocumentIntakeAcceptedUpload> {
  const { request, sessionId, uploadToken, payload } = input;
  const settings = applyDocumentIntakeSettings(input.settings);
  assertDocumentIntakePurpose(payload);
  assertRequestMatchesSignedUpload(request, sessionId, payload);

  const content = await readBoundedUploadContent(request, payload, settings);
  return acceptDocumentIntakeBytes({
    content,
    sessionId,
    uploadToken,
    payload,
    settings,
  });
}

export async function acceptDocumentIntakeBytes(input: {
  content: Uint8Array;
  sessionId: string;
  uploadToken: string;
  payload: UploadTokenPayload;
  settings: UploadSettings;
}): Promise<DocumentIntakeAcceptedUpload> {
  const { content, sessionId, uploadToken, payload } = input;
  const settings = applyDocumentIntakeSettings(input.settings);
  assertDocumentIntakePurpose(payload);
  if (payload.session_id !== sessionId) {
    throw new UploadPreflightError(
      400,
      "UPLOAD_SESSION_MISMATCH",
      "Upload session id does not match the signed upload token.",
    );
  }

  const quarantined = await persistQuarantinedUploadObject(payload, content, settings);
  let securityResult: ContentSecurityResult;
  try {
    securityResult = await inspectDocumentContent(
      content,
      payload.file_type,
      getContentSecuritySettings(),
    );
  } catch (error) {
    const outcome = error instanceof UploadPreflightError
      && error.code === "UPLOAD_MALWARE_DETECTED"
      ? "infected"
      : "failed";
    await retainQuarantinedUploadObject(payload, quarantined, outcome, settings)
      .catch(() => undefined);
    logDocumentIntakeEvent(payload, {
      event: outcome === "infected"
        ? "document.intake.malware_detected"
        : "document.intake.scan_failed",
      result: outcome,
      error_code: error instanceof UploadPreflightError ? error.code : "CONTENT_SECURITY_ERROR",
    });
    throw error;
  }

  const persisted = await promoteQuarantinedUploadObject(
    payload,
    quarantined,
    settings,
  );
  const receiptSecurity = toReceiptSecurity(securityResult);
  const uploadReceipt = createUploadReceipt(
    uploadToken,
    payload,
    persisted,
    settings,
    receiptSecurity,
  );
  logDocumentIntakeEvent(payload, {
    event: "document.intake.accepted",
    result: receiptSecurity.status,
    engine: receiptSecurity.engine,
    duration_ms: receiptSecurity.duration_ms,
  });
  return {
    uploaded: true,
    intake_status: receiptSecurity.status === "clean"
      ? "clean"
      : "accepted_without_external_scan",
    upload_receipt: uploadReceipt,
    upload_session_id: payload.session_id,
    source_file_uri: payload.source_file_uri,
    file: {
      filename: payload.file_name,
      mime_type: payload.file_type,
      size_bytes: persisted.size_bytes,
      sha256: persisted.sha256,
    },
    content_security: receiptSecurity,
  };
}

function assertRequestMatchesSignedUpload(
  request: Request,
  sessionId: string,
  payload: UploadTokenPayload,
): void {
  if (payload.session_id !== sessionId) {
    throw new UploadPreflightError(
      400,
      "UPLOAD_SESSION_MISMATCH",
      "Upload session id does not match the signed upload token.",
    );
  }
  const declaredSha256 = request.headers.get("X-AKL-Content-SHA256")?.trim().toLowerCase() ?? "";
  if (!declaredSha256) {
    throw new UploadPreflightError(
      400,
      "UPLOAD_HASH_HEADER_REQUIRED",
      "X-AKL-Content-SHA256 is required.",
    );
  }
  if (declaredSha256 !== payload.sha256) {
    throw new UploadPreflightError(
      400,
      "UPLOAD_HASH_HEADER_MISMATCH",
      "X-AKL-Content-SHA256 does not match the signed upload token.",
    );
  }
  const declaredContentType = request.headers.get("Content-Type")?.trim().toLowerCase() ?? "";
  if (!declaredContentType || declaredContentType !== payload.file_type) {
    throw new UploadPreflightError(
      415,
      "UPLOAD_CONTENT_TYPE_MISMATCH",
      "Content-Type must exactly match the signed upload decision.",
    );
  }
}

function toReceiptSecurity(
  result: ContentSecurityResult,
): UploadReceiptContentSecurity {
  if (result.status !== "clean" && result.status !== "not_performed") {
    throw new UploadPreflightError(
      503,
      "CONTENT_SECURITY_SCAN_ERROR",
      "Document Intake did not receive a usable content-security verdict.",
    );
  }
  return {
    status: result.status,
    engine: result.engine,
    engine_version: result.engine_version,
    signature_version: result.signature_version,
    scanned_at: result.scanned_at,
    duration_ms: result.duration_ms,
  };
}

function logDocumentIntakeEvent(
  payload: UploadTokenPayload,
  metadata: Record<string, unknown>,
): void {
  console.info(JSON.stringify({
    ...metadata,
    upload_session_id: payload.session_id,
    document_id: payload.document_id,
    size_bytes: payload.file_size,
    mime_type: payload.file_type,
    occurred_at: new Date().toISOString(),
  }));
}
