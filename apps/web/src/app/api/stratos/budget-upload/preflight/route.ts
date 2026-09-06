import { createHash } from "node:crypto";
import { canonicalDocumentSnapshot } from "@/lib/documents/document-profile";
import { NextRequest, NextResponse } from "next/server";

import {
  authenticateStratosDocumentServiceJsonRequest,
  requireStratosDocumentSourceAllowed,
  type StratosDocumentServicePrincipal,
} from "@/lib/stratos/document-service-auth";
import {
  getStratosActorRequestContext,
  requireStratosActorSubjectMatch,
} from "@/lib/api/server";
import {
  canonicalDocumentUrl,
  getStratosBudgetUploadSettings,
  parseStratosBudgetPreflightContract,
  STRATOS_BUDGET_UPLOAD_TOKEN_PURPOSE,
  stratosBudgetPreflightWorkflow,
  upsertStratosBudgetExternalDocument,
  type StratosBudgetGovernedDocument,
} from "@/lib/stratos/document-ai";
import { ApiClientError, type ApiRequestContext } from "@/lib/types";
import { createUploadPreflightDecision, validateUploadFileMetadata } from "@/lib/upload/preflight";
import { parseDocumentVersionProfileInput } from "@/lib/documents/document-profile-validation";
import { equalCanonicalJson } from "@/lib/stratos/canonical-json";

import { stratosBridgeError } from "../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { principal: service, body } = await authenticateStratosDocumentServiceJsonRequest(
      request,
      { rateLimitProfile: "stratos-budget-upload" },
    );
    const contract = parseStratosBudgetPreflightContract(body);
    requireStratosDocumentSourceAllowed(service, contract.externalSystem);
    const actorAuthorizationPresent = request.headers.get("X-STRATOS-Actor-Authorization") !== null;
    const workflow = stratosBudgetPreflightWorkflow(contract, actorAuthorizationPresent);
    if (workflow.mode === "interactive") {
      await validateRequiredActor(request, contract.actorSubjectId);
    }

    const uploadSettings = getStratosBudgetUploadSettings();
    const validatedFile = validateUploadFileMetadata(
      {
        file_name: contract.fileName,
        file_size: contract.fileSize,
        file_type: contract.fileType,
        sha256: contract.fileHash,
      },
      uploadSettings,
    );
    const serviceContext = budgetServiceContext(service, contract.integrationEnvelope.correlationId);
    const external = await upsertStratosBudgetExternalDocument({ contract, serviceContext });
    assertRegisteredBudgetDocument(external, contract);
    const document = external.document as StratosBudgetGovernedDocument;
    const versionProfile = parseDocumentVersionProfileInput({
      ...contract.documentVersionProfile,
      expected_root_metadata_revision: document.document_profile?.metadataRevision,
    }, contract.documentProfile);

    const preflight = createUploadPreflightDecision(
      {
        document_id: document.document_id,
        document_profile: versionProfile,
        file_name: validatedFile.file_name,
        file_size: validatedFile.file_size,
        file_type: validatedFile.file_type,
        sha256: validatedFile.sha256,
        policy_binding_id: contract.informationPolicy.policyBindingId,
        policy_version: contract.informationPolicy.policyVersion,
        policy_hash: contract.integrationEnvelope.policyHash,
        external_document_id: external.external_document.external_document_id,
        expected_current_document_version_id:
          external.external_document.current_document_version_id,
        expected_current_ingestion_job_id:
          external.external_document.current_ingestion_job_id,
        governed_document_resource_id: document.governed_resource_id,
        source_governed_resource_id: contract.parentGovernedResourceId,
        source_resource_id: contract.entityId,
        source_version: contract.fileHash,
        governance_scope: {
          type: contract.governanceScope.type,
          id: contract.governanceScope.id,
        },
        governance_actor_subject_id: contract.actorSubjectId,
        governance_registered_by_subject_id: service.subjectId,
        governance_correlation_id: contract.integrationEnvelope.correlationId,
        governance_idempotency_key: contract.integrationEnvelope.idempotencyKey,
        purpose: STRATOS_BUDGET_UPLOAD_TOKEN_PURPOSE,
        workflow_mode: workflow.mode,
        workflow_context: workflow.context,
      },
      uploadSettings,
    );

    return NextResponse.json(
      {
        upload_session_id: preflight.upload_session_id,
        upload_url: preflight.upload_url,
        upload_method: preflight.upload_method,
        source_file_uri: preflight.source_file_uri,
        expires_at: preflight.expires_at,
        required_headers: preflight.required_headers,
        required_authentication: {
          transport: "server_to_server",
          service_bearer: true,
          actor_bearer: workflow.mode === "interactive",
        },
        file: preflight.file,
        document_id: document.document_id,
        document_profile: versionProfile,
        external_document_id: external.external_document.external_document_id,
        external_ref: contract.externalRef,
        policy_binding_id: contract.informationPolicy.policyBindingId,
        policy_version: contract.informationPolicy.policyVersion,
        policy_hash: contract.integrationEnvelope.policyHash,
        canonical_open_url: canonicalDocumentUrl({ documentId: document.document_id }),
      },
      { status: external.created ? 201 : 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return stratosBridgeError(error);
  }
}

async function validateRequiredActor(request: Request, expectedSubjectId: string): Promise<void> {
  const actorContext = await getStratosActorRequestContext(request);
  requireStratosActorSubjectMatch(actorContext, expectedSubjectId);
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

function assertRegisteredBudgetDocument(
  external: Awaited<ReturnType<typeof upsertStratosBudgetExternalDocument>>,
  contract: ReturnType<typeof parseStratosBudgetPreflightContract>,
): void {
  const reference = external.external_document;
  const document = external.document as StratosBudgetGovernedDocument;
  if (
    reference.tenant_id !== contract.tenantId
    || reference.external_system !== contract.externalSystem
    || reference.external_ref !== contract.externalRef
    || reference.entity_type !== contract.entityType
    || reference.entity_id !== contract.entityId
    || reference.document_id !== document.document_id
    || document.policy_binding_id !== contract.informationPolicy.policyBindingId
    || document.policy_version !== contract.informationPolicy.policyVersion
    || document.policy_hash !== contract.integrationEnvelope.policyHash
    || document.governed_parent_resource_id !== contract.parentGovernedResourceId
    || document.governance_scope_type !== contract.governanceScope.type
    || document.governance_scope_id !== contract.governanceScope.id
    || !document.governed_resource_id
    || !document.current_root_metadata_revision
    || !document.current_root_snapshot_hash
    || !document.document_profile?.metadataRevision
    || document.document_profile.metadataRevision !== document.current_root_metadata_revision
    || `sha256:${createHash("sha256").update(canonicalDocumentSnapshot(document.document_profile)).digest("hex")}` !== document.current_root_snapshot_hash
    || document.document_profile.documentId !== document.document_id
    || !equalCanonicalJson(document.document_profile && {
      profile: document.document_profile.profile,
      authorship: document.document_profile.authorship,
      provenance: document.document_profile.provenance,
      accountability: document.document_profile.accountability,
    }, contract.documentProfile)
    || document.governance_registration_status !== "REGISTERED"
  ) {
    throw new ApiClientError(
      "Registry returned a conflicting STRATOS Budget document registration.",
      502,
      "STRATOS_BUDGET_REGISTRATION_CONFLICT",
      contract.integrationEnvelope.correlationId,
    );
  }
}
