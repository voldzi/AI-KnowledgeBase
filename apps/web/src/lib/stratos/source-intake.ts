import "server-only";
import { getAklConfig } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http-client";
import { ApiClientError, type ApiRequestContext, type DocumentVersion } from "@/lib/types";
import type { ExternalDocumentResponse } from "./document-ai";
import { budgetServiceContext } from "./budget-upload-authorization";
import { getStratosActorRequestContext, requireStratosActorSubjectMatch } from "./actor-authorization";
import { requireStratosDocumentSourceAllowed, type StratosDocumentServicePrincipal } from "./document-service-auth";
import { parseDocumentVersionProfileInput } from "@/lib/documents/document-profile-validation";
import { type UploadTokenPayload, UploadPreflightError } from "@/lib/upload/preflight";
import type { DocumentVersionProfileInput } from "@/lib/documents/document-profile";

export const SOURCE_UPLOAD_PURPOSE = "stratos-source-upload";
export type SourcePrepared = {
  external_document: ExternalDocumentResponse & { document: ExternalDocumentResponse["document"] & { governed_resource_id?: string | null } };
  document_profile: DocumentVersionProfileInput;
  expected_current_ingestion_job_id: string | null;
};
export type SourceConfirmed = { version: DocumentVersion; external_document_id: string };

export function requiredSourceText(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 128) {
    throw new UploadPreflightError(422, "SOURCE_INTAKE_SCHEMA_INVALID", "An exact non-empty source coordinate is required.");
  }
  return value;
}

export function sourceSystemForService(service: StratosDocumentServicePrincipal, value: unknown) {
  const source = requireStratosDocumentSourceAllowed(service, value);
  if (source !== "STRATOS_PROJECTFLOW" && source !== "STRATOS_ARCHFLOW") {
    throw new UploadPreflightError(403, "SOURCE_INTAKE_SERVICE_DENIED", "This endpoint requires a ProjectFlow or ArchFlow source service.");
  }
  return source;
}

export async function sourceActor(request: Request, subject: string, service: StratosDocumentServicePrincipal): Promise<ApiRequestContext> {
  const actor = await getStratosActorRequestContext(request);
  requireStratosActorSubjectMatch(actor, subject);
  if (!actor.accessToken || actor.accessToken === service.accessToken || actor.serviceClientId) {
    throw new UploadPreflightError(403, "SOURCE_INTAKE_TOKEN_SEPARATION_REQUIRED", "Separate current person and source service credentials are required.");
  }
  return actor;
}

export async function sourceRegistryRequest<T>(path: string, body: unknown, service: StratosDocumentServicePrincipal, actor: ApiRequestContext, correlationId: string): Promise<T> {
  const config = getAklConfig();
  if (config.apiClientMode !== "production") {
    throw new ApiClientError("Source intake requires the real Registry.", 503, "SOURCE_INTAKE_UNAVAILABLE", correlationId);
  }
  return requestJson<T>({ service: "registry-api", operation: "stratosSourceIntake",
    baseUrl: config.serviceBaseUrls.registry, path: `/integrations/stratos-source-intake${path}`,
    method: "POST", body, context: budgetServiceContext(service, correlationId),
    extraHeaders: { "X-STRATOS-Actor-Authorization": `Bearer ${actor.accessToken}` }, timeoutMs: 30000 });
}

export function sourceAuthorizationBody(payload: UploadTokenPayload, service: StratosDocumentServicePrincipal) {
  if (payload.purpose !== SOURCE_UPLOAD_PURPOSE || payload.workflow_mode !== "interactive"
    || payload.governance_registered_by_subject_id !== service.subjectId) {
    throw new UploadPreflightError(403, "SOURCE_INTAKE_SERVICE_MISMATCH", "The upload is bound to another service or purpose.");
  }
  sourceSystemForService(service, payload.workflow_context?.source_system);
  return {
    external_document_id: requiredSourceText(payload.external_document_id),
    document_profile: parseDocumentVersionProfileInput(payload.document_profile),
    file: { file_name: payload.file_name, file_size: payload.file_size, file_type: payload.file_type, sha256: payload.sha256 },
    source_revision: requiredSourceText(payload.workflow_context?.source_revision),
    version_label: requiredSourceText(payload.workflow_context?.version_label),
    actor_subject_id: requiredSourceText(payload.governance_actor_subject_id),
    registered_by_subject_id: service.subjectId,
    correlation_id: requiredSourceText(payload.governance_correlation_id),
    policy_hash: requiredSourceText(payload.policy_hash),
  };
}

/** Called before any upload bytes are read, and again before confirm object reads. */
export async function authorizeSourceUpload(request: Request, payload: UploadTokenPayload, service: StratosDocumentServicePrincipal) {
  const body = sourceAuthorizationBody(payload, service);
  const actor = await sourceActor(request, body.actor_subject_id, service);
  const decision = await sourceRegistryRequest<{ allowed: boolean; document_id: string; external_document_id: string;
    actor_subject_id: string; registered_by_subject_id: string; policy_hash: string }>(
    `/documents/${encodeURIComponent(payload.document_id)}/authorize`, body, service, actor, body.correlation_id);
  if (decision.allowed !== true || decision.document_id !== payload.document_id
    || decision.external_document_id !== body.external_document_id || decision.actor_subject_id !== body.actor_subject_id
    || decision.registered_by_subject_id !== service.subjectId || decision.policy_hash !== body.policy_hash) {
    throw new UploadPreflightError(502, "SOURCE_INTAKE_AUTHORIZATION_CONFLICT", "Registry returned a conflicting source decision.");
  }
  return actor;
}
