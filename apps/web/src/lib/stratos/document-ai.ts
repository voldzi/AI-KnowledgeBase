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
import { equalCanonicalJson, parseAiipGovernanceConfirmation } from "@/lib/stratos/aiip-governance";
import { getUploadSettings, type UploadSettings } from "@/lib/upload/preflight";
import {
  parseInformationPolicy,
  parseIntegrationEnvelope,
  STRATOS_ORGANIZATION_ID,
  type IntegrationEnvelope,
} from "@/lib/stratos/information-policy";

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
  governance_confirmation?: AiipGovernanceConfirmation;
}

export interface AiipGovernanceConfirmation {
  parent_source_resource: {
    governed_resource_id: string;
    application: "AIIP";
    resource_type: "idea";
    resource_id: string;
    source_version: string;
    scope: IntegrationEnvelope["sourceResource"]["scope"];
  };
  governed_resource: {
    id: string;
    application: "AKB";
    resource_type: "document" | "document-version";
    resource_id: string;
    source_version: string;
    parent_id: string;
    scope: IntegrationEnvelope["sourceResource"]["scope"];
    policy_assignment: "INHERITED";
    explicit_policy_binding_id: null;
    inherited_from_resource_id: string;
    effective_policy: {
      policy_binding_id: string;
      policy_version: string;
      policy_hash: string;
    };
    registered_by_subject_id: string;
    confirmed_by_subject_id: string;
  };
  document_policy_binding_id: string;
  document_policy_version: string;
  document_policy_hash: string;
  actor_subject_id: string;
  correlation_id: string;
  idempotency_key: string;
}

export interface AiipDocumentVersionUpsertResponse {
  version: DocumentVersion;
  external_document: ExternalDocumentResponse;
  created: boolean;
  governance_confirmation: AiipGovernanceConfirmation;
}

