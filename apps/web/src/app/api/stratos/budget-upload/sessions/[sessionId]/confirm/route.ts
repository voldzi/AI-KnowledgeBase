import { NextRequest, NextResponse } from "next/server";

import {
  authenticateStratosDocumentServiceJsonRequest,
  requireStratosDocumentSourceAllowed,
  type StratosDocumentServicePrincipal,
} from "@/lib/aiip/application-api";
import {
  getServerApiClients,
  getStratosActorRequestContext,
  requireStratosActorSubjectMatch,
} from "@/lib/api/server";
import {
  ingestionJobIdForIdempotencyKey,
  ingestionServiceRequestContext,
} from "@/lib/ingestion/service-identity";
import {
  canonicalDocumentUrl,
  canonicalStratosBudgetUploadContract,
  createIngestionRequest,
  getStratosBudgetDocumentStatus,
  getStratosBudgetUploadSettings,
  mapIngestionStatus,
  parseStratosBudgetConfirmContract,
  requiredString,
  STRATOS_BUDGET_UPLOAD_TOKEN_PURPOSE,
  stratosBudgetVersionLineageFromUploadToken,
  stratosBudgetVersionSourceLocation,
  updateStratosBudgetExternalDocumentCurrent,
  upsertStratosBudgetDocumentVersion,
  type StratosBudgetStoredLineage,
  type StratosBudgetUploadConfirmResult,
} from "@/lib/stratos/document-ai";
import { ApiClientError, type ApiRequestContext, type IngestionJob } from "@/lib/types";
import {
  assertUploadMatchesIngestionPayload,
  assertUploadTokenPurpose,
  verifyPersistedUploadedObject,
} from "@/lib/upload/preflight";

