import { NextRequest, NextResponse } from "next/server";

import { getServerApiClients, getServerRequestContextForRequest } from "@/lib/api/server";
import { ApiClientError, type IngestionJob } from "@/lib/types";
import {
  canonicalDocumentUrl,
  createIngestionRequest,
  getExternalDocument,
  getStratosUploadSettings,
  mapIngestionStatus,
  optionalString,
  requiredString,
  sourceLocationForUpload,
  updateExternalDocumentCurrent,
  type StratosUploadConfirmResult
} from "@/lib/stratos/document-ai";
import {
  externalUploadIdentityMismatches,
  latestIngestionJobForVersion,
  resolveUploadVersion
} from "@/lib/stratos/upload-idempotency";
import { assertUploadMatchesIngestionPayload } from "@/lib/upload/preflight";
import { parseInformationPolicy, policyHash } from "@/lib/stratos/information-policy";

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
    const context = await getServerRequestContextForRequest(request);
    const clients = getServerApiClients();
    const uploadToken = requiredString(body, "upload_token");
    const documentId = requiredString(body, "document_id");
    const sourceFileUri = requiredString(body, "source_file_uri");
    const fileHash = requiredString(body, "file_hash");
    const fileName = requiredString(body, "file_name");
    const fileType = optionalString(body, "file_type");
    const fileSize = Number(body.file_size);
    const informationPolicy = parseInformationPolicy(body.information_policy);
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
    if (
      payload.policy_binding_id !== informationPolicy.policyBindingId ||
      payload.policy_version !== informationPolicy.policyVersion ||
      payload.policy_hash !== policyHash(informationPolicy)
    ) {
      throw new ApiClientError(
        "Upload confirmation policy does not match the signed preflight decision.",
        409,
        "UPLOAD_POLICY_BINDING_CONFLICT",
        "web-stratos-bridge"
      );
    }
    const versionLabel = optionalString(body, "version_label") ?? new Date().toISOString().slice(0, 10);
    const versionRequest = {
      version_label: versionLabel,
      valid_from: optionalString(body, "valid_from") ?? new Date().toISOString().slice(0, 10),
      valid_to: optionalString(body, "valid_to"),
      source_file_uri: sourceFileUri,
      source_location: sourceLocation,
      file_hash: fileHash,
      change_summary: optionalString(body, "change_summary") ?? "STRATOS document upload.",
      information_policy: informationPolicy,
      file: {
        filename: fileName,
        mime_type: fileType,
        size_bytes: Number.isFinite(fileSize) ? fileSize : null,
        sha256: fileHash,
        uploaded_by: context.subjectId
      }
    };
    const [externalState, existingVersions] = await Promise.all([
      getExternalDocument(externalDocumentId, context),
      clients.registry.listDocumentVersions(documentId, context)
    ]);
    const identityMismatches = externalUploadIdentityMismatches(
      externalState.external_document,
      {
        documentId,
        tenantId: optionalString(body, "tenant_id"),
        externalSystem: optionalString(body, "external_system"),
        externalRef: optionalString(body, "external_ref")
      }
    );
    if (identityMismatches.length > 0) {
      throw new ApiClientError(
        `Upload confirmation does not match the external document identity: ${identityMismatches.join(", ")}.`,
        409,
        "UPLOAD_EXTERNAL_IDENTITY_CONFLICT",
        "web-stratos-bridge"
      );
    }

    let resolution = resolveUploadVersion(existingVersions, versionLabel, fileHash);
    if (resolution.kind === "conflict") {
      throw uploadVersionConflict(resolution.version.document_version_id);
    }
    let idempotentReplay = resolution.kind === "replay";
    let version = resolution.kind === "replay" ? resolution.version : null;
    if (!version) {
      try {
        version = await clients.registry.createDocumentVersion(documentId, versionRequest, context);
      } catch (error) {
        if (!(error instanceof ApiClientError) || error.status !== 409) throw error;
        const racedVersions = await clients.registry.listDocumentVersions(documentId, context);
        resolution = resolveUploadVersion(racedVersions, versionLabel, fileHash);
        if (resolution.kind === "conflict") {
          throw uploadVersionConflict(resolution.version.document_version_id);
        }
        if (resolution.kind !== "replay") throw error;
        version = resolution.version;
        idempotentReplay = true;
      }
    }

    let job: IngestionJob | null = null;
    if (idempotentReplay) {
      const jobs = await clients.ingestion.listJobs(context);
      job = latestIngestionJobForVersion(jobs, version.document_version_id);
    }
    const reusedJob = Boolean(job);
    if (!job) {
      job = await clients.ingestion.createJob(
        createIngestionRequest({
          documentId,
          versionId: version.document_version_id,
          sourceFileUri: version.source_file_uri,
          body
        }),
        context
      );
    }
    const ingestionStatus = mapIngestionStatus({ version, job });
    const currentMatchesVersion =
      externalState.external_document.current_document_version_id === version.document_version_id;
    const canReconcileCurrent =
      !idempotentReplay ||
      !externalState.external_document.current_document_version_id ||
      currentMatchesVersion;
    const shouldUpdateCurrent = canReconcileCurrent && (!idempotentReplay || !reusedJob || currentMatchesVersion);
    const external = shouldUpdateCurrent
      ? await updateExternalDocumentCurrent(
          externalDocumentId,
          {
            current_document_version_id: version.document_version_id,
            current_file_id:
              version.file_id ??
              (currentMatchesVersion ? externalState.external_document.current_file_id : null),
            current_ingestion_job_id: job.job_id,
            current_ingestion_status: ingestionStatus,
            ...(!idempotentReplay
              ? {
                  akb_source_uri: sourceFileUri,
                  source_location: sourceLocation
                }
              : {})
          },
          context
        )
      : externalState;
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
      idempotent_replay: idempotentReplay,
      canonical_open_url: canonicalDocumentUrl({
        documentId,
        documentVersionId: version.document_version_id
      }),
      policy_binding_id: informationPolicy.policyBindingId,
      policy_version: informationPolicy.policyVersion,
      policy_hash: policyHash(informationPolicy)
    };

    return NextResponse.json(result, { status: idempotentReplay ? 200 : 201 });
  } catch (error) {
    return stratosBridgeError(error);
  }
}

function uploadVersionConflict(existingVersionId: string): ApiClientError {
  return new ApiClientError(
    `Version label already exists with a different file hash (version ${existingVersionId}).`,
    409,
    "UPLOAD_VERSION_HASH_CONFLICT",
    "web-stratos-bridge"
  );
}
