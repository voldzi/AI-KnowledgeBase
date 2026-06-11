import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContext } from "@/lib/api/server";
import { ApiClientError } from "@/lib/types";
import {
  canonicalDocumentUrl,
  createIngestionRequest,
  getStratosUploadSettings,
  mapIngestionStatus,
  optionalString,
  requiredString,
  sourceLocationForUpload,
  updateExternalDocumentCurrent,
  type StratosUploadConfirmResult
} from "@/lib/stratos/document-ai";
import { assertUploadMatchesIngestionPayload } from "@/lib/upload/preflight";

import { stratosBridgeError } from "../../../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    sessionId: string;
  }>;
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    const { sessionId } = await routeContext.params;
    const body = await request.json() as Record<string, unknown>;
    const context = await getServerRequestContext();
    const clients = getServerApiClients();
    const uploadToken = requiredString(body, "upload_token");
    const documentId = requiredString(body, "document_id");
    const sourceFileUri = requiredString(body, "source_file_uri");
    const fileHash = requiredString(body, "file_hash");
    const fileName = requiredString(body, "file_name");
    const fileType = optionalString(body, "file_type");
    const fileSize = Number(body.file_size);
    const externalDocumentId = requiredString(body, "external_document_id");
    const payload = assertUploadMatchesIngestionPayload(
      uploadToken,
      {
        document_id: documentId,
        upload_session_id: sessionId,
        source_file_uri: sourceFileUri,
        file_hash: fileHash,
        file_name: fileName,
        file_size: Number.isFinite(fileSize) ? fileSize : null,
        file_type: fileType
      },
      getStratosUploadSettings()
    );
    const sourceLocation = sourceLocationForUpload({
      fileName,
      fileType,
      sha256: fileHash,
      sourceFileUri,
      objectKey: payload.object_key
    });
    const versionRequest = {
      version_label: optionalString(body, "version_label") ?? new Date().toISOString().slice(0, 10),
      valid_from: optionalString(body, "valid_from") ?? new Date().toISOString().slice(0, 10),
      valid_to: optionalString(body, "valid_to"),
      source_file_uri: sourceFileUri,
      source_location: sourceLocation,
      file_hash: fileHash,
      change_summary: optionalString(body, "change_summary") ?? "STRATOS document upload.",
      file: {
        filename: fileName,
        mime_type: fileType,
        size_bytes: Number.isFinite(fileSize) ? fileSize : null,
        sha256: fileHash,
        uploaded_by: context.subjectId
      }
    };
    const version = await clients.registry.createDocumentVersion(documentId, versionRequest, context);
    const job = await clients.ingestion.createJob(
      createIngestionRequest({
        documentId,
        versionId: version.document_version_id,
        sourceFileUri,
        body
      }),
      context
    );
    const ingestionStatus = mapIngestionStatus({ version, job });
    const external = await updateExternalDocumentCurrent(
      externalDocumentId,
      {
        current_document_version_id: version.document_version_id,
        current_file_id: version.file_id ?? null,
        current_ingestion_job_id: job.job_id,
        current_ingestion_status: ingestionStatus,
        akb_source_uri: sourceFileUri,
        source_location: sourceLocation
      },
      context
    );
    const fileId = version.file_id ?? external.external_document.current_file_id;
    if (!fileId) {
      throw new ApiClientError(
        "Registry did not return a file id for uploaded document version.",
        502,
        "REGISTRY_FILE_ID_MISSING",
        "web-stratos-bridge"
      );
    }
    const result: StratosUploadConfirmResult = {
      document_id: documentId,
      document_version_id: version.document_version_id,
      external_document_id: external.external_document.external_document_id,
      file_id: fileId,
      ingestion_job_id: job.job_id,
      ingestion_status: ingestionStatus,
      canonical_open_url: canonicalDocumentUrl({
        documentId,
        documentVersionId: version.document_version_id
      })
    };

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return stratosBridgeError(error);
  }
}
