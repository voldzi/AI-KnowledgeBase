import "server-only";

import type {
  ApiRequestContext,
  CreateIngestionJobRequest,
  Document,
  DocumentVersion,
  IngestionJob,
  RegistryIngestionAttempt,
  SourceContext
} from "@/lib/types";
import { ApiClientError } from "@/lib/types";
import { getAklConfig } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http-client";
import { withAppBasePath } from "@/lib/app-url";
import { equalCanonicalJson, parseAiipGovernanceConfirmation } from "@/lib/stratos/aiip-governance";
import {
  getUploadSettings,
  type UploadSettings,
  type UploadTokenPayload,
} from "@/lib/upload/preflight";
import {
  parseInformationPolicy,
  parseIntegrationEnvelope,
  parseStratosBudgetIntegrationEnvelope,
  STRATOS_ORGANIZATION_ID,
  type InformationPolicyBinding,
  type IntegrationEnvelope,
  type StratosBudgetGovernanceScope,
  type StratosBudgetIntegrationEnvelope,
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

export const STRATOS_UPLOAD_TOKEN_PURPOSE = "stratos-upload";
export const STRATOS_BUDGET_UPLOAD_TOKEN_PURPOSE = "stratos-budget-upload";
export const STRATOS_BUDGET_UPLOAD_MAX_FILE_BYTES = 128 * 1024 * 1024;

export type StratosBudgetContractStatus =
  | "DRAFT"
  | "ACTIVE"
  | "AT_RISK"
  | "EXPIRED"
  | "TERMINATED";

export type StratosBudgetUploadMode = "interactive" | "historical_batch";

export interface StratosBudgetBatchLineage {
  batch_manifest_id: string;
  batch_entries_sha256: string;
  release_revision: string;
}

export interface StratosBudgetVersionLineage {
  upload_mode: StratosBudgetUploadMode;
  original_file_name: string;
  contract_status: StratosBudgetContractStatus;
  contract_start_date: string;
  contract_end_date: string;
  batch_lineage: StratosBudgetBatchLineage | null;
}

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

export type StratosBudgetGovernedDocument = ExternalDocumentResponse["document"] & {
  governed_resource_id?: string | null;
  governed_source_version?: string | null;
  governed_parent_resource_id?: string | null;
  governance_scope_type?: string | null;
  governance_scope_id?: string | null;
  governance_registration_status?: string | null;
};

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
      originator_id: string | null;
      issued_at: string | null;
      review_at: string | null;
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

export interface StratosBudgetDocumentVersionUpsertResponse {
  version: DocumentVersion;
  external_document: ExternalDocumentResponse;
  created: boolean;
  governance_confirmation: StratosBudgetGovernanceConfirmation;
}

export interface StratosBudgetGovernanceConfirmation {
  document: Record<string, unknown>;
  version: Record<string, unknown>;
}

export interface StratosBudgetExternalCurrentUpdateResponse {
  external_document: ExternalDocumentResponse;
  updated: boolean;
}

export interface StratosBudgetDocumentStatusResponse {
  document_id: string;
  updated: number;
  items: ExternalDocumentRef[];
  ingestion_attempt: RegistryIngestionAttempt | null;
}

export interface StratosBudgetUploadContract {
  tenantId: typeof STRATOS_ORGANIZATION_ID;
  externalSystem: "STRATOS_BUDGET";
  externalRef: string;
  entityType: "Contract";
  entityId: string;
  ownerSubjectId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  fileHash: string;
  informationPolicy: InformationPolicyBinding;
  governanceScope: StratosBudgetGovernanceScope;
  parentGovernedResourceId: string;
  integrationEnvelope: StratosBudgetIntegrationEnvelope;
}

export interface StratosBudgetPreflightContract extends StratosBudgetUploadContract {
  documentType: "contract";
  title: string;
  registryClassification: "public" | "internal" | "restricted";
  ownerDisplayName: string | null;
  tags: string[];
  metadata: {
    contract_id: string;
    contract_number: string;
    contract_name: string;
    financial_scope_key: string;
    contract_status: StratosBudgetContractStatus;
    contract_start_date: string;
    contract_end_date: string;
    lifecycle: "CURRENT" | "ARCHIVED";
    documentType: "CONTRACT_PDF" | "CONTRACT_ARCHIVE";
    document_type: "CONTRACT_PDF" | "CONTRACT_ARCHIVE";
    batch_manifest_id?: string;
    batch_entries_sha256?: string;
    release_revision?: string;
  };
}

export interface StratosBudgetStoredLineage {
  informationPolicy: InformationPolicyBinding;
  integrationEnvelope: StratosBudgetIntegrationEnvelope;
  governanceScope: StratosBudgetGovernanceScope;
  parentGovernedResourceId: string;
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
  ingestion_job_id: string | null;
  ingestion_status: StratosIngestionStatus;
  idempotent_replay: boolean;
  canonical_open_url: string;
  policy_binding_id: string;
  policy_version: string;
  policy_hash: string;
  governance_confirmation: AiipGovernanceConfirmation;
}

export type StratosBudgetUploadConfirmResult = Omit<
  StratosUploadConfirmResult,
  "governance_confirmation"
> & {
  file_name: string;
  file_type: string;
  file_size: number;
  document_version_status: "valid";
  governance_confirmation: StratosBudgetGovernanceConfirmation;
};

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

export const STRATOS_BUDGET_PREFLIGHT_FIELDS = [
  "tenant_id",
  "external_system",
  "external_ref",
  "entity_type",
  "entity_id",
  "document_type",
  "title",
  "classification",
  "owner_actor_id",
  "owner_display_name",
  "context_tags",
  "metadata",
  "file_name",
  "file_type",
  "file_size",
  "sha256",
  "information_policy",
  "governance_scope",
  "parent_governed_resource_id",
  "integration_envelope",
] as const;

export const STRATOS_BUDGET_CONFIRM_FIELDS = [
  "tenant_id",
  "external_system",
  "external_ref",
  "entity_type",
  "entity_id",
  "document_id",
  "external_document_id",
  "upload_session_id",
  "upload_token",
  "source_file_uri",
  "file_hash",
  "file_name",
  "file_type",
  "file_size",
  "version_label",
  "valid_from",
  "valid_to",
  "change_summary",
  "information_policy",
  "governance_scope",
  "parent_governed_resource_id",
  "integration_envelope",
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

export function getStratosBudgetUploadSettings(
  env: Record<string, string | undefined> = process.env,
): UploadSettings {
  const configuredBudgetLimit = Number(env.AKL_WEB_BUDGET_UPLOAD_MAX_FILE_BYTES);
  return {
    ...getUploadSettings(env),
    maxFileBytes:
      Number.isSafeInteger(configuredBudgetLimit) && configuredBudgetLimit > 0
        ? configuredBudgetLimit
        : STRATOS_BUDGET_UPLOAD_MAX_FILE_BYTES,
    publicUploadBasePath: withAppBasePath("/api/stratos/budget-upload/sessions")
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
  ingestionJobId: string | null;
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

export function parseStratosBudgetPreflightContract(
  body: Record<string, unknown>,
): StratosBudgetPreflightContract {
  assertBudgetExactFields(body, STRATOS_BUDGET_PREFLIGHT_FIELDS, "Budget upload preflight");
  const contract = parseStratosBudgetUploadContract(body, "sha256");
  if (
    requiredString(body, "document_type") !== "contract"
    || requiredString(body, "owner_actor_id") !== contract.ownerSubjectId
  ) {
    budgetContractError(
      "Budget upload document type and owner must match the immutable integration envelope.",
      "STRATOS_BUDGET_UPLOAD_LINEAGE_INVALID",
    );
  }
  const expectedInputClassification = contract.informationPolicy.handlingClass.toLowerCase();
  if (requiredString(body, "classification").toLowerCase() !== expectedInputClassification) {
    budgetContractError(
      "classification does not match information_policy.handlingClass.",
      "STRATOS_BUDGET_UPLOAD_POLICY_INVALID",
    );
  }
  const metadata = recordValue(body.metadata);
  if (!metadata) budgetContractError("metadata is required.");
  const requiredMetadataFields = [
    "contract_id", "contract_number", "contract_name", "financial_scope_key",
    "contract_status", "contract_start_date", "contract_end_date",
    "lifecycle", "documentType", "document_type",
  ] as const;
  const batchMetadataFields = [
    "batch_manifest_id", "batch_entries_sha256", "release_revision",
  ] as const;
  const allowedMetadataFields = [...requiredMetadataFields, ...batchMetadataFields];
  const allowedMetadataFieldSet = new Set<string>(allowedMetadataFields);
  const unknownMetadataFields = Object.keys(metadata)
    .filter((field) => !allowedMetadataFieldSet.has(field))
    .sort();
  if (
    unknownMetadataFields.length > 0
    || requiredMetadataFields.some((field) => !(field in metadata))
  ) {
    budgetContractError(
      `metadata must use only the canonical Budget fields${
        unknownMetadataFields.length ? `; unsupported: ${unknownMetadataFields.join(", ")}` : ""
      }.`,
    );
  }
  const presentBatchFields = batchMetadataFields.filter((field) => field in metadata);
  if (presentBatchFields.length !== 0 && presentBatchFields.length !== batchMetadataFields.length) {
    budgetContractError("Historical batch metadata must be supplied as one complete set.");
  }
  const contractId = requiredRecordString(metadata, "contract_id");
  const contractNumber = requiredRecordString(metadata, "contract_number");
  const contractName = requiredRecordString(metadata, "contract_name");
  const financialScopeKey = requiredRecordString(metadata, "financial_scope_key");
  const contractStatus = requiredRecordString(metadata, "contract_status");
  const contractStartDate = requiredRecordString(metadata, "contract_start_date");
  const contractEndDate = requiredRecordString(metadata, "contract_end_date");
  const lifecycle = requiredRecordString(metadata, "lifecycle");
  const documentType = requiredRecordString(metadata, "documentType");
  const documentTypeAlias = requiredRecordString(metadata, "document_type");
  if (!(["CURRENT", "ARCHIVED"] as const).includes(lifecycle as never)) {
    budgetContractError("metadata.lifecycle must be CURRENT or ARCHIVED.");
  }
  if (!(["DRAFT", "ACTIVE", "AT_RISK", "EXPIRED", "TERMINATED"] as const).includes(
    contractStatus as never,
  )) {
    budgetContractError("metadata.contract_status is invalid.");
  }
  assertIsoDate(contractStartDate, "metadata.contract_start_date");
  assertIsoDate(contractEndDate, "metadata.contract_end_date");
  if (contractStartDate > contractEndDate) {
    budgetContractError("metadata.contract_start_date must not be after contract_end_date.");
  }
  const expectedDocumentType = lifecycle === "ARCHIVED" ? "CONTRACT_ARCHIVE" : "CONTRACT_PDF";
  if (documentType !== expectedDocumentType || documentTypeAlias !== expectedDocumentType) {
    budgetContractError("metadata document type must match the contract lifecycle.");
  }
  const batchManifestId = presentBatchFields.length
    ? requiredRecordString(metadata, "batch_manifest_id")
    : null;
  const batchEntriesSha256 = presentBatchFields.length
    ? requiredRecordString(metadata, "batch_entries_sha256").toLowerCase()
    : null;
  const releaseRevision = presentBatchFields.length
    ? requiredRecordString(metadata, "release_revision").toLowerCase()
    : null;
  if (
    (batchManifestId && !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(batchManifestId))
    || (batchEntriesSha256 && !/^sha256:[a-f0-9]{64}$/.test(batchEntriesSha256))
    || (releaseRevision && !/^[a-f0-9]{40}$/.test(releaseRevision))
  ) {
    budgetContractError("Historical batch metadata is invalid.");
  }
  if (
    contractId !== contract.entityId
    || financialScopeKey !== contract.integrationEnvelope.payload.financialScopeKey
  ) {
    budgetContractError(
      "Budget upload metadata does not match the immutable integration envelope.",
      "STRATOS_BUDGET_UPLOAD_LINEAGE_INVALID",
    );
  }
  return {
    ...contract,
    documentType: "contract",
    title: requiredString(body, "title"),
    registryClassification: registryClassificationForPolicy(contract.informationPolicy),
    ownerDisplayName: strictOptionalString(body, "owner_display_name"),
    tags: strictStringList(body.context_tags, "context_tags"),
    metadata: {
      contract_id: contractId,
      contract_number: contractNumber,
      contract_name: contractName,
      financial_scope_key: financialScopeKey,
      contract_status: contractStatus as StratosBudgetContractStatus,
      contract_start_date: contractStartDate,
      contract_end_date: contractEndDate,
      lifecycle: lifecycle as "CURRENT" | "ARCHIVED",
      documentType: documentType as "CONTRACT_PDF" | "CONTRACT_ARCHIVE",
      document_type: documentTypeAlias as "CONTRACT_PDF" | "CONTRACT_ARCHIVE",
      ...(batchManifestId ? {
        batch_manifest_id: batchManifestId,
        batch_entries_sha256: batchEntriesSha256!,
        release_revision: releaseRevision!,
      } : {}),
    },
  };
}

export function parseStratosBudgetConfirmContract(
  body: Record<string, unknown>,
): StratosBudgetUploadContract {
  assertBudgetExactFields(body, STRATOS_BUDGET_CONFIRM_FIELDS, "Budget upload confirmation");
  return parseStratosBudgetUploadContract(body, "file_hash");
}

export function stratosBudgetPreflightWorkflow(
  contract: StratosBudgetPreflightContract,
  actorAuthorizationPresent: boolean,
): { mode: StratosBudgetUploadMode; context: Record<string, string> } {
  const batchLineage = budgetBatchLineage(contract.metadata);
  const contractContext = {
    original_file_name: contract.fileName,
    contract_status: contract.metadata.contract_status,
    contract_start_date: contract.metadata.contract_start_date,
    contract_end_date: contract.metadata.contract_end_date,
  };
  if (actorAuthorizationPresent) {
    if (batchLineage) {
      throw new ApiClientError(
        "Historical batch upload must use the service-only historical mode.",
        409,
        "STRATOS_BUDGET_UPLOAD_MODE_CONFLICT",
        contract.integrationEnvelope.correlationId,
      );
    }
    return { mode: "interactive", context: contractContext };
  }
  if (!batchLineage) {
    throw new ApiClientError(
      "A fresh STRATOS actor bearer is required outside a complete historical batch.",
      401,
      "STRATOS_BUDGET_ACTOR_AUTH_REQUIRED",
      contract.integrationEnvelope.correlationId,
    );
  }
  return {
    mode: "historical_batch",
    context: { ...contractContext, ...batchLineage },
  };
}

export function stratosBudgetVersionLineageFromUploadToken(
  payload: UploadTokenPayload,
): StratosBudgetVersionLineage {
  if (payload.purpose !== STRATOS_BUDGET_UPLOAD_TOKEN_PURPOSE) {
    throw new ApiClientError(
      "Upload token is not valid for the Budget document bridge.",
      401,
      "UPLOAD_TOKEN_PURPOSE_MISMATCH",
      "web-stratos-budget-bridge",
    );
  }
  const mode = payload.workflow_mode;
  if (mode !== "interactive" && mode !== "historical_batch") {
    budgetUploadTokenContextError("Signed Budget upload mode is invalid.");
  }
  const context = payload.workflow_context;
  if (!context) budgetUploadTokenContextError("Signed Budget upload context is missing.");
  const contractStatus = context.contract_status;
  const originalFileName = context.original_file_name;
  const contractStartDate = context.contract_start_date;
  const contractEndDate = context.contract_end_date;
  if (!(["DRAFT", "ACTIVE", "AT_RISK", "EXPIRED", "TERMINATED"] as const).includes(
    contractStatus as never,
  )) {
    budgetUploadTokenContextError("Signed contract status is invalid.");
  }
  if (!originalFileName || originalFileName.length > 300) {
    budgetUploadTokenContextError("Signed original filename is invalid.");
  }
  assertIsoDate(contractStartDate, "signed contract_start_date", true);
  assertIsoDate(contractEndDate, "signed contract_end_date", true);
  if (contractStartDate > contractEndDate) {
    budgetUploadTokenContextError("Signed contract period is invalid.");
  }
  const baseKeys = [
    "contract_end_date", "contract_start_date", "contract_status", "original_file_name",
  ];
  if (mode === "interactive") {
    assertExactStringKeys(context, baseKeys);
    return {
      upload_mode: mode,
      original_file_name: originalFileName,
      contract_status: contractStatus as StratosBudgetContractStatus,
      contract_start_date: contractStartDate,
      contract_end_date: contractEndDate,
      batch_lineage: null,
    };
  }
  const batchKeys = ["batch_entries_sha256", "batch_manifest_id", "release_revision"];
  assertExactStringKeys(context, [...baseKeys, ...batchKeys]);
  const batchLineage = {
    batch_manifest_id: context.batch_manifest_id,
    batch_entries_sha256: context.batch_entries_sha256,
    release_revision: context.release_revision,
  };
  if (
    !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(batchLineage.batch_manifest_id)
    || !/^sha256:[a-f0-9]{64}$/.test(batchLineage.batch_entries_sha256)
    || !/^[a-f0-9]{40}$/.test(batchLineage.release_revision)
  ) {
    budgetUploadTokenContextError("Signed historical batch lineage is invalid.");
  }
  return {
    upload_mode: mode,
    original_file_name: originalFileName,
    contract_status: contractStatus as StratosBudgetContractStatus,
    contract_start_date: contractStartDate,
    contract_end_date: contractEndDate,
    batch_lineage: batchLineage,
  };
}

export function canonicalStratosBudgetUploadContract(
  contract: StratosBudgetUploadContract,
  payload: UploadTokenPayload,
): StratosBudgetUploadContract {
  return {
    ...contract,
    fileName: payload.file_name,
    fileType: payload.file_type,
    fileSize: payload.file_size,
    fileHash: payload.sha256,
  };
}

export async function upsertStratosBudgetExternalDocument(input: {
  contract: StratosBudgetPreflightContract;
  serviceContext: ApiRequestContext;
}): Promise<ExternalDocumentResponse> {
  const config = requireProductionRegistryBridge();
  const contract = input.contract;
  return requestJson<ExternalDocumentResponse>({
    service: "registry-api",
    operation: "stratosBudgetExternalDocumentUpsert",
    baseUrl: config.serviceBaseUrls.registry,
    path: "/integrations/stratos-budget-upload/external-documents/upsert",
    method: "POST",
    context: input.serviceContext,
    body: {
      tenant_id: contract.tenantId,
      external_system: contract.externalSystem,
      external_ref: contract.externalRef,
      entity_type: contract.entityType,
      entity_id: contract.entityId,
      document_type: contract.documentType,
      title: contract.title,
      classification: contract.registryClassification,
      information_policy: contract.informationPolicy,
      integration_envelope: contract.integrationEnvelope,
      owner: {
        user_id: contract.ownerSubjectId,
        display_name: contract.ownerDisplayName,
      },
      tags: contract.tags,
      metadata: contract.metadata,
      source_location: budgetSourceLocation({
        kind: "uploaded_file",
        fileName: contract.fileName,
        fileType: contract.fileType,
        fileHash: contract.fileHash,
        externalRef: contract.externalRef,
      }),
      governance_scope: contract.governanceScope,
      parent_governed_resource_id: contract.parentGovernedResourceId,
    },
  });
}

export async function upsertStratosBudgetDocumentVersion(input: {
  documentId: string;
  contract: StratosBudgetUploadContract;
  body: Record<string, unknown>;
  sourceLocation: SourceLocationInput;
  versionLineage: StratosBudgetVersionLineage;
  serviceContext: ApiRequestContext;
}): Promise<StratosBudgetDocumentVersionUpsertResponse> {
  const config = requireProductionRegistryBridge();
  return requestJson<StratosBudgetDocumentVersionUpsertResponse>({
    service: "registry-api",
    operation: "stratosBudgetDocumentVersionUpsert",
    baseUrl: config.serviceBaseUrls.registry,
    path: `/integrations/stratos-budget-upload/documents/${encodeURIComponent(input.documentId)}/versions`,
    method: "PUT",
    context: input.serviceContext,
    body: buildStratosBudgetDocumentVersionRequest(input),
  });
}

export function buildStratosBudgetDocumentVersionRequest(input: {
  contract: StratosBudgetUploadContract;
  body: Record<string, unknown>;
  sourceLocation: SourceLocationInput;
  versionLineage: StratosBudgetVersionLineage;
}): Record<string, unknown> {
  return {
    external_ref: input.contract.externalRef,
    version_label: requiredString(input.body, "version_label"),
    valid_from: optionalString(input.body, "valid_from"),
    valid_to: optionalString(input.body, "valid_to"),
    source_file_uri: requiredString(input.body, "source_file_uri"),
    source_location: input.sourceLocation,
    file_hash: input.contract.fileHash,
    change_summary: optionalString(input.body, "change_summary"),
    upload_mode: input.versionLineage.upload_mode,
    original_file_name: input.versionLineage.original_file_name,
    batch_lineage: input.versionLineage.batch_lineage,
    contract_status: input.versionLineage.contract_status,
    contract_start_date: input.versionLineage.contract_start_date,
    contract_end_date: input.versionLineage.contract_end_date,
    information_policy: input.contract.informationPolicy,
    integration_envelope: input.contract.integrationEnvelope,
    governance_scope: input.contract.governanceScope,
    parent_governed_resource_id: input.contract.parentGovernedResourceId,
    file: {
      filename: input.contract.fileName,
      mime_type: input.contract.fileType,
      size_bytes: input.contract.fileSize,
      sha256: input.contract.fileHash,
    },
  };
}

export async function updateStratosBudgetExternalDocumentCurrent(input: {
  externalDocumentId: string;
  documentId: string;
  expectedCurrentDocumentVersionId: string | null;
  expectedCurrentIngestionJobId: string | null;
  documentVersionId: string;
  fileId: string;
  ingestionJobId: string | null;
  ingestionStatus: "VERSION_CREATED" | "INGESTING" | "INDEXED" | "FAILED";
  lineage: StratosBudgetStoredLineage;
  externalRef: string;
  serviceContext: ApiRequestContext;
}): Promise<StratosBudgetExternalCurrentUpdateResponse> {
  const config = requireProductionRegistryBridge();
  return requestJson<StratosBudgetExternalCurrentUpdateResponse>({
    service: "registry-api",
    operation: "stratosBudgetExternalDocumentCurrentUpdate",
    baseUrl: config.serviceBaseUrls.registry,
    path: `/integrations/stratos-budget-upload/external-documents/${encodeURIComponent(input.externalDocumentId)}/current`,
    method: "PATCH",
    context: input.serviceContext,
    body: {
      document_id: input.documentId,
      expected_current_document_version_id: input.expectedCurrentDocumentVersionId,
      expected_current_ingestion_job_id: input.expectedCurrentIngestionJobId,
      document_version_id: input.documentVersionId,
      file_id: input.fileId,
      ingestion_job_id: input.ingestionJobId,
      ingestion_status: input.ingestionStatus,
      external_ref: input.externalRef,
      information_policy: input.lineage.informationPolicy,
      integration_envelope: input.lineage.integrationEnvelope,
      governance_scope: input.lineage.governanceScope,
      parent_governed_resource_id: input.lineage.parentGovernedResourceId,
    },
  });
}

export async function getStratosBudgetDocumentStatus(
  documentId: string,
  serviceContext: ApiRequestContext,
): Promise<StratosBudgetDocumentStatusResponse> {
  const config = requireProductionRegistryBridge();
  return requestJson<StratosBudgetDocumentStatusResponse>({
    service: "registry-api",
    operation: "stratosBudgetDocumentStatus",
    baseUrl: config.serviceBaseUrls.registry,
    path: `/integrations/stratos-budget-upload/documents/${encodeURIComponent(documentId)}/status`,
    context: serviceContext,
  });
}

export function stratosBudgetLineageFromVersion(
  document: StratosBudgetGovernedDocument,
  version: DocumentVersion,
): StratosBudgetStoredLineage {
  const source = recordValue(version.source_location);
  const budget = recordValue(source?.stratos_budget_upload);
  if (!budget) {
    throw new ApiClientError(
      "The Budget document version does not contain immutable upload lineage.",
      409,
      "STRATOS_BUDGET_LINEAGE_MISSING",
      "web-stratos-budget-bridge",
    );
  }
  if (version.document_id !== document.document_id) {
    throw new ApiClientError(
      "The Budget document version belongs to another document.",
      409,
      "STRATOS_BUDGET_LINEAGE_INVALID",
      "web-stratos-budget-bridge",
    );
  }
  const informationPolicy = parseInformationPolicy(version.policy_summary);
  if (!equalCanonicalJson(document.policy_summary, version.policy_summary)) {
    throw new ApiClientError(
      "The Budget document and version policies differ.",
      409,
      "STRATOS_BUDGET_LINEAGE_INVALID",
      "web-stratos-budget-bridge",
    );
  }
  const governanceScope = {
    type: version.governance_scope_type,
    id: version.governance_scope_id,
  };
  if (governanceScope.type !== "budget_scope" || !governanceScope.id) {
    throw new ApiClientError(
      "The Budget document version does not contain its financial scope.",
      409,
      "STRATOS_BUDGET_LINEAGE_INVALID",
      "web-stratos-budget-bridge",
    );
  }
  const integrationEnvelope = parseStratosBudgetIntegrationEnvelope(
    budget.integration_envelope,
    informationPolicy,
    governanceScope,
  );
  const parentGovernedResourceId = document.governed_parent_resource_id;
  if (
    !parentGovernedResourceId
    || integrationEnvelope.payload.fileHash !== version.file_hash
  ) {
    throw new ApiClientError(
      "The Budget document version lineage conflicts with its parent or file hash.",
      409,
      "STRATOS_BUDGET_LINEAGE_INVALID",
      "web-stratos-budget-bridge",
    );
  }
  return {
    informationPolicy,
    integrationEnvelope,
    governanceScope: governanceScope as StratosBudgetGovernanceScope,
    parentGovernedResourceId,
  };
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

export async function getDocumentExternalReferencesCurrent(
  documentId: string,
  context: ApiRequestContext,
): Promise<ExternalDocumentRef[]> {
  const config = getAklConfig();
  const response = await requestJson<{
    document_id: string;
    updated: number;
    items: ExternalDocumentRef[];
  }>({
    service: "registry-api",
    operation: "getDocumentExternalReferencesCurrent",
    baseUrl: config.serviceBaseUrls.registry,
    path: `/documents/${encodeURIComponent(documentId)}/external-references/current`,
    context,
  });
  return response.items;
}

export async function getExactDocumentVersion(
  documentId: string,
  documentVersionId: string,
  context: ApiRequestContext,
): Promise<DocumentVersion> {
  const config = getAklConfig();
  return requestJson<DocumentVersion>({
    service: "registry-api",
    operation: "getExactDocumentVersion",
    baseUrl: config.serviceBaseUrls.registry,
    path: `/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(documentVersionId)}`,
    context,
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
  if (["pending_authorization", "claiming", "queued", "starting", "running"].includes(rawStatus)) return "INGESTING";
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
  idempotencyKey: string;
  documentId: string;
  versionId: string;
  sourceFileUri: string;
  body: Record<string, unknown>;
  expectedCurrentIngestionJobId?: string | null;
}): CreateIngestionJobRequest {
  return {
    idempotency_key: input.idempotencyKey,
    document_id: input.documentId,
    document_version_id: input.versionId,
    source_file_uri: input.sourceFileUri,
    parser_profile: (optionalString(input.body, "parser_profile") ?? "controlled_document") as CreateIngestionJobRequest["parser_profile"],
    ocr_enabled: input.body.ocr_enabled !== false,
    chunking_strategy: (optionalString(input.body, "chunking_strategy") ?? "legal_structured") as CreateIngestionJobRequest["chunking_strategy"],
    embedding_profile: optionalString(input.body, "embedding_profile") ?? "default",
    ...(input.expectedCurrentIngestionJobId !== undefined
      ? { expected_current_ingestion_job_id: input.expectedCurrentIngestionJobId }
      : {}),
  };
}

export function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseStratosBudgetUploadContract(
  body: Record<string, unknown>,
  hashField: "sha256" | "file_hash",
): StratosBudgetUploadContract {
  const informationPolicy = parseInformationPolicy(body.information_policy);
  const integrationEnvelope = parseStratosBudgetIntegrationEnvelope(
    body.integration_envelope,
    informationPolicy,
    body.governance_scope,
  );
  const governanceScope = body.governance_scope as StratosBudgetGovernanceScope;
  const fileHash = requiredString(body, hashField).toLowerCase();
  const entityId = requiredString(body, "entity_id");
  const externalRef = requiredString(body, "external_ref");
  const parentGovernedResourceId = requiredString(body, "parent_governed_resource_id");
  const fileSize = Number(body.file_size);
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
    budgetContractError("file_size must be a positive JSON integer.");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(fileHash)) {
    budgetContractError(`${hashField} must use sha256:<64 lowercase hex chars> format.`);
  }
  if (
    requiredString(body, "tenant_id") !== STRATOS_ORGANIZATION_ID
    || requiredString(body, "external_system") !== "STRATOS_BUDGET"
    || requiredString(body, "entity_type") !== "Contract"
    || externalRef !== integrationEnvelope.externalRef
    || entityId !== integrationEnvelope.payload.contractId
    || fileHash !== integrationEnvelope.payload.fileHash
  ) {
    budgetContractError(
      "Budget upload identity, file hash and immutable integration envelope must match exactly.",
      "STRATOS_BUDGET_UPLOAD_LINEAGE_INVALID",
    );
  }
  return {
    tenantId: STRATOS_ORGANIZATION_ID,
    externalSystem: "STRATOS_BUDGET",
    externalRef,
    entityType: "Contract",
    entityId,
    ownerSubjectId: integrationEnvelope.actor.subjectId,
    fileName: requiredString(body, "file_name"),
    fileType: requiredString(body, "file_type"),
    fileSize,
    fileHash,
    informationPolicy,
    governanceScope,
    parentGovernedResourceId,
    integrationEnvelope,
  };
}

function registryClassificationForPolicy(
  policy: InformationPolicyBinding,
): "public" | "internal" | "restricted" {
  if (policy.handlingClass === "PUBLIC") return "public";
  if (policy.handlingClass === "RESTRICTED") return "restricted";
  return "internal";
}

function budgetSourceLocation(input: {
  kind: "uploaded_file" | "object_storage";
  fileName: string;
  fileType: string;
  fileHash: string;
  externalRef: string;
  sourceFileUri?: string | null;
  objectKey?: string | null;
}): SourceLocationInput {
  return {
    kind: input.kind,
    uri: input.sourceFileUri ?? null,
    file_name: input.fileName,
    content_type: input.fileType,
    sha256: input.fileHash,
    storage_ref: input.objectKey ?? null,
    captured_at: new Date().toISOString(),
    repository: "Budget & Contract",
    path: input.externalRef,
    version: input.fileHash,
  };
}

export function stratosBudgetVersionSourceLocation(input: {
  contract: StratosBudgetUploadContract;
  sourceFileUri: string;
  objectKey: string;
}): SourceLocationInput {
  return budgetSourceLocation({
    kind: "object_storage",
    fileName: input.contract.fileName,
    fileType: input.contract.fileType,
    fileHash: input.contract.fileHash,
    externalRef: input.contract.externalRef,
    sourceFileUri: input.sourceFileUri,
    objectKey: input.objectKey,
  });
}

function budgetBatchLineage(
  metadata: StratosBudgetPreflightContract["metadata"],
): StratosBudgetBatchLineage | null {
  if (!metadata.batch_manifest_id) return null;
  return {
    batch_manifest_id: metadata.batch_manifest_id,
    batch_entries_sha256: metadata.batch_entries_sha256!,
    release_revision: metadata.release_revision!,
  };
}

function assertIsoDate(value: string, field: string, signedContext = false): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (signedContext) budgetUploadTokenContextError(`${field} must be an ISO date.`);
    budgetContractError(`${field} must be an ISO date.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    if (signedContext) budgetUploadTokenContextError(`${field} must be a valid ISO date.`);
    budgetContractError(`${field} must be a valid ISO date.`);
  }
}

function assertExactStringKeys(
  value: Record<string, string>,
  expectedKeys: string[],
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    budgetUploadTokenContextError("Signed Budget upload context contains unexpected fields.");
  }
}

function budgetUploadTokenContextError(message: string): never {
  throw new ApiClientError(
    message,
    409,
    "STRATOS_BUDGET_UPLOAD_CONTEXT_CONFLICT",
    "web-stratos-budget-bridge",
  );
}

function assertBudgetExactFields(
  body: Record<string, unknown>,
  allowedFields: readonly string[],
  contract: string,
): void {
  const unknownFields = Object.keys(body).filter((field) => !allowedFields.includes(field)).sort();
  if (unknownFields.length > 0) {
    budgetContractError(`${contract} contains unsupported fields: ${unknownFields.join(", ")}.`);
  }
}

function requireProductionRegistryBridge() {
  const config = getAklConfig();
  if (config.apiClientMode !== "production") {
    throw new ApiClientError(
      "STRATOS Budget document bridge requires AKL_API_CLIENT_MODE=production.",
      503,
      "STRATOS_BRIDGE_REQUIRES_REGISTRY",
      "web-stratos-budget-bridge",
    );
  }
  return config;
}

function requiredRecordString(
  record: Record<string, unknown>,
  field: string,
  code = "STRATOS_BUDGET_UPLOAD_SCHEMA_INVALID",
): string {
  const value = record[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiClientError(
      `${field} must be a non-empty string.`,
      422,
      code,
      "web-stratos-budget-bridge",
    );
  }
  return value.trim();
}

function budgetContractError(
  message: string,
  code = "STRATOS_BUDGET_UPLOAD_SCHEMA_INVALID",
): never {
  throw new ApiClientError(message, 422, code, "web-stratos-budget-bridge");
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
