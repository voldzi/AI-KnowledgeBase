import { NextRequest, NextResponse } from "next/server";

import { authenticateAiipDocumentServiceJsonRequest } from "@/lib/aiip/application-api";
import { ApiClientError, type ApiRequestContext } from "@/lib/types";
import {
  AIIP_PREFLIGHT_FIELDS,
  assertExactFields,
  canonicalDocumentUrl,
  getStratosUploadSettings,
  requiredString,
  STRATOS_UPLOAD_TOKEN_PURPOSE,
  upsertExternalDocument
} from "@/lib/stratos/document-ai";
import { createUploadPreflightDecision, validateUploadFileMetadata } from "@/lib/upload/preflight";
import { equalCanonicalJson } from "@/lib/stratos/aiip-governance";
import {
  parseInformationPolicy,
  parseIntegrationEnvelope
} from "@/lib/stratos/information-policy";

import { stratosBridgeError } from "../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { principal: service, body } = await authenticateAiipDocumentServiceJsonRequest(request);
    assertExactFields(body, AIIP_PREFLIGHT_FIELDS, "AIIP upload preflight");
    if (typeof body.file_size !== "number" || !Number.isSafeInteger(body.file_size) || body.file_size <= 0) {
      throw new ApiClientError(
        "file_size must be a positive JSON integer.",
        422,
        "AIIP_UPLOAD_SCHEMA_INVALID",
        "web-stratos-bridge",
      );
    }
    const uploadSettings = getStratosUploadSettings();
    const validatedFile = validateUploadFileMetadata(
      {
        file_name: requiredString(body, "file_name"),
        file_size: body.file_size,
        file_type: requiredString(body, "file_type"),
        sha256: requiredString(body, "sha256"),
      },
      uploadSettings,
    );
    const informationPolicy = parseInformationPolicy(body.information_policy);
    const integrationEnvelope = parseIntegrationEnvelope(body.integration_envelope, informationPolicy);
    if (!integrationEnvelope || integrationEnvelope.sourceSystem !== "STRATOS_AIIP") {
      throw new ApiClientError(
        "AIIP upload requires the governed integration envelope.",
        422,
        "AIIP_GOVERNED_SOURCE_REQUIRED",
        "web-stratos-bridge",
      );
    }
    const authoritativePolicyHash = integrationEnvelope.policyHash;
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
    const external = await upsertExternalDocument(body, context, actorAuthorization);
    const confirmation = external.governance_confirmation;
    if (
      !confirmation ||
      confirmation.governed_resource.application !== "AKB" ||
      confirmation.governed_resource.resource_type !== "document" ||
      confirmation.governed_resource.resource_id !== external.document.document_id ||
      confirmation.governed_resource.source_version !== integrationEnvelope.sourceResource.sourceVersion ||
      confirmation.governed_resource.parent_id !== integrationEnvelope.sourceResource.governedResourceId ||
      confirmation.governed_resource.inherited_from_resource_id !== integrationEnvelope.sourceResource.governedResourceId ||
      !equalCanonicalJson(confirmation.governed_resource.scope, integrationEnvelope.sourceResource.scope) ||
      confirmation.governed_resource.policy_assignment !== "INHERITED" ||
      confirmation.governed_resource.explicit_policy_binding_id !== null ||
      confirmation.governed_resource.effective_policy.policy_binding_id !== informationPolicy.policyBindingId ||
      confirmation.governed_resource.effective_policy.policy_version !== informationPolicy.policyVersion ||
      confirmation.governed_resource.effective_policy.policy_hash !== authoritativePolicyHash ||
      confirmation.governed_resource.effective_policy.originator_id !== (informationPolicy.originatorId ?? null) ||
      confirmation.governed_resource.effective_policy.issued_at !== (informationPolicy.issuedAt ?? null) ||
      confirmation.governed_resource.effective_policy.review_at !== (informationPolicy.reviewAt ?? null) ||
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
      confirmation.document_policy_hash !== authoritativePolicyHash
    ) {
      throw new ApiClientError(
        "Registry did not return the exact authoritative AIIP governance confirmation.",
        502,
        "AIIP_GOVERNANCE_CONFIRMATION_INVALID",
        "web-stratos-bridge",
      );
    }
    const preflight = createUploadPreflightDecision(
      {
        document_id: external.document.document_id,
        file_name: validatedFile.file_name,
        file_size: validatedFile.file_size,
        file_type: validatedFile.file_type,
        sha256: validatedFile.sha256,
        policy_binding_id: informationPolicy.policyBindingId,
        policy_version: informationPolicy.policyVersion,
        policy_hash: authoritativePolicyHash,
        external_document_id: external.external_document.external_document_id,
        expected_current_document_version_id:
          external.external_document.current_document_version_id,
        governed_document_resource_id: confirmation.governed_resource.id,
        source_governed_resource_id: integrationEnvelope.sourceResource.governedResourceId,
        source_resource_id: integrationEnvelope.sourceResource.resourceId,
        source_version: integrationEnvelope.sourceResource.sourceVersion,
        governance_scope: integrationEnvelope.sourceResource.scope,
        governance_actor_subject_id: integrationEnvelope.actor.subjectId,
        governance_registered_by_subject_id: confirmation.governed_resource.registered_by_subject_id,
        governance_correlation_id: integrationEnvelope.correlationId,
        governance_idempotency_key: integrationEnvelope.idempotencyKey,
        purpose: STRATOS_UPLOAD_TOKEN_PURPOSE,
      },
      uploadSettings
    );

    return NextResponse.json(
      {
        ...preflight,
        document_id: external.document.document_id,
        external_document_id: external.external_document.external_document_id,
        external_ref: external.external_document.external_ref,
        policy_binding_id: informationPolicy.policyBindingId,
        policy_version: informationPolicy.policyVersion,
        policy_hash: authoritativePolicyHash,
        governance_confirmation: confirmation,
        canonical_open_url: canonicalDocumentUrl({ documentId: external.document.document_id })
      },
      { status: 201 }
    );
  } catch (error) {
    return stratosBridgeError(error);
  }
}
