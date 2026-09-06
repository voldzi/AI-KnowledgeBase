import { NextRequest, NextResponse } from "next/server";
import type { CreateIngestionJobRequest } from "@/lib/types";
import { createApiClients } from "@/lib/api";
import { authenticateStratosDocumentServiceJsonRequest } from "@/lib/stratos/document-service-auth";
import { authorizeSourceUpload, sourceAuthorizationBody, sourceRegistryRequest, SOURCE_UPLOAD_PURPOSE, type SourceConfirmed } from "@/lib/stratos/source-intake";
import { assertUploadTokenPurpose, getUploadSettings, verifyUploadToken, verifyUploadReceipt, requireCleanIntakeReceipt,
  verifyPersistedUploadedObject, UploadPreflightError } from "@/lib/upload/preflight";
import { getContentSecuritySettings } from "@/lib/upload/content-security";
import { ingestionJobIdForIdempotencyKey, ingestionServiceRequestContext } from "@/lib/ingestion/service-identity";
import { canonicalDocumentUrl } from "@/lib/stratos/document-ai";
import { stratosBridgeError } from "../../../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await context.params;
    const { principal: service, body } = await authenticateStratosDocumentServiceJsonRequest(request);
    if (Object.keys(body).some(key => !["upload_token", "upload_receipt"].includes(key))
      || typeof body.upload_token !== "string" || typeof body.upload_receipt !== "string") {
      throw new UploadPreflightError(422, "SOURCE_INTAKE_CONFIRM_INVALID", "Confirm requires only the original upload_token and upload_receipt.");
    }
    const settings = getUploadSettings();
    const payload = verifyUploadToken(body.upload_token, settings);
    assertUploadTokenPurpose(payload, SOURCE_UPLOAD_PURPOSE);
    if (payload.session_id !== sessionId || !Object.hasOwn(payload, "expected_current_ingestion_job_id")) {
      throw new UploadPreflightError(409, "SOURCE_INTAKE_SESSION_CONFLICT", "The signed session or predecessor differs.");
    }
    const actor = await authorizeSourceUpload(request, payload, service);
    const receipt = verifyUploadReceipt(body.upload_receipt, body.upload_token, payload, settings);
    requireCleanIntakeReceipt(receipt, getContentSecuritySettings().required);
    await verifyPersistedUploadedObject(payload, settings);
    const authorizationBody = sourceAuthorizationBody(payload, service);
    const confirmed = await sourceRegistryRequest<SourceConfirmed>(`/documents/${encodeURIComponent(payload.document_id)}/confirm`,
      { ...authorizationBody, source_file_uri: payload.source_file_uri, upload_receipt: body.upload_receipt,
        expected_current_document_version_id: payload.expected_current_document_version_id },
      service, actor, authorizationBody.correlation_id);
    const version = confirmed.version;
    if (version.document_id !== payload.document_id || version.source_file_uri !== payload.source_file_uri
      || version.file_hash !== payload.sha256 || confirmed.external_document_id !== payload.external_document_id) {
      throw new UploadPreflightError(502, "SOURCE_INTAKE_VERSION_CONFLICT", "The confirmed version differs from the uploaded source.");
    }
    const clients = createApiClients();
    const idempotencyKey = `source:${version.document_version_id}`;
    const correlationId = authorizationBody.correlation_id;
    const authorization = await clients.registry.createIngestionAuthorization(payload.document_id, version.document_version_id,
      { action: "document.ingest", correlation_id: correlationId, idempotency_key: idempotencyKey },
      { ...actor, requestId: correlationId, correlationId });
    if (authorization.confirmed_subject_id !== actor.subjectId || authorization.document_id !== payload.document_id
      || authorization.document_version_id !== version.document_version_id || authorization.idempotency_key !== idempotencyKey
      || authorization.correlation_id !== correlationId) {
      throw new UploadPreflightError(502, "SOURCE_INTAKE_INGESTION_CONFLICT", "Ingestion authorization differs from the exact source version.");
    }
    const jobRequest: CreateIngestionJobRequest = { idempotency_key: idempotencyKey, document_id: payload.document_id,
      document_version_id: version.document_version_id, source_file_uri: version.source_file_uri,
      parser_profile: "controlled_document", ocr_enabled: true, chunking_strategy: "legal_structured",
      embedding_profile: "default", expected_current_ingestion_job_id: payload.expected_current_ingestion_job_id };
    const ingestionContext = await ingestionServiceRequestContext(correlationId);
    const delegation = { delegatedActorSubjectId: authorization.confirmed_subject_id, authorizationToken: authorization.authorization_token };
    let job = await clients.ingestion.createJob(jobRequest, ingestionContext, delegation);
    if (["pending_authorization", "claiming"].includes(job.status)) job = await clients.ingestion.createJob(jobRequest, ingestionContext, delegation);
    if (job.job_id !== ingestionJobIdForIdempotencyKey(idempotencyKey) || job.document_id !== payload.document_id
      || job.document_version_id !== version.document_version_id || ["pending_authorization", "claiming"].includes(job.status)) {
      throw new UploadPreflightError(503, "SOURCE_INTAKE_INGESTION_UNAVAILABLE", "The exact source ingestion attempt was not activated.");
    }
    return NextResponse.json({ document_id: payload.document_id, external_document_id: payload.external_document_id,
      document_version_id: version.document_version_id, ingestion_job_id: job.job_id, ingestion_status: job.status,
      document_version_status: version.status, idempotent_replay: version.idempotent_replay === true,
      canonical_open_url: canonicalDocumentUrl({ documentId: payload.document_id, documentVersionId: version.document_version_id }),
    }, { status: version.idempotent_replay ? 200 : 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return stratosBridgeError(error); }
}
