import "server-only";
import { authorizeSourceUpload } from "@/lib/stratos/source-intake";
import { createHash } from "node:crypto";
import { parseDocumentVersionProfileInput } from "@/lib/documents/document-profile-validation";
import { canonicalDocumentSnapshot } from "@/lib/documents/document-profile";

import {
  budgetActorContextForMode,
  budgetServiceContext,
} from "@/lib/stratos/budget-upload-authorization";
import { stratosBudgetVersionLineageFromUploadToken } from "@/lib/stratos/document-ai";
import type { StratosDocumentServicePrincipal } from "@/lib/stratos/document-service-auth";
import { parseDocumentInformationPolicy, policyHash } from "@/lib/stratos/information-policy";
import { OFFICIAL_SOURCE_SERVICE_CLIENT_ID } from "@/lib/public-sources/automation-service-identity";
import type {
  ApiRequestContext,
  BudgetIntakeAuthorizationRequest,
  RegistryApiClient,
} from "@/lib/types";
import {
  acceptDocumentIntakeContent,
  type DocumentIntakeAcceptedUpload,
} from "./document-intake";
import {
  CONTROLLED_DOCUMENT_UPLOAD_TOKEN_PURPOSE,
  UploadPreflightError,
  type UploadTokenPayload,
} from "./preflight";

type IntakeRegistry = Pick<RegistryApiClient,
  "getDocument" | "authorizeDocument" | "authorizeBudgetDocumentIntake"
>;

export async function authorizeControlledDocumentUpload(input: {
  registry: Pick<IntakeRegistry, "getDocument" | "authorizeDocument">;
  context: ApiRequestContext;
  documentId: string;
  payload?: UploadTokenPayload;
}) {
  const { registry, context, documentId, payload } = input;
  const officialSourceService = context.serviceClientId === OFFICIAL_SOURCE_SERVICE_CLIENT_ID;
  if (!context.subjectId || (context.serviceClientId && !officialSourceService)) {
    deny("UPLOAD_ACTOR_REQUIRED", "An interactive document actor is required.");
  }
  if (payload && payload.governance_actor_subject_id !== context.subjectId) {
    deny("UPLOAD_ACTOR_MISMATCH", "The current actor does not match the signed upload decision.");
  }
  // The workspace visibility and document.read decision do not grant uploads.
  const decision = await registry.authorizeDocument(documentId, "document.version.create", context);
  if (decision.allowed !== true) {
    deny("UPLOAD_NOT_AUTHORIZED", "The current document authorization does not allow an upload.");
  }
  const document = await registry.getDocument(documentId, context);
  if (officialSourceService && (
    document.classification !== "public"
    || !document.tags.includes("official-public-reference")
    || document.metadata?.source_model !== "official-public-reference-v1"
    || document.metadata?.collection_id !== "czech-law"
    || document.metadata?.audience !== "organization"
    || document.metadata?.anonymous_publication !== false
    || document.policy_summary?.tlp !== "TLP:CLEAR"
    || document.policy_summary?.audience?.organizationId !== "org_stratos"
    || document.policy_summary?.audience?.scopeType !== "organization"
  )) {
    deny("OFFICIAL_SOURCE_SERVICE_SCOPE_FORBIDDEN", "The official-source service may upload only governed Czech-law documents.");
  }
  if (["STRATOS_BUDGET", "STRATOS_PROJECTFLOW", "STRATOS_ARCHFLOW"].includes(document.document_profile?.provenance.sourceSystem ?? "")) {
    deny("SOURCE_INTAKE_REQUIRED", "Documents from this source require their authenticated source intake.");
  }
  const informationPolicy = parseDocumentInformationPolicy(document.policy_summary);
  const currentHash = policyHash(informationPolicy);
  if (
    document.document_id !== documentId
    || document.policy_binding_id !== informationPolicy.policyBindingId
    || document.policy_version !== informationPolicy.policyVersion
    || document.policy_hash !== currentHash
    || (context.authorizationSource === "stratos_projection" && (
      decision.constraints.policy_binding_id !== document.policy_binding_id
      || decision.constraints.policy_hash !== document.policy_hash
    ))
    || (payload && (
      document.policy_binding_id !== payload.policy_binding_id
      || document.policy_version !== payload.policy_version
      || document.policy_hash !== payload.policy_hash
    ))
  ) {
    throw new UploadPreflightError(409, "UPLOAD_POLICY_BINDING_STALE", "Document policy changed after authorization.");
  }
  const profile = document.document_profile;
  if (!profile || !document.current_root_metadata_revision || !document.current_root_snapshot_hash) {
    throw new UploadPreflightError(503, "DOCUMENT_PROFILE_UNAVAILABLE", "Confirmed document provenance and accountability are unavailable.");
  }
  const snapshotHash = `sha256:${createHash("sha256").update(canonicalDocumentSnapshot(profile)).digest("hex")}`;
  if (profile.documentId !== documentId || profile.metadataRevision !== document.current_root_metadata_revision
    || snapshotHash !== document.current_root_snapshot_hash
    || (payload && payload.document_profile?.expected_root_metadata_revision !== document.current_root_metadata_revision)) {
    throw new UploadPreflightError(409, "UPLOAD_DOCUMENT_PROFILE_STALE", "Document responsibility or provenance changed after upload preparation.");
  }
  return { document, informationPolicy, policyHash: currentHash };
}

export interface DocumentIntakeAuthorizationDependencies {
  registry: IntakeRegistry;
  getUserContext: (request: Request) => Promise<ApiRequestContext>;
  getBudgetService: (request: Request) => Promise<StratosDocumentServicePrincipal>;
  getBudgetActor?: (request: Request) => Promise<ApiRequestContext>;
  acceptContent?: typeof acceptDocumentIntakeContent;
}