import { stratosBridgeError } from "../../../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    const { sessionId } = await routeContext.params;
    const { principal: service, body } = await authenticateStratosDocumentServiceJsonRequest(
      request,
      { rateLimitProfile: "stratos-budget-upload" },
    );
    const contract = parseStratosBudgetConfirmContract(body);
    requireStratosDocumentSourceAllowed(service, contract.externalSystem);
    assertOptionalTextFields(body, ["valid_from", "valid_to", "change_summary"]);

    if (requiredString(body, "upload_session_id") !== sessionId) {
      throw new ApiClientError(
        "Upload session id does not match the confirmation route.",
        409,
        "STRATOS_BUDGET_UPLOAD_SESSION_CONFLICT",
        contract.integrationEnvelope.correlationId,
      );
    }
    const serviceContext = budgetServiceContext(service, contract.integrationEnvelope.correlationId);
    const documentId = requiredString(body, "document_id");
    const externalDocumentId = requiredString(body, "external_document_id");
    const uploadToken = requiredString(body, "upload_token");
    const uploadSettings = getStratosBudgetUploadSettings();
    const payload = assertUploadMatchesIngestionPayload(
      uploadToken,
      {
        document_id: documentId,
        upload_session_id: sessionId,
        source_file_uri: requiredString(body, "source_file_uri"),
        file_hash: contract.fileHash,
        file_name: contract.fileName,
        file_size: contract.fileSize,
        file_type: contract.fileType,
      },
      uploadSettings,
    );
    assertUploadTokenPurpose(payload, STRATOS_BUDGET_UPLOAD_TOKEN_PURPOSE);
    const versionLineage = stratosBudgetVersionLineageFromUploadToken(payload);
    const actorContext = await actorContextForMode(
      request,
      contract.ownerSubjectId,
      versionLineage.upload_mode,
      contract.integrationEnvelope.correlationId,
    );
    await verifyPersistedUploadedObject(payload, uploadSettings);
    assertSignedBudgetContext(payload, {
      contract,
      documentId,
      externalDocumentId,
      serviceSubjectId: service.subjectId,
    });

    const normalizedBody = {
      ...body,
      source_file_uri: payload.source_file_uri,
      file_hash: payload.sha256,
      file_name: payload.file_name,
      file_type: payload.file_type,
      file_size: payload.file_size,
    };
    const canonicalContract = canonicalStratosBudgetUploadContract(contract, payload);
    const sourceLocation = stratosBudgetVersionSourceLocation({
      contract: canonicalContract,
      sourceFileUri: payload.source_file_uri,
      objectKey: payload.object_key,
    });
    const versionUpsert = await upsertStratosBudgetDocumentVersion({
      documentId,
      contract: canonicalContract,
      body: normalizedBody,
      sourceLocation,
      versionLineage,
      serviceContext,
    });
    const version = versionUpsert.version;
    const fileId = version.file_id;
    if (
      version.document_id !== documentId
      || version.source_file_uri !== payload.source_file_uri
      || version.file_hash !== contract.fileHash
      || version.policy_binding_id !== contract.informationPolicy.policyBindingId
      || version.policy_version !== contract.informationPolicy.policyVersion
      || version.policy_hash !== contract.integrationEnvelope.policyHash
      || version.status !== "valid"
      || !fileId
      || versionUpsert.external_document.external_document.external_document_id !== externalDocumentId
      || versionUpsert.external_document.external_document.external_ref !== contract.externalRef
    ) {
      throw new ApiClientError(
        "Registry returned a conflicting immutable Budget document version.",
        502,
        "STRATOS_BUDGET_VERSION_CONFLICT",
        contract.integrationEnvelope.correlationId,
      );
    }

    const lineage: StratosBudgetStoredLineage = {
      informationPolicy: contract.informationPolicy,
      integrationEnvelope: contract.integrationEnvelope,
      governanceScope: contract.governanceScope,
      parentGovernedResourceId: contract.parentGovernedResourceId,
      uploadMode: versionLineage.upload_mode,
    };
    const idempotencyKey = `confirm:${externalDocumentId}:${version.document_version_id}`;
    const authorizationContext = actorContext
      ? {
          ...actorContext,
          requestId: contract.integrationEnvelope.correlationId,
          correlationId: contract.integrationEnvelope.correlationId,
        }
      : serviceContext;
    const clients = getServerApiClients();
    const authorizationRequest = {
      action: "document.ingest" as const,
      correlation_id: contract.integrationEnvelope.correlationId,
      idempotency_key: idempotencyKey,
    };
    const authorization = actorContext
      ? await clients.registry.createIngestionAuthorization(
          documentId,
          version.document_version_id,
          authorizationRequest,
          authorizationContext,
        )
      : await clients.registry.createStratosBudgetHistoricalIngestionAuthorization(
          documentId,
          version.document_version_id,
          authorizationRequest,
          authorizationContext,
        );
    if (
      authorization.confirmed_subject_id !== contract.ownerSubjectId
      || authorization.document_id !== documentId
      || authorization.document_version_id !== version.document_version_id
      || authorization.correlation_id !== contract.integrationEnvelope.correlationId
      || authorization.idempotency_key !== idempotencyKey
    ) {
      throw new ApiClientError(
        "Registry returned a conflicting Budget ingestion authorization.",
        502,
        "INGESTION_AUTHORIZATION_CONFLICT",
        contract.integrationEnvelope.correlationId,
      );
    }
    const ingestionJobId = ingestionJobIdForIdempotencyKey(idempotencyKey);
    const priorStatus = await getStratosBudgetDocumentStatus(documentId, serviceContext);
    const attachStatus = authoritativeStatusForJob(priorStatus.ingestion_attempt, ingestionJobId);
    const current = await updateStratosBudgetExternalDocumentCurrent({
      externalDocumentId,
      documentId,
      expectedCurrentDocumentVersionId: payload.expected_current_document_version_id,
      expectedCurrentIngestionJobId: payload.expected_current_ingestion_job_id ?? null,
      documentVersionId: version.document_version_id,
      fileId,
      ingestionJobId,
      ingestionStatus: attachStatus,
      lineage,
      externalRef: contract.externalRef,
      serviceContext,
    });
    assertCurrentSelection(current, version.document_version_id, fileId, ingestionJobId);

    const ingestionContext = await ingestionServiceRequestContext(contract.integrationEnvelope.correlationId);
    const ingestionRequest = createIngestionRequest({
      idempotencyKey,
      documentId,
      versionId: version.document_version_id,
      sourceFileUri: version.source_file_uri,
      body: normalizedBody,
      expectedCurrentIngestionJobId: payload.expected_current_ingestion_job_id ?? null,
    });
    let ingestionJob: IngestionJob = await clients.ingestion.createJob(
      ingestionRequest,
      ingestionContext,
      {
        delegatedActorSubjectId: authorization.confirmed_subject_id,
        authorizationToken: authorization.authorization_token,
      },
    );
    if (["pending_authorization", "claiming"].includes(ingestionJob.status)) {
      ingestionJob = await clients.ingestion.createJob(
        ingestionRequest,
        ingestionContext,
        {
          delegatedActorSubjectId: authorization.confirmed_subject_id,
          authorizationToken: authorization.authorization_token,
        },
      );
    }
    if (
      ingestionJob.job_id !== ingestionJobId
      || ingestionJob.document_id !== documentId
      || ingestionJob.document_version_id !== version.document_version_id
      || ["pending_authorization", "claiming"].includes(ingestionJob.status)
    ) {
      throw new ApiClientError(
        "The Budget ingestion attempt was not activated for the exact immutable version.",
        503,
        "STRATOS_BUDGET_INGESTION_ACTIVATION_FAILED",
        contract.integrationEnvelope.correlationId,
      );
    }

    const currentReference = current.external_document.external_document;
    const result: StratosBudgetUploadConfirmResult = {
      document_id: documentId,
      document_version_id: version.document_version_id,
      external_document_id: externalDocumentId,
      file_id: fileId,
      ingestion_job_id: ingestionJob?.job_id ?? currentReference.current_ingestion_job_id,
      ingestion_status: mapIngestionStatus({
        version,
        job: ingestionJob,
        externalStatus: currentReference.current_ingestion_status,
      }),
      idempotent_replay: !versionUpsert.created,
      canonical_open_url: canonicalDocumentUrl({
        documentId,
        documentVersionId: version.document_version_id,
      }),
      policy_binding_id: contract.informationPolicy.policyBindingId,
      policy_version: contract.informationPolicy.policyVersion,
      policy_hash: contract.integrationEnvelope.policyHash,
      file_name: payload.file_name,
      file_type: payload.file_type,
      file_size: payload.file_size,
      document_version_status: "valid",
      governance_confirmation: versionUpsert.governance_confirmation,
    };
    return NextResponse.json(result, { status: versionUpsert.created ? 201 : 200 });
  } catch (error) {
    return stratosBridgeError(error);
  }
}

