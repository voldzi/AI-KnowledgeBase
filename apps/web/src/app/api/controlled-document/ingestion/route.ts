import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import { ingestionJobIdForIdempotencyKey, ingestionServiceRequestContext } from "@/lib/ingestion/service-identity";
import type { CreateIngestionJobRequest } from "@/lib/types";
import { parseDocumentVersionProfileInput } from "@/lib/documents/document-profile-validation";
import {
  assertUploadMatchesIngestionPayload,
  assertUploadTokenPurpose,
  CONTROLLED_DOCUMENT_UPLOAD_TOKEN_PURPOSE,
  getUploadSettings,
  requireCleanIntakeReceipt,
  UploadPreflightError,
  verifyPersistedUploadedObject,
  verifyUploadReceipt,
} from "@/lib/upload/preflight";
import { getContentSecuritySettings } from "@/lib/upload/content-security";
import { authorizeControlledDocumentUpload } from "@/lib/upload/document-intake-authorization";
import { canonicalDocumentSnapshot } from "@/lib/documents/document-profile";

import { badRequest, bridgeError } from "../errors";
import { uploadErrorResponse } from "../upload/errors";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const context = await getServerRequestContextForRequest(request);
    const clients = getServerApiClients();
    const documentId = String(body.document_id ?? "").trim();
    const sourceFileUri = String(body.source_file_uri ?? "").trim();
    const uploadToken = body.upload_token ? String(body.upload_token).trim() : "";
    const uploadReceipt = body.upload_receipt ? String(body.upload_receipt).trim() : "";
    const uploadSessionId = body.upload_session_id ? String(body.upload_session_id).trim() : "";
    const documentProfile = parseDocumentVersionProfileInput(body.document_profile);

    if (!documentId) {
      return badRequest("document_id is required.");
    }

    if (!sourceFileUri) {
      return badRequest("source_file_uri is required.");
    }

    if (!uploadToken || !uploadReceipt || !uploadSessionId) {
      throw new UploadPreflightError(
        400,
        "DOCUMENT_INTAKE_PROOF_REQUIRED",
        "upload_token, upload_receipt and upload_session_id are required.",
      );
    }
    const uploadSettings = getUploadSettings();
    const uploadPayload = assertUploadMatchesIngestionPayload(uploadToken, {
      document_id: documentId,
      upload_session_id: uploadSessionId,
      source_file_uri: sourceFileUri,
      file_hash: body.file_hash ? String(body.file_hash).trim() : null,
      file_name: body.file_name ? String(body.file_name).trim() : null,
      file_size: Number.isFinite(Number(body.file_size)) ? Number(body.file_size) : null,
      file_type: body.file_type ? String(body.file_type).trim() : null
    });
    assertUploadTokenPurpose(uploadPayload, CONTROLLED_DOCUMENT_UPLOAD_TOKEN_PURPOSE);
    if (!Object.hasOwn(uploadPayload, "expected_current_ingestion_job_id")) {
      throw new UploadPreflightError(409, "UPLOAD_PREDECESSOR_REQUIRED", "Prepare the upload again to bind its ingestion predecessor.");
    }
    if (canonicalDocumentSnapshot(documentProfile) !== canonicalDocumentSnapshot(uploadPayload.document_profile ?? null)) {
      return badRequest("Version metadata differs from its signed upload preparation.", 409);
    }
    await authorizeControlledDocumentUpload({ registry: clients.registry, context, documentId, payload: uploadPayload });
    const receiptPayload = verifyUploadReceipt(
      uploadReceipt,
      uploadToken,
      uploadPayload,
      uploadSettings,
    );
    requireCleanIntakeReceipt(
      receiptPayload,
      getContentSecuritySettings().required,
    );
    await verifyPersistedUploadedObject(uploadPayload, uploadSettings);

    const document = await clients.registry.getDocument(documentId, context);
    if (
      document.policy_binding_id !== uploadPayload.policy_binding_id ||
        document.policy_version !== uploadPayload.policy_version ||
        document.policy_hash !== uploadPayload.policy_hash
    ) {
      return badRequest("Document policy changed after upload preflight.", 409);
    }
    if (document.current_root_metadata_revision !== documentProfile.expected_root_metadata_revision) {
      return badRequest("Document metadata changed after version preparation.", 409);
    }

    const version = await clients.registry.createDocumentVersion(
      documentId,
      {
        document_profile: documentProfile,
        version_label: String(body.version_label ?? "1.0").trim(),
        valid_from: documentProfile.lifecycle.effectiveFrom,
        valid_to: documentProfile.lifecycle.effectiveTo,
        source_file_uri: sourceFileUri,
        file_hash: uploadPayload.sha256,
        change_summary: String(body.change_summary ?? "Controlled document workflow upload.").trim(),
        file: {
              filename: uploadPayload.file_name,
              mime_type: uploadPayload.file_type,
              size_bytes: uploadPayload.file_size,
              sha256: uploadPayload.sha256,
              uploaded_by: context.subjectId,
              intake_receipt: uploadReceipt,
            }
      },
      context
    );
    const idempotencyKey = `controlled:${version.document_version_id}`;
    const jobRequest: CreateIngestionJobRequest = {
      idempotency_key: idempotencyKey,
      document_id: documentId,
      document_version_id: version.document_version_id,
      source_file_uri: sourceFileUri,
      parser_profile: body.parser_profile ?? "controlled_document",
      ocr_enabled: body.ocr_enabled !== false,
      chunking_strategy: body.chunking_strategy ?? "legal_structured",
      embedding_profile: String(body.embedding_profile ?? "default"),
      // The signed predecessor is immutable across lost replies, including
      // after the first job has become the document's current attempt.
      expected_current_ingestion_job_id: uploadPayload.expected_current_ingestion_job_id,
    };
    const correlationId = context.correlationId ?? context.requestId ?? crypto.randomUUID();
    const authorization = await clients.registry.createIngestionAuthorization(
      documentId,
      version.document_version_id,
      {
        action: "document.ingest",
        correlation_id: correlationId,
        idempotency_key: idempotencyKey,
      },
      { ...context, requestId: correlationId, correlationId },
    );
    if (
      authorization.confirmed_subject_id !== context.subjectId ||
      authorization.document_id !== documentId ||
      authorization.document_version_id !== version.document_version_id ||
      authorization.correlation_id !== correlationId ||
      authorization.idempotency_key !== idempotencyKey
    ) {
      throw new Error("Registry returned a conflicting ingestion authorization.");
    }
    const ingestionContext = await ingestionServiceRequestContext(correlationId);
    let job = await clients.ingestion.createJob(
      jobRequest,
      ingestionContext,
      {
        delegatedActorSubjectId: authorization.confirmed_subject_id,
        authorizationToken: authorization.authorization_token,
      },
    );
    if (["pending_authorization", "claiming"].includes(job.status)) {
      job = await clients.ingestion.createJob(jobRequest, ingestionContext, {
        delegatedActorSubjectId: authorization.confirmed_subject_id,
        authorizationToken: authorization.authorization_token,
      });
    }
    if (job.job_id !== ingestionJobIdForIdempotencyKey(idempotencyKey)
      || job.document_id !== documentId || job.document_version_id !== version.document_version_id
      || ["pending_authorization", "claiming"].includes(job.status)) {
      throw new UploadPreflightError(503, "INGESTION_ACTIVATION_FAILED", "The ingestion attempt was not activated for the exact immutable version.");
    }

    return NextResponse.json({ version, job }, { status: version.idempotent_replay ? 200 : 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof UploadPreflightError) {
      return uploadErrorResponse(error);
    }
    return bridgeError(error);
  }
}