/** Authorization completes before the content reader, quarantine or scanner runs. */
export async function acceptAuthorizedDocumentIntakeContent(
  input: Parameters<typeof acceptDocumentIntakeContent>[0],
  dependencies: DocumentIntakeAuthorizationDependencies,
): Promise<DocumentIntakeAcceptedUpload> {
  const { payload, request, sessionId } = input;
  if (payload.session_id !== sessionId) {
    throw new UploadPreflightError(400, "UPLOAD_SESSION_MISMATCH", "Upload session id does not match the signed token.");
  }
  if (payload.purpose === CONTROLLED_DOCUMENT_UPLOAD_TOKEN_PURPOSE) {
    await authorizeControlledDocumentUpload({
      registry: dependencies.registry,
      context: await dependencies.getUserContext(request),
      documentId: payload.document_id,
      payload,
    });
  } else if (payload.purpose === "stratos-source-upload") {
    await authorizeSourceUpload(request, payload, await dependencies.getBudgetService(request));
  } else if (payload.purpose === "stratos-budget-upload") {
    await authorizeBudgetDocumentUpload({ request, payload,
      service: await dependencies.getBudgetService(request), registry: dependencies.registry,
      getBudgetActor: dependencies.getBudgetActor });
  } else {
    // Official collection sync uses the internal intake core, not this HTTP boundary.
    deny("UPLOAD_TOKEN_PURPOSE_MISMATCH", "This upload purpose has no authorized HTTP intake boundary.");
  }
  return (dependencies.acceptContent ?? acceptDocumentIntakeContent)(input);
}


/** Reused at PUT and confirm; fresh actor/source/profile authority precedes stored-byte reads. */
export async function authorizeBudgetDocumentUpload(input: {
  request: Request;
  payload: UploadTokenPayload;
  service: StratosDocumentServicePrincipal;
  registry: Pick<IntakeRegistry, "authorizeBudgetDocumentIntake">;
  getBudgetActor?: DocumentIntakeAuthorizationDependencies["getBudgetActor"];
}): Promise<ApiRequestContext | null> {
  const { request, payload, service, registry, getBudgetActor } = input;
  if (
    service.clientId !== "stratos-akb-service"
    || !service.allowedSourceSystems.includes("STRATOS_BUDGET")
    || payload.governance_registered_by_subject_id !== service.subjectId
  ) {
    deny("UPLOAD_SERVICE_MISMATCH", "The service does not match the signed Budget upload decision.");
  }
  const authorizationRequest = budgetIntakeAuthorizationRequest(payload);
  const actor = await budgetActorContextForMode(
    request,
    authorizationRequest.actor_subject_id,
    authorizationRequest.workflow_mode,
    authorizationRequest.correlation_id,
    getBudgetActor,
  );
  if (actor && (!actor.accessToken || actor.accessToken === service.accessToken)) {
    deny("STRATOS_BUDGET_TOKEN_SEPARATION_REQUIRED", "Separate current service and actor credentials are required.");
  }
  const decision = await registry.authorizeBudgetDocumentIntake(
    payload.document_id,
    authorizationRequest,
    budgetServiceContext(service, authorizationRequest.correlation_id),
    actor?.accessToken,
  );
  if (decision.allowed !== true) {
    deny("UPLOAD_NOT_AUTHORIZED", "Current source authorization denies this upload.");
  }
  if (
    decision.document_id !== payload.document_id
    || decision.upload_session_id !== payload.session_id
    || decision.confirmed_subject_id !== authorizationRequest.actor_subject_id
    || decision.registered_by_subject_id !== service.subjectId
    || decision.policy_binding_id !== payload.policy_binding_id
    || decision.policy_version !== payload.policy_version
    || decision.policy_hash !== payload.policy_hash
    || decision.source_governed_resource_id !== payload.source_governed_resource_id
    || decision.source_version !== payload.source_version
  ) {
    throw new UploadPreflightError(502, "UPLOAD_AUTHORIZATION_CONFLICT", "Registry returned a conflicting intake authorization.");
  }
  return actor;
}

export function budgetIntakeAuthorizationRequest(payload: UploadTokenPayload): BudgetIntakeAuthorizationRequest {
  const lineage = stratosBudgetVersionLineageFromUploadToken(payload);
  if (payload.governance_scope?.type !== "budget_scope") {
    deny("UPLOAD_GOVERNANCE_INVALID", "The signed Budget scope is invalid.");
  }
  return {
    document_profile: parseDocumentVersionProfileInput(payload.document_profile),
    upload_session_id: required(payload.session_id),
    external_document_id: required(payload.external_document_id),
    governed_document_resource_id: required(payload.governed_document_resource_id),
    source_governed_resource_id: required(payload.source_governed_resource_id),
    source_resource_id: required(payload.source_resource_id),
    source_version: required(payload.source_version),
    policy_binding_id: required(payload.policy_binding_id),
    policy_version: required(payload.policy_version),
    policy_hash: required(payload.policy_hash),
    governance_scope: { type: "budget_scope", id: required(payload.governance_scope.id) },
    actor_subject_id: required(payload.governance_actor_subject_id),
    registered_by_subject_id: required(payload.governance_registered_by_subject_id),
    correlation_id: required(payload.governance_correlation_id),
    idempotency_key: required(payload.governance_idempotency_key),
    workflow_mode: lineage.upload_mode,
    workflow_context: payload.workflow_context ?? {},
  };
}

function required(value: string | null | undefined): string {
  if (!value?.trim()) deny("UPLOAD_GOVERNANCE_INVALID", "The signed upload governance coordinates are incomplete.");
  return value;
}

function deny(code: string, message: string): never {
  throw new UploadPreflightError(403, code, message);
}