async function actorContextForMode(
  request: Request,
  expectedSubjectId: string,
  mode: "interactive" | "historical_batch",
  correlationId: string,
): Promise<ApiRequestContext | null> {
  const actorHeaderPresent = request.headers.get("X-STRATOS-Actor-Authorization") !== null;
  if (mode === "historical_batch") {
    if (actorHeaderPresent) {
      throw new ApiClientError(
        "Historical batch confirmation must remain service-only.",
        409,
        "STRATOS_BUDGET_UPLOAD_MODE_CONFLICT",
        correlationId,
      );
    }
    return null;
  }
  if (!actorHeaderPresent) {
    throw new ApiClientError(
      "A fresh STRATOS actor bearer is required for interactive confirmation.",
      401,
      "STRATOS_BUDGET_ACTOR_AUTH_REQUIRED",
      correlationId,
    );
  }
  const actorContext = await getStratosActorRequestContext(request);
  requireStratosActorSubjectMatch(actorContext, expectedSubjectId);
  return actorContext;
}

function budgetServiceContext(
  service: StratosDocumentServicePrincipal,
  correlationId: string,
): ApiRequestContext {
  return {
    subjectId: service.subjectId,
    roles: service.roles,
    organizationId: "org_stratos",
    identityActive: true,
    membershipActive: false,
    applicationAccessActive: false,
    authorizationSource: "stratos_projection",
    serviceClientId: service.clientId,
    accessToken: service.accessToken,
    requestId: correlationId,
    correlationId,
  };
}

function assertSignedBudgetContext(
  payload: ReturnType<typeof assertUploadMatchesIngestionPayload>,
  input: {
    contract: ReturnType<typeof parseStratosBudgetConfirmContract>;
    documentId: string;
    externalDocumentId: string;
    serviceSubjectId: string;
  },
): void {
  const contract = input.contract;
  if (
    payload.document_id !== input.documentId
    || payload.external_document_id !== input.externalDocumentId
    || payload.policy_binding_id !== contract.informationPolicy.policyBindingId
    || payload.policy_version !== contract.informationPolicy.policyVersion
    || payload.policy_hash !== contract.integrationEnvelope.policyHash
    || payload.source_governed_resource_id !== contract.parentGovernedResourceId
    || payload.source_resource_id !== contract.entityId
    || payload.source_version !== contract.fileHash
    || payload.governance_scope?.type !== contract.governanceScope.type
    || payload.governance_scope?.id !== contract.governanceScope.id
    || payload.governance_actor_subject_id !== contract.ownerSubjectId
    || payload.governance_registered_by_subject_id !== input.serviceSubjectId
    || payload.governance_correlation_id !== contract.integrationEnvelope.correlationId
    || payload.governance_idempotency_key !== contract.integrationEnvelope.idempotencyKey
    || !payload.governed_document_resource_id
  ) {
    throw new ApiClientError(
      "Upload confirmation does not match the signed Budget governance context.",
      409,
      "STRATOS_BUDGET_UPLOAD_CONTEXT_CONFLICT",
      contract.integrationEnvelope.correlationId,
    );
  }
}

function authoritativeStatusForJob(
  attempt: { ingestion_job_id: string; ingestion_status: string } | null,
  jobId: string,
): "INGESTING" | "INDEXED" | "FAILED" {
  if (attempt?.ingestion_job_id !== jobId) return "INGESTING";
  if (attempt.ingestion_status === "INDEXED") return "INDEXED";
  if (attempt.ingestion_status === "FAILED") return "FAILED";
  return "INGESTING";
}

function assertCurrentSelection(
  current: Awaited<ReturnType<typeof updateStratosBudgetExternalDocumentCurrent>>,
  versionId: string,
  fileId: string,
  jobId: string | null,
): void {
  const reference = current.external_document.external_document;
  if (
    reference.current_document_version_id !== versionId
    || reference.current_file_id !== fileId
    || reference.current_ingestion_job_id !== jobId
  ) {
    throw new ApiClientError(
      "Registry did not select the exact Budget version, file and ingestion attempt.",
      409,
      "STRATOS_BUDGET_CURRENT_CONFLICT",
      "web-stratos-budget-bridge",
    );
  }
}

function assertOptionalTextFields(body: Record<string, unknown>, fields: readonly string[]): void {
  for (const field of fields) {
    if (
      field in body
      && body[field] !== null
      && (typeof body[field] !== "string" || !(body[field] as string).trim())
    ) {
      throw new ApiClientError(
        `${field} must be a non-empty string or null.`,
        422,
        "STRATOS_BUDGET_UPLOAD_SCHEMA_INVALID",
        "web-stratos-budget-bridge",
      );
    }
  }
}
