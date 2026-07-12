import "server-only";

import type {
  ApiRequestContext,
  CreateIngestionJobRequest,
  Document,
  DocumentVersion,
  IngestionJob,
  SourceContext
} from "@/lib/types";
import { ApiClientError } from "@/lib/types";
import { getAklConfig } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http-client";
import { withAppBasePath } from "@/lib/app-url";
import { getUploadSettings, type UploadSettings } from "@/lib/upload/preflight";
import { parseInformationPolicy, parseIntegrationEnvelope, policyHash } from "@/lib/stratos/information-policy";

export type StratosIngestionStatus =
  | "REGISTERED"
  | "VERSION_CREATED"
  | "UPLOADING"
  | "INGESTING"
  | "INDEXED"
  | "FAILED"
  | "PERMISSION_DENIED"
  | "STALE";

export interface ExternalDocumentRef {
  external_document_id: string;
  tenant_id: string;
  external_system: string;
  external_ref: string;
  entity_type: string;
  entity_id: string;
  document_id: string;
  current_document_version_id: string | null;
  current_file_id: string | null;
  current_ingestion_job_id: string | null;
  current_ingestion_status: string | null;
  akb_source_uri: string | null;
  source_location: Record<string, unknown> | null;
  citation_base_url: string | null;
  preview_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ExternalDocumentResponse {
  external_document: ExternalDocumentRef;
  document: Document & { metadata?: Record<string, unknown> };
  created: boolean;
}

export interface ExternalDocumentCurrentUpdateRequest {
  current_document_version_id?: string | null;
  current_file_id?: string | null;
  current_ingestion_job_id?: string | null;
  current_ingestion_status?: string | null;
  akb_source_uri?: string | null;
  source_location?: SourceLocationInput | null;
}

export interface StratosSearchItem {
  document_id: string;
  document_version_id: string | null;
  external_document_id: string | null;
  external_ref: string | null;
  tenant_id?: string | null;
  external_system?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  title: string;
  classification: string;
  document_type: string;
  ingestion_status: StratosIngestionStatus;
  canonical_open_url: string;
}

export interface StratosUploadConfirmResult {
  document_id: string;
  document_version_id: string;
  external_document_id: string;
  file_id: string;
  ingestion_job_id: string;
  ingestion_status: StratosIngestionStatus;
  idempotent_replay: boolean;
  canonical_open_url: string;
  policy_binding_id: string;
  policy_version: string;
  policy_hash: string;
}

export interface SourceLocationInput {
  kind: string;
  uri?: string | null;
  file_name?: string | null;
  content_type?: string | null;
  sha256?: string | null;
  storage_ref?: string | null;
  captured_at?: string | null;
  display_url?: string | null;
  repository?: string | null;
  path?: string | null;
  version?: string | null;
}

export function requiredString(body: Record<string, unknown>, field: string): string {
  const value = String(body[field] ?? "").trim();
  if (!value) {
    throw new ApiClientError(`${field} is required.`, 400, "BAD_REQUEST", "web-stratos-bridge");
  }
  return value;
}

export function optionalString(body: Record<string, unknown>, field: string): string | null {
  const value = String(body[field] ?? "").trim();
  return value || null;
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

export function positiveInteger(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function getStratosUploadSettings(): UploadSettings {
  return {
    ...getUploadSettings(),
    publicUploadBasePath: withAppBasePath("/api/stratos/upload/sessions")
  };
}

export function canonicalDocumentUrl(input: {
  documentId: string;
  documentVersionId?: string | null;
  chunkId?: string | null;
  page?: string | number | null;
}): string {
  const params = new URLSearchParams({ tab: "viewer" });
  if (input.documentVersionId) params.set("version_id", input.documentVersionId);
  if (input.chunkId) params.set("chunk_id", input.chunkId);
  if (input.page !== undefined && input.page !== null && String(input.page).trim()) {
    params.set("page", String(input.page));
  }
  return withAppBasePath(`/documents/${encodeURIComponent(input.documentId)}?${params}`);
}

export function embedDocumentUrl(input: {
  documentId: string;
  documentVersionId?: string | null;
  chunkId?: string | null;
  page?: string | number | null;
}): string {
  const params = new URLSearchParams();
  if (input.documentVersionId) params.set("version_id", input.documentVersionId);
  if (input.chunkId) params.set("chunk_id", input.chunkId);
  if (input.page !== undefined && input.page !== null && String(input.page).trim()) {
    params.set("page", String(input.page));
  }
  const query = params.toString();
  return withAppBasePath(`/embed/documents/${encodeURIComponent(input.documentId)}${query ? `?${query}` : ""}`);
}

export function sourceLocationForUpload(input: {
  fileName: string;
  fileType: string | null;
  sha256: string | null;
  sourceFileUri?: string | null;
  objectKey?: string | null;
}): SourceLocationInput {
  return {
    kind: input.sourceFileUri ? "object_storage" : "uploaded_file",
    uri: input.sourceFileUri ?? null,
    file_name: input.fileName,
    content_type: input.fileType,
    sha256: input.sha256,
    storage_ref: input.objectKey ?? null,
    captured_at: new Date().toISOString()
  };
}

export async function upsertExternalDocument(
  body: Record<string, unknown>,
  context: ApiRequestContext
): Promise<ExternalDocumentResponse> {
  const config = getAklConfig();
  if (config.apiClientMode !== "production") {
    throw new ApiClientError(
      "STRATOS document bridge requires AKL_API_CLIENT_MODE=production because external document upsert is a Registry contract.",
      503,
      "STRATOS_BRIDGE_REQUIRES_REGISTRY",
      "web-stratos-bridge"
    );
  }

  const title =
    optionalString(body, "title") ??
    optionalString(body, "file_name") ??
    `${requiredString(body, "external_system")} ${requiredString(body, "external_ref")}`;
  const sourceLocation = recordValue(body.source_location) ?? sourceLocationForUpload({
    fileName: optionalString(body, "file_name") ?? title,
    fileType: optionalString(body, "file_type"),
    sha256: optionalString(body, "sha256")
  });
  const informationPolicy = parseInformationPolicy(body.information_policy);
  const integrationEnvelope = parseIntegrationEnvelope(body.integration_envelope, informationPolicy);

  return requestJson<ExternalDocumentResponse>({
    service: "registry-api",
    operation: "stratosExternalDocumentUpsert",
    baseUrl: config.serviceBaseUrls.registry,
    path: "/external-documents/upsert",
    method: "POST",
    context,
    body: {
      tenant_id: requiredString(body, "tenant_id"),
      external_system: requiredString(body, "external_system"),
      external_ref: requiredString(body, "external_ref"),
      entity_type: requiredString(body, "entity_type"),
      entity_id: requiredString(body, "entity_id"),
      document_type: requiredString(body, "document_type"),
      title,
      classification: optionalString(body, "classification") ?? "internal",
      information_policy: informationPolicy,
      integration_envelope: integrationEnvelope ?? undefined,
      owner: {
        user_id: requiredString(body, "owner_actor_id"),
        display_name: optionalString(body, "owner_display_name") ?? undefined
      },
      gestor_unit: optionalString(body, "gestor_unit") ?? undefined,
      tags: stringList(body.context_tags),
      metadata: {
        ...(recordValue(body.metadata) ?? {}),
        stratos: {
          tenant_id: requiredString(body, "tenant_id"),
          external_system: requiredString(body, "external_system"),
          external_ref: requiredString(body, "external_ref"),
          entity_type: requiredString(body, "entity_type"),
          entity_id: requiredString(body, "entity_id"),
          context_tags: stringList(body.context_tags),
          policy_binding_id: informationPolicy.policyBindingId,
          policy_version: informationPolicy.policyVersion,
          policy_hash: policyHash(informationPolicy)
        },
        ...(integrationEnvelope
          ? {
              integration_envelope: {
                schema_version: integrationEnvelope.schemaVersion,
                source_system: integrationEnvelope.sourceSystem,
                correlation_id: integrationEnvelope.correlationId,
                idempotency_key: integrationEnvelope.idempotencyKey,
                policy_hash: integrationEnvelope.policyHash
              }
            }
          : {})
      },
      source_location: sourceLocation,
      citation_base_url: optionalString(body, "citation_base_url") ?? undefined,
      preview_url: optionalString(body, "preview_url") ?? undefined
    }
  });
}

export async function updateExternalDocumentCurrent(
  externalDocumentId: string,
  body: ExternalDocumentCurrentUpdateRequest,
  context: ApiRequestContext
): Promise<ExternalDocumentResponse> {
  const config = getAklConfig();
  if (config.apiClientMode !== "production") {
    throw new ApiClientError(
      "STRATOS document bridge requires AKL_API_CLIENT_MODE=production because external document current state is a Registry contract.",
      503,
      "STRATOS_BRIDGE_REQUIRES_REGISTRY",
      "web-stratos-bridge"
    );
  }

  return requestJson<ExternalDocumentResponse>({
    service: "registry-api",
    operation: "stratosExternalDocumentCurrentUpdate",
    baseUrl: config.serviceBaseUrls.registry,
    path: `/external-documents/${encodeURIComponent(externalDocumentId)}/current`,
    method: "PATCH",
    context,
    body
  });
}

export async function getExternalDocument(
  externalDocumentId: string,
  context: ApiRequestContext
): Promise<ExternalDocumentResponse> {
  const config = getAklConfig();
  if (config.apiClientMode !== "production") {
    throw new ApiClientError(
      "STRATOS document bridge requires AKL_API_CLIENT_MODE=production because external document state is a Registry contract.",
      503,
      "STRATOS_BRIDGE_REQUIRES_REGISTRY",
      "web-stratos-bridge"
    );
  }

  return requestJson<ExternalDocumentResponse>({
    service: "registry-api",
    operation: "stratosExternalDocumentGet",
    baseUrl: config.serviceBaseUrls.registry,
    path: `/external-documents/${encodeURIComponent(externalDocumentId)}`,
    context
  });
}

export function latestVersion(versions: DocumentVersion[]): DocumentVersion | null {
  return [...versions].sort((left, right) => {
    const leftTime = Date.parse(left.published_at ?? left.created_at);
    const rightTime = Date.parse(right.published_at ?? right.created_at);
    return rightTime - leftTime;
  })[0] ?? null;
}

export function mapIngestionStatus(input: {
  version?: DocumentVersion | null;
  job?: IngestionJob | null;
  externalStatus?: string | null;
}): StratosIngestionStatus {
  const rawStatus = String(input.job?.status ?? input.externalStatus ?? "").toLowerCase();
  if (["failed", "cancelled"].includes(rawStatus)) return "FAILED";
  if (["queued", "running"].includes(rawStatus)) return "INGESTING";
  if (["completed", "completed_with_warnings", "indexed"].includes(rawStatus)) return "INDEXED";
  if (["permission_denied", "forbidden"].includes(rawStatus)) return "PERMISSION_DENIED";
  if (["stale"].includes(rawStatus)) return "STALE";
  return input.version ? "VERSION_CREATED" : "REGISTERED";
}

export function toSearchItem(input: {
  document: Document;
  version: DocumentVersion | null;
  job: IngestionJob | null;
  externalDocument?: ExternalDocumentRef | null;
}): StratosSearchItem {
  const externalMetadata = recordValue(input.document.metadata?.external);
  return {
    document_id: input.document.document_id,
    document_version_id: input.version?.document_version_id ?? input.externalDocument?.current_document_version_id ?? null,
    external_document_id: input.externalDocument?.external_document_id ?? null,
    external_ref: input.externalDocument?.external_ref ?? optionalRecordString(externalMetadata, "external_ref"),
    tenant_id: input.externalDocument?.tenant_id ?? optionalRecordString(externalMetadata, "tenant_id"),
    external_system: input.externalDocument?.external_system ?? optionalRecordString(externalMetadata, "external_system"),
    entity_type: input.externalDocument?.entity_type ?? optionalRecordString(externalMetadata, "entity_type"),
    entity_id: input.externalDocument?.entity_id ?? optionalRecordString(externalMetadata, "entity_id"),
    title: input.document.title,
    classification: input.document.classification,
    document_type: input.document.document_type,
    ingestion_status: mapIngestionStatus({
      version: input.version,
      job: input.job,
      externalStatus: input.externalDocument?.current_ingestion_status
    }),
    canonical_open_url: canonicalDocumentUrl({
      documentId: input.document.document_id,
      documentVersionId: input.version?.document_version_id ?? input.externalDocument?.current_document_version_id ?? null
    })
  };
}

export function filterSearchItems(
  items: StratosSearchItem[],
  body: Record<string, unknown>
): StratosSearchItem[] {
  const query = optionalString(body, "query")?.toLowerCase() ?? "";
  const tenantId = optionalString(body, "tenant_id");
  const externalSystem = optionalString(body, "external_system");
  const entityType = optionalString(body, "entity_type");
  const entityId = optionalString(body, "entity_id");
  const classification = optionalString(body, "classification");
  const documentType = optionalString(body, "document_type");
  const ingestionStatus = optionalString(body, "ingestion_status");

  return items.filter((item) => {
    if (query && !`${item.title} ${item.external_ref ?? ""}`.toLowerCase().includes(query)) return false;
    if (tenantId && item.tenant_id && item.tenant_id !== tenantId) return false;
    if (externalSystem && item.external_system && item.external_system !== externalSystem) return false;
    if (entityType && item.entity_type && item.entity_type !== entityType) return false;
    if (entityId && item.entity_id && item.entity_id !== entityId) return false;
    if (classification && item.classification !== classification) return false;
    if (documentType && item.document_type !== documentType) return false;
    if (ingestionStatus && item.ingestion_status !== ingestionStatus) return false;
    return true;
  });
}

export function sourceContextOpenUrls(sourceContext: SourceContext) {
  const page = sourceContext.location.page_number;
  return {
    document_id: sourceContext.document_id,
    document_version_id: sourceContext.document_version_id,
    chunk_id: sourceContext.chunk_id,
    page_number: page,
    viewer_url: embedDocumentUrl({
      documentId: sourceContext.document_id,
      documentVersionId: sourceContext.document_version_id,
      chunkId: sourceContext.chunk_id,
      page
    }),
    canonical_open_url: canonicalDocumentUrl({
      documentId: sourceContext.document_id,
      documentVersionId: sourceContext.document_version_id,
      chunkId: sourceContext.chunk_id,
      page
    })
  };
}

export function createIngestionRequest(input: {
  documentId: string;
  versionId: string;
  sourceFileUri: string;
  body: Record<string, unknown>;
}): CreateIngestionJobRequest {
  return {
    document_id: input.documentId,
    document_version_id: input.versionId,
    source_file_uri: input.sourceFileUri,
    parser_profile: (optionalString(input.body, "parser_profile") ?? "controlled_document") as CreateIngestionJobRequest["parser_profile"],
    ocr_enabled: input.body.ocr_enabled !== false,
    chunking_strategy: (optionalString(input.body, "chunking_strategy") ?? "legal_structured") as CreateIngestionJobRequest["chunking_strategy"],
    embedding_profile: optionalString(input.body, "embedding_profile") ?? "default"
  };
}

export function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function optionalRecordString(record: Record<string, unknown> | null, field: string): string | null {
  const value = String(record?.[field] ?? "").trim();
  return value || null;
}
