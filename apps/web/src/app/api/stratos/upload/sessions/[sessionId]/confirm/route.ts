import { NextRequest, NextResponse } from "next/server";

import { authenticateAiipServiceJsonRequest } from "@/lib/aiip/application-api";
import { getAiipActorRequestContext, getServerApiClients } from "@/lib/api/server";
import { ApiClientError, type ApiRequestContext, type IngestionJob } from "@/lib/types";
import { ingestionServiceRequestContext } from "@/lib/ingestion/service-identity";
import {
  assertExactFields,
  assertRequiredStringFields,
  canonicalDocumentUrl,
  createIngestionRequest,
  getStratosUploadSettings,
  mapIngestionStatus,
  optionalString,
  requiredString,
  sourceLocationForUpload,
  updateAiipExternalDocumentCurrent,
  upsertAiipDocumentVersion,
  type StratosUploadConfirmResult
} from "@/lib/stratos/document-ai";
import { equalAiipGovernanceConfirmation, equalCanonicalJson } from "@/lib/stratos/aiip-governance";
import {
  assertUploadMatchesIngestionPayload,
  verifyPersistedUploadedObject,
  verifyUploadReceipt,
} from "@/lib/upload/preflight";
import { parseInformationPolicy, parseIntegrationEnvelope, policyHash } from "@/lib/stratos/information-policy";

import { stratosBridgeError } from "../../../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{
    sessionId: string;
  }>;
}

