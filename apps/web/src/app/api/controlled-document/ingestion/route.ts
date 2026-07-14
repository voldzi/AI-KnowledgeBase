import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { ingestionServiceRequestContext } from "@/lib/ingestion/service-identity";
import type { CreateIngestionJobRequest } from "@/lib/types";
import { assertUploadMatchesIngestionPayload, UploadPreflightError } from "@/lib/upload/preflight";

import { badRequest, bridgeError } from "../errors";
import { uploadErrorResponse } from "../upload/errors";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const context = await getServerRequestContext();
    const clients = getServerApiClients();
    const documentId = String(body.document_id ?? "").trim();
    const sourceFileUri = String(body.source_file_uri ?? "").trim();
    const uploadToken = body.upload_token ? String(body.upload_token).trim() : "";
    const uploadSessionId = body.upload_session_id ? String(body.upload_session_id).trim() : "";

    if (!documentId) {
      return badRequest("document_id is required.");
    }

    if (!sourceFileUri) {
      return badRequest("source_file_uri is required.");
    }

    let uploadPayload = null;
    if (uploadToken) {
      uploadPayload = assertUploadMatchesIngestionPayload(uploadToken, {
        document_id: documentId,
        upload_session_id: uploadSessionId,
        source_file_uri: sourceFileUri,
        file_hash: body.file_hash ? String(body.file_hash).trim() : null,
        file_name: body.file_name ? String(body.file_name).trim() : null,
        file_size: Number.isFinite(Number(body.file_size)) ? Number(body.file_size) : null,
        file_type: body.file_type ? String(body.file_type).trim() : null
      });
    }

    const [document, currentAttempt] = await Promise.all([
      clients.registry.getDocument(documentId, context),
      clients.registry.getDocumentIngestionAttempt(documentId, context),
    ]);
    if (
      uploadPayload &&
      (document.policy_binding_id !== uploadPayload.policy_binding_id ||
        document.policy_version !== uploadPayload.policy_version ||
        document.policy_hash !== uploadPayload.policy_hash)
    ) {
      return badRequest("Document policy changed after upload preflight.", 409);
    }

    const version = await clients.registry.createDocumentVersion(
      documentId,
      {
        version_label: String(body.version_label ?? "1.0").trim(),
        valid_from: body.valid_from ? String(body.valid_from) : new Date().toISOString().slice(0, 10),
        valid_to: body.valid_to ? String(body.valid_to) : null,
        source_file_uri: sourceFileUri,
        file_hash: body.file_hash ? String(body.file_hash).trim() : null,
        change_summary: String(body.change_summary ?? "Controlled document workflow upload.").trim(),
        file: body.file_name
          ? {
              filename: String(body.file_name).trim(),
              mime_type: body.file_type ? String(body.file_type).trim() : null,
              size_bytes: Number.isFinite(Number(body.file_size)) ? Number(body.file_size) : null,
              sha256: body.file_hash ? String(body.file_hash).trim() : null,
              uploaded_by: context.subjectId
            }
          : null
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
      expected_current_ingestion_job_id: currentAttempt?.ingestion_job_id ?? null,
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
    const job = await clients.ingestion.createJob(
      jobRequest,
      ingestionContext,
      {
        delegatedActorSubjectId: authorization.confirmed_subject_id,
        authorizationToken: authorization.authorization_token,
      },
    );

    return NextResponse.json({ version, job }, { status: 201 });
  } catch (error) {
    if (error instanceof UploadPreflightError) {
      return uploadErrorResponse(error);
    }
    return bridgeError(error);
  }
}