export interface AiipExternalCurrentUpdateResponse {
  external_document: ExternalDocumentResponse;
  updated: boolean;
  governance_confirmation: AiipGovernanceConfirmation;
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
  governance_confirmation: AiipGovernanceConfirmation;
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

export const AIIP_PREFLIGHT_FIELDS = [
  "tenant_id",
  "external_system",
  "external_ref",
  "entity_type",
  "entity_id",
  "document_type",
  "title",
  "classification",
  "information_policy",
  "governance_scope",
  "integration_envelope",
  "owner_actor_id",
  "context_tags",
  "source_location",
  "citation_base_url",
  "preview_url",
  "file_name",
  "file_type",
  "file_size",
  "sha256",
] as const;

export function assertExactFields(
  body: Record<string, unknown>,
  allowedFields: readonly string[],
  contract: string,
): void {
  const unknownFields = Object.keys(body).filter((field) => !allowedFields.includes(field)).sort();
  if (unknownFields.length > 0) {
    throw new ApiClientError(
      `${contract} contains unsupported fields.`,
      422,
      "AIIP_UPLOAD_SCHEMA_INVALID",
      "web-stratos-bridge",
    );
  }
}

export function assertRequiredStringFields(
  body: Record<string, unknown>,
  fields: readonly string[],
  contract: string,
): void {
  const invalid = fields.filter(
    (field) => typeof body[field] !== "string" || !(body[field] as string).trim(),
  );
  if (invalid.length > 0) {
    throw new ApiClientError(
      `${contract} requires non-empty string fields: ${invalid.join(", ")}.`,
      422,
      "AIIP_UPLOAD_SCHEMA_INVALID",
      "web-stratos-bridge",
    );
  }
}

export function requiredString(body: Record<string, unknown>, field: string): string {
  const value = String(body[field] ?? "").trim();
  if (!value) {
    throw new ApiClientError(`${field} is required.`, 400, "BAD_REQUEST", "web-stratos-bridge");
  }
  return value;
}

function requiredEqualString(
  body: Record<string, unknown>,
  field: string,
  expected: string,
): string {
  const value = requiredString(body, field);
  if (value !== expected) {
    throw new ApiClientError(
      `${field} must equal ${expected}.`,
      422,
      "AIIP_UPLOAD_IDENTITY_INVALID",
      "web-stratos-bridge",
    );
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
  repository?: string | null;
  path?: string | null;
  version?: string | null;
}): SourceLocationInput {
  return {
    kind: input.sourceFileUri ? "object_storage" : "uploaded_file",
    uri: input.sourceFileUri ?? null,
    file_name: input.fileName,
    content_type: input.fileType,
    sha256: input.sha256,
    storage_ref: input.objectKey ?? null,
    captured_at: new Date().toISOString(),
    repository: input.repository ?? null,
    path: input.path ?? null,
    version: input.version ?? null,
  };
}

export async function upsertExternalDocument(
  body: Record<string, unknown>,
  context: ApiRequestContext,
  actorAuthorization: string,
): Promise<ExternalDocumentResponse> {
  assertExactFields(body, AIIP_PREFLIGHT_FIELDS, "AIIP upload preflight");
  assertRequiredStringFields(
    body,
    [
      "tenant_id", "external_system", "external_ref", "entity_type", "entity_id",
      "document_type", "title", "classification", "file_name", "file_type", "sha256",
    ],
    "AIIP upload preflight",
  );
  const config = getAklConfig();
  if (config.apiClientMode !== "production") {
    throw new ApiClientError(
      "STRATOS document bridge requires AKL_API_CLIENT_MODE=production because external document upsert is a Registry contract.",
      503,
      "STRATOS_BRIDGE_REQUIRES_REGISTRY",
      "web-stratos-bridge"
    );
  }

  const title = requiredString(body, "title");
  const classification = requiredAllowedString(
    body,
    "classification",
    ["public", "internal", "restricted"],
  );
  const sourceLocation = parseAiipSourceLocation(body.source_location);
  const informationPolicy = parseInformationPolicy(body.information_policy);
  const integrationEnvelope = parseIntegrationEnvelope(body.integration_envelope, informationPolicy);
  if (
    !integrationEnvelope ||
    integrationEnvelope.sourceSystem !== "STRATOS_AIIP" ||
    integrationEnvelope.actor.type !== "person" ||
    integrationEnvelope.externalRef !== requiredString(body, "external_ref")
  ) {
    throw new ApiClientError(
      "AIIP upload requires an exact person-authored governed source envelope.",
      422,
      "AIIP_GOVERNED_SOURCE_REQUIRED",
      "web-stratos-bridge",
    );
  }
  const claimedOwner = strictOptionalString(body, "owner_actor_id");
  if (claimedOwner && claimedOwner !== integrationEnvelope.actor.subjectId) {
    throw new ApiClientError(
      "AIIP upload owner does not match the freshly authenticated envelope actor.",
      409,
      "AIIP_UPLOAD_OWNER_CONFLICT",
      "web-stratos-bridge",
    );
  }

  const entityType = requiredAllowedString(
    body,
    "entity_type",
    ["InnovationRequest", "InnovationRequestImport"],
  );
  const entityId = requiredString(body, "entity_id");
  const documentType = requiredAllowedString(
    body,
    "document_type",
    [
      "ai_intake",
      "ai_requirement_card",
      "ai_security_appendix",
      "ai_governance_evidence",
      "knowledge_base_article",
      "project_documentation",
      "attachment",
      "other",
    ],
  );
  const fileName = requiredString(body, "file_name");
  const fileType = requiredString(body, "file_type");
  const sha256 = requiredString(body, "sha256").toLowerCase();
  const governanceScope = recordValue(body.governance_scope);
  if (
    integrationEnvelope.payload.entityType !== entityType ||
    integrationEnvelope.payload.entityId !== entityId ||
    integrationEnvelope.payload.sha256 !== sha256 ||
    sourceLocation.path !== integrationEnvelope.payload.sourceDocumentId ||
    sourceLocation.sha256 !== sha256 ||
    (sourceLocation.file_name != null && sourceLocation.file_name !== fileName) ||
    (sourceLocation.content_type != null && sourceLocation.content_type !== fileType) ||
    !governanceScope ||
    !equalCanonicalJson(governanceScope, integrationEnvelope.sourceResource.scope)
  ) {
    throw new ApiClientError(
      "AIIP upload payload, source location and governed envelope must identify the exact same artifact.",
      422,
      "AIIP_UPLOAD_LINEAGE_INVALID",
      "web-stratos-bridge",
    );
  }

  const response = await requestJson<ExternalDocumentResponse>({
    service: "registry-api",
    operation: "stratosExternalDocumentUpsert",
    baseUrl: config.serviceBaseUrls.registry,
    path: "/integrations/aiip-upload/external-documents/upsert",
    method: "POST",
    context,
    body: {
      tenant_id: requiredEqualString(body, "tenant_id", STRATOS_ORGANIZATION_ID),
      external_system: requiredEqualString(body, "external_system", "STRATOS_AIIP"),
      external_ref: requiredString(body, "external_ref"),
      entity_type: entityType,
      entity_id: entityId,
      document_type: documentType,
      title,
      classification,
      information_policy: informationPolicy,
      integration_envelope: integrationEnvelope,
      governance_scope: integrationEnvelope.sourceResource.scope,
      tags: strictStringList(body.context_tags, "context_tags"),
      source_location: sourceLocation,
      citation_base_url: strictOptionalString(body, "citation_base_url") ?? undefined,
      preview_url: strictOptionalString(body, "preview_url") ?? undefined
    },
    extraHeaders: { "X-AIIP-Actor-Authorization": actorAuthorization },
  });
  response.governance_confirmation = parseAiipGovernanceConfirmation(response.governance_confirmation);
  return response;
}

export async function upsertAiipDocumentVersion(input: {
  documentId: string;
  body: Record<string, unknown>;
  versionLabel: string;
  sourceLocation: SourceLocationInput;
  serviceContext: ApiRequestContext;
  actorAuthorization: string;
}): Promise<AiipDocumentVersionUpsertResponse> {
  const config = getAklConfig();
  const informationPolicy = parseInformationPolicy(input.body.information_policy);
  const integrationEnvelope = parseIntegrationEnvelope(
    input.body.integration_envelope,
    informationPolicy,
  );
  if (!integrationEnvelope || integrationEnvelope.sourceSystem !== "STRATOS_AIIP") {
    throw new ApiClientError(
      "AIIP upload confirmation requires the immutable governed source envelope.",
      422,
      "AIIP_GOVERNED_SOURCE_REQUIRED",
      "web-stratos-bridge",
    );
  }
  const fileHash = requiredString(input.body, "file_hash");
  const fileSize = Number(input.body.file_size);
  const response = await requestJson<AiipDocumentVersionUpsertResponse>({
    service: "registry-api",
    operation: "aiipDocumentVersionUpsert",
    baseUrl: config.serviceBaseUrls.registry,
    path: `/integrations/aiip-upload/documents/${encodeURIComponent(input.documentId)}/versions`,
    method: "PUT",
    context: input.serviceContext,
    extraHeaders: { "X-AIIP-Actor-Authorization": input.actorAuthorization },
    body: {
      version_label: input.versionLabel,
      valid_from: optionalString(input.body, "valid_from") ?? new Date().toISOString().slice(0, 10),
      valid_to: optionalString(input.body, "valid_to"),
      source_file_uri: requiredString(input.body, "source_file_uri"),
      source_location: input.sourceLocation,
      file_hash: fileHash,
      change_summary: optionalString(input.body, "change_summary") ?? "STRATOS document upload.",
      information_policy: informationPolicy,
      integration_envelope: integrationEnvelope,
      governance_scope: integrationEnvelope.sourceResource.scope,
      file: {
        filename: requiredString(input.body, "file_name"),
        mime_type: optionalString(input.body, "file_type"),
        size_bytes: Number.isFinite(fileSize) ? fileSize : 0,
        sha256: fileHash,
      },
    },
  });
  response.governance_confirmation = parseAiipGovernanceConfirmation(response.governance_confirmation);
  return response;
}

export async function updateAiipExternalDocumentCurrent(input: {
  externalDocumentId: string;
  documentId: string;
  expectedCurrentDocumentVersionId: string | null;
  version: DocumentVersion;
  fileId: string;
  ingestionJobId: string;
  ingestionStatus: string;
  body: Record<string, unknown>;
  serviceContext: ApiRequestContext;
  actorAuthorization: string;
}): Promise<AiipExternalCurrentUpdateResponse> {
  const config = getAklConfig();
  const informationPolicy = parseInformationPolicy(input.body.information_policy);
  const integrationEnvelope = parseIntegrationEnvelope(
    input.body.integration_envelope,
    informationPolicy,
  );
  if (!integrationEnvelope || integrationEnvelope.sourceSystem !== "STRATOS_AIIP") {
    throw new ApiClientError(
      "AIIP current-state update requires the immutable governed source envelope.",
      422,
      "AIIP_GOVERNED_SOURCE_REQUIRED",
      "web-stratos-bridge",
    );
  }
  const response = await requestJson<AiipExternalCurrentUpdateResponse>({
    service: "registry-api",
    operation: "aiipExternalDocumentCurrentUpdate",
    baseUrl: config.serviceBaseUrls.registry,
    path: `/integrations/aiip-upload/external-documents/${encodeURIComponent(input.externalDocumentId)}/current`,
    method: "PATCH",
    context: input.serviceContext,
    extraHeaders: { "X-AIIP-Actor-Authorization": input.actorAuthorization },
    body: {
      document_id: input.documentId,
      expected_current_document_version_id: input.expectedCurrentDocumentVersionId,
      document_version_id: input.version.document_version_id,
      file_id: input.fileId,
      ingestion_job_id: input.ingestionJobId,
      ingestion_status: input.ingestionStatus,
      information_policy: informationPolicy,
      integration_envelope: integrationEnvelope,
      governance_scope: integrationEnvelope.sourceResource.scope,
    },
  });
  response.governance_confirmation = parseAiipGovernanceConfirmation(response.governance_confirmation);
  return response;
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

function strictStringList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new ApiClientError(`${field} must be an array of non-empty strings.`, 422, "AIIP_UPLOAD_SCHEMA_INVALID", "web-stratos-bridge");
  }
  return [...new Set(value.map((item) => item.trim()))];
}