const AIIP_CONFIRM_FIELDS = [
  "upload_receipt",
  "upload_token",
  "document_id",
  "source_file_uri",
  "file_hash",
  "file_name",
  "file_type",
  "file_size",
  "external_document_id",
  "tenant_id",
  "external_system",
  "external_ref",
  "information_policy",
  "governance_scope",
  "integration_envelope",
  "version_label",
  "valid_from",
  "valid_to",
  "change_summary",
  "parser_profile",
  "ocr_enabled",
  "chunking_strategy",
  "embedding_profile",
] as const;

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    const { sessionId } = await routeContext.params;
    const { principal: service, body } = await authenticateAiipServiceJsonRequest(request);
    assertExactFields(body, AIIP_CONFIRM_FIELDS, "AIIP upload confirmation");
    assertRequiredStringFields(
      body,
      [
        "upload_receipt", "upload_token", "document_id", "source_file_uri", "file_hash",
        "file_name", "file_type", "external_document_id", "tenant_id", "external_system",
        "external_ref",
      ],
      "AIIP upload confirmation",
    );
    for (const field of [
      "version_label",
      "valid_from",
      "valid_to",
      "change_summary",
      "parser_profile",
      "chunking_strategy",
      "embedding_profile",
    ]) {
      if (
        field in body &&
        body[field] !== null &&
        (typeof body[field] !== "string" || !(body[field] as string).trim())
      ) {
        throw new ApiClientError(
          `${field} must be a non-empty string or null.`,
          422,
          "AIIP_UPLOAD_SCHEMA_INVALID",
          "web-stratos-bridge",
        );
      }
    }
    if ("ocr_enabled" in body && typeof body.ocr_enabled !== "boolean") {
      throw new ApiClientError(
        "ocr_enabled must be a boolean when provided.",
        422,
        "AIIP_UPLOAD_SCHEMA_INVALID",
        "web-stratos-bridge",
      );
    }
    const clients = getServerApiClients();
    const uploadReceipt = requiredString(body, "upload_receipt");
    const uploadToken = requiredString(body, "upload_token");
    const documentId = requiredString(body, "document_id");
    const sourceFileUri = requiredString(body, "source_file_uri");
    const fileHash = requiredString(body, "file_hash");
    const fileName = requiredString(body, "file_name");
    const fileType = requiredString(body, "file_type");
    if (typeof body.file_size !== "number" || !Number.isSafeInteger(body.file_size) || body.file_size <= 0) {
      throw new ApiClientError(
        "file_size must be a positive JSON integer.",
        422,
        "AIIP_UPLOAD_SCHEMA_INVALID",
        "web-stratos-bridge",
      );
    }
    const fileSize = body.file_size;
    const informationPolicy = parseInformationPolicy(body.information_policy);
    const integrationEnvelope = parseIntegrationEnvelope(body.integration_envelope, informationPolicy);
    if (!integrationEnvelope || integrationEnvelope.sourceSystem !== "STRATOS_AIIP") {
      throw new ApiClientError(
        "AIIP upload confirmation requires the governed integration envelope.",
        422,
        "AIIP_GOVERNED_SOURCE_REQUIRED",
        "web-stratos-bridge",
      );
    }
    if (
      requiredString(body, "tenant_id") !== "org_stratos" ||
      requiredString(body, "external_system") !== "STRATOS_AIIP" ||
      requiredString(body, "external_ref") !== integrationEnvelope.externalRef ||
      !equalCanonicalJson(body.governance_scope, integrationEnvelope.sourceResource.scope)
    ) {
      throw new ApiClientError(
        "AIIP upload confirmation identity and governance scope must match the immutable envelope.",
        422,
        "AIIP_UPLOAD_LINEAGE_INVALID",
        "web-stratos-bridge",
      );
    }
    const actorAuthorization = request.headers.get("X-AIIP-Actor-Authorization")?.trim() ?? "";
    if (!/^Bearer\s+\S+$/i.test(actorAuthorization)) {
      throw new ApiClientError(
        "A fresh AIIP actor bearer is required.",
        401,
        "AIIP_ACTOR_AUTH_REQUIRED",
        "web-stratos-bridge",
      );
    }
    const context: ApiRequestContext = {
      subjectId: service.subjectId,
      roles: service.roles,
      organizationId: "org_stratos",
      identityActive: true,
      membershipActive: true,
      applicationAccessActive: false,
      authorizationSource: "stratos_projection",
      accessToken: service.accessToken,
      requestId: integrationEnvelope.correlationId,
      correlationId: integrationEnvelope.correlationId,
    };
    const externalDocumentId = requiredString(body, "external_document_id");
    const uploadSettings = getStratosUploadSettings();
    const payload = assertUploadMatchesIngestionPayload(
      uploadToken,
      {
        document_id: documentId,
        upload_session_id: sessionId,
        source_file_uri: sourceFileUri,
        file_hash: fileHash,
        file_name: fileName,
        file_size: fileSize,
        file_type: fileType
      },
      uploadSettings
    );
    verifyUploadReceipt(uploadReceipt, uploadToken, payload, uploadSettings);
    await verifyPersistedUploadedObject(payload, uploadSettings);
    const normalizedBody: Record<string, unknown> = {
      ...body,
      source_file_uri: payload.source_file_uri,
      file_hash: payload.sha256,
      file_name: payload.file_name,
      file_type: payload.file_type,
      file_size: payload.file_size,
    };
    const sourceLocation = sourceLocationForUpload({
      fileName: payload.file_name,
      fileType: payload.file_type,
      sha256: payload.sha256,
      sourceFileUri: payload.source_file_uri,
      objectKey: payload.object_key,
      repository: "AIIP",
      path: integrationEnvelope.payload.sourceDocumentId,
      version: integrationEnvelope.sourceResource.sourceVersion,
    });
    if (
      payload.policy_binding_id !== informationPolicy.policyBindingId ||
      payload.policy_version !== informationPolicy.policyVersion ||
      payload.policy_hash !== policyHash(informationPolicy) ||
      payload.external_document_id !== externalDocumentId ||
      payload.source_governed_resource_id !== integrationEnvelope.sourceResource.governedResourceId ||
      payload.source_resource_id !== integrationEnvelope.sourceResource.resourceId ||
      payload.source_version !== integrationEnvelope.sourceResource.sourceVersion ||
      payload.sha256 !== integrationEnvelope.payload.sha256 ||
      !equalCanonicalJson(payload.governance_scope, integrationEnvelope.sourceResource.scope) ||
      payload.governance_actor_subject_id !== integrationEnvelope.actor.subjectId ||
      payload.governance_correlation_id !== integrationEnvelope.correlationId ||
      payload.governance_idempotency_key !== integrationEnvelope.idempotencyKey ||
      !payload.governed_document_resource_id ||
      !payload.governance_registered_by_subject_id
    ) {
      throw new ApiClientError(
        "Upload confirmation governance context does not match the signed preflight decision.",
        409,
        "UPLOAD_GOVERNANCE_CONTEXT_CONFLICT",
        "web-stratos-bridge"
      );
    }
    const versionLabel = optionalString(body, "version_label") ?? new Date().toISOString().slice(0, 10);
    const versionUpsert = await upsertAiipDocumentVersion({
      documentId,
      body: normalizedBody,
      versionLabel,
      sourceLocation,
      serviceContext: context,
      actorAuthorization,
    });
    const version = versionUpsert.version;
    const confirmation = versionUpsert.governance_confirmation;
    if (
      confirmation.governed_resource.resource_type !== "document-version" ||
      confirmation.governed_resource.application !== "AKB" ||
      confirmation.governed_resource.resource_id !== version.document_version_id ||
      confirmation.governed_resource.source_version !== payload.sha256 ||
      confirmation.governed_resource.parent_id !== payload.governed_document_resource_id ||
      confirmation.governed_resource.inherited_from_resource_id !== payload.source_governed_resource_id ||
      !equalCanonicalJson(confirmation.governed_resource.scope, integrationEnvelope.sourceResource.scope) ||
      confirmation.governed_resource.policy_assignment !== "INHERITED" ||
      confirmation.governed_resource.explicit_policy_binding_id !== null ||
      confirmation.governed_resource.effective_policy.policy_binding_id !== informationPolicy.policyBindingId ||
      confirmation.governed_resource.effective_policy.policy_version !== informationPolicy.policyVersion ||
      confirmation.governed_resource.effective_policy.policy_hash !== policyHash(informationPolicy) ||
      confirmation.governed_resource.effective_policy.originator_id !== (informationPolicy.originatorId ?? null) ||
      confirmation.governed_resource.effective_policy.issued_at !== (informationPolicy.issuedAt ?? null) ||
      confirmation.governed_resource.effective_policy.review_at !== (informationPolicy.reviewAt ?? null) ||
      !confirmation.governed_resource.registered_by_subject_id ||
      confirmation.governed_resource.confirmed_by_subject_id !== integrationEnvelope.actor.subjectId ||
      confirmation.parent_source_resource.governed_resource_id !== integrationEnvelope.sourceResource.governedResourceId ||
      confirmation.parent_source_resource.application !== "AIIP" ||
      confirmation.parent_source_resource.resource_type !== "idea" ||
      confirmation.parent_source_resource.resource_id !== integrationEnvelope.sourceResource.resourceId ||
      confirmation.parent_source_resource.source_version !== integrationEnvelope.sourceResource.sourceVersion ||
      !equalCanonicalJson(confirmation.parent_source_resource.scope, integrationEnvelope.sourceResource.scope) ||
      confirmation.actor_subject_id !== integrationEnvelope.actor.subjectId ||
      confirmation.correlation_id !== integrationEnvelope.correlationId ||
      confirmation.idempotency_key !== integrationEnvelope.idempotencyKey ||
      confirmation.document_policy_binding_id !== informationPolicy.policyBindingId ||
      confirmation.document_policy_version !== informationPolicy.policyVersion ||
      confirmation.document_policy_hash !== policyHash(informationPolicy)
    ) {
      throw new ApiClientError(
        "Registry returned a conflicting authoritative document-version lineage.",
        502,
        "AIIP_VERSION_GOVERNANCE_CONFLICT",
        "web-stratos-bridge",
      );
    }
    const idempotentReplay = !versionUpsert.created;
    const actorContext = await getAiipActorRequestContext(request);
    if (actorContext.subjectId !== confirmation.actor_subject_id) {
      throw new ApiClientError(
        "Registry confirmation and the current AIIP actor identity differ.",
        403,
        "AIIP_ACTOR_CONFIRMATION_CONFLICT",
        integrationEnvelope.correlationId,
      );
    }
    const idempotencyKey = `confirm:${externalDocumentId}:${version.document_version_id}`;
    const ingestionAuthorization = await clients.registry.createIngestionAuthorization(
      documentId,
      version.document_version_id,
      {
        action: "document.ingest",
        correlation_id: integrationEnvelope.correlationId,
        idempotency_key: idempotencyKey,
      },
      {
        ...actorContext,
        requestId: integrationEnvelope.correlationId,
        correlationId: integrationEnvelope.correlationId,
      },
    );
    if (
      ingestionAuthorization.confirmed_subject_id !== confirmation.actor_subject_id ||
      ingestionAuthorization.document_id !== documentId ||
      ingestionAuthorization.document_version_id !== version.document_version_id ||
      ingestionAuthorization.correlation_id !== integrationEnvelope.correlationId ||
      ingestionAuthorization.idempotency_key !== idempotencyKey
    ) {
      throw new ApiClientError(
        "Registry returned a conflicting ingestion authorization.",
        502,
        "INGESTION_AUTHORIZATION_CONFLICT",
        integrationEnvelope.correlationId,
      );
    }
    const ingestionContext = await ingestionServiceRequestContext(integrationEnvelope.correlationId);
    const ingestionRequest = createIngestionRequest({
        idempotencyKey,
        documentId,
        versionId: version.document_version_id,
        sourceFileUri: version.source_file_uri,
        body: normalizedBody,
      });
    let job: IngestionJob = await clients.ingestion.createJob(
      ingestionRequest,
      ingestionContext,
      {
        delegatedActorSubjectId: ingestionAuthorization.confirmed_subject_id,
        authorizationToken: ingestionAuthorization.authorization_token,
      },
    );
    const ingestionStatus = mapIngestionStatus({ version, job });
    const fileId = version.file_id;
    if (!fileId) {
      throw new ApiClientError(
        "Registry did not return a file id for uploaded document version.",
        502,
        "REGISTRY_FILE_ID_MISSING",
        "web-stratos-bridge"
      );
    }
    const current = await updateAiipExternalDocumentCurrent({
      externalDocumentId,
      documentId,
      expectedCurrentDocumentVersionId: payload.expected_current_document_version_id,
      version,
      fileId,
      ingestionJobId: job.job_id,
      ingestionStatus,
      body: normalizedBody,
      serviceContext: context,
      actorAuthorization,
    });
    const currentRef = current.external_document.external_document;
    if (
      currentRef.current_document_version_id !== version.document_version_id ||
      currentRef.current_file_id !== fileId ||
      currentRef.current_ingestion_job_id !== job.job_id
    ) {
      throw new ApiClientError(
        "Registry did not select the exact immutable document version and ingestion job as current.",
        409,
        "AIIP_CURRENT_VERSION_CONFLICT",
        "web-stratos-bridge",
      );
    }
    if (!equalAiipGovernanceConfirmation(current.governance_confirmation, confirmation)) {
      throw new ApiClientError(
        "Registry current-state reconciliation returned a conflicting governance confirmation.",
        502,
        "AIIP_CURRENT_GOVERNANCE_CONFLICT",
        "web-stratos-bridge",
      );
    }
    if (["pending_authorization", "claiming"].includes(job.status)) {
      job = await clients.ingestion.createJob(
        ingestionRequest,
        ingestionContext,
        {
          delegatedActorSubjectId: ingestionAuthorization.confirmed_subject_id,
          authorizationToken: ingestionAuthorization.authorization_token,
        },
      );
      if (["pending_authorization", "claiming"].includes(job.status)) {
        throw new ApiClientError(
          "The authoritative ingestion attempt was selected but did not activate.",
          503,
          "INGESTION_ACTIVATION_PENDING",
          integrationEnvelope.correlationId,
        );
      }
    }
    const reconciledIngestionStatus = mapIngestionStatus({ version, job });
    const result: StratosUploadConfirmResult = {
      document_id: documentId,
      document_version_id: version.document_version_id,
      external_document_id: current.external_document.external_document.external_document_id,
      file_id: fileId,
      ingestion_job_id: job.job_id,
      ingestion_status: reconciledIngestionStatus,
      idempotent_replay: idempotentReplay,
      canonical_open_url: canonicalDocumentUrl({
        documentId,
        documentVersionId: version.document_version_id
      }),
      policy_binding_id: informationPolicy.policyBindingId,
      policy_version: informationPolicy.policyVersion,
      policy_hash: policyHash(informationPolicy),
      governance_confirmation: confirmation,
    };

    return NextResponse.json(result, { status: idempotentReplay ? 200 : 201 });
  } catch (error) {
    return stratosBridgeError(error);
  }
}