function strictOptionalString(body: Record<string, unknown>, field: string): string | null {
  if (!(field in body) || body[field] === null) return null;
  const value = body[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiClientError(
      `${field} must be a non-empty string or null.`,
      422,
      "AIIP_UPLOAD_SCHEMA_INVALID",
      "web-stratos-bridge",
    );
  }
  return value.trim();
}

function parseAiipSourceLocation(value: unknown): SourceLocationInput {
  const source = recordValue(value);
  if (!source) {
    throw new ApiClientError("source_location is required.", 422, "AIIP_UPLOAD_SCHEMA_INVALID", "web-stratos-bridge");
  }
  const allowed = [
    "kind", "uri", "file_name", "content_type", "sha256", "storage_ref", "captured_at",
    "display_url", "repository", "path", "version",
  ];
  const unknown = Object.keys(source).filter((field) => !allowed.includes(field));
  if (unknown.length > 0) {
    throw new ApiClientError(
      "source_location contains unsupported fields.",
      422,
      "AIIP_UPLOAD_SCHEMA_INVALID",
      "web-stratos-bridge",
    );
  }
  for (const [field, fieldValue] of Object.entries(source)) {
    if (fieldValue !== null && typeof fieldValue !== "string") {
      throw new ApiClientError(
        `source_location.${field} must be a string or null.`,
        422,
        "AIIP_UPLOAD_SCHEMA_INVALID",
        "web-stratos-bridge",
      );
    }
  }
  return {
    kind: requiredRecordText(source, "kind"),
    uri: optionalRecordText(source, "uri"),
    file_name: optionalRecordText(source, "file_name"),
    content_type: optionalRecordText(source, "content_type"),
    sha256: requiredRecordText(source, "sha256").toLowerCase(),
    storage_ref: optionalRecordText(source, "storage_ref"),
    captured_at: optionalRecordText(source, "captured_at"),
    display_url: optionalRecordText(source, "display_url"),
    repository: optionalRecordText(source, "repository"),
    path: requiredRecordText(source, "path"),
    version: optionalRecordText(source, "version"),
  };
}

function requiredRecordText(record: Record<string, unknown>, field: string): string {
  const value = optionalRecordText(record, field);
  if (!value) {
    throw new ApiClientError(`source_location.${field} is required.`, 422, "AIIP_UPLOAD_SCHEMA_INVALID", "web-stratos-bridge");
  }
  return value;
}

function requiredAllowedString(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly string[],
): string {
  const value = requiredString(body, field);
  if (!allowed.includes(value)) {
    throw new ApiClientError(
      `${field} is not supported by the dedicated AIIP upload contract.`,
      422,
      "AIIP_UPLOAD_SCHEMA_INVALID",
      "web-stratos-bridge",
    );
  }
  return value;
}

function optionalRecordText(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function optionalRecordString(record: Record<string, unknown> | null, field: string): string | null {
  const value = String(record?.[field] ?? "").trim();
  return value || null;
}
