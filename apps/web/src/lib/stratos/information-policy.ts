import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { ApiClientError } from "@/lib/types";

export const INFORMATION_POLICY_VERSION = "information-policy-2.0.0";
export const INFORMATION_POLICY_SCHEMA = "stratos-information-policy-2";
export const STRATOS_ORGANIZATION_ID = "org_stratos";

const HANDLING_CLASSES = new Set(["PUBLIC", "INTERNAL", "PROJECT_MANAGEMENT", "RESTRICTED"]);
const TLP_VALUES = new Set(["TLP:RED", "TLP:AMBER+STRICT", "TLP:AMBER", "TLP:GREEN", "TLP:CLEAR"]);
const PAP_VALUES = new Set(["PAP:RED", "PAP:AMBER", "PAP:GREEN", "PAP:CLEAR"]);
const CONTENT_CATEGORIES = new Set([
  "PERSONAL_DATA", "FINANCIAL", "CONTRACTUAL", "SECURITY", "CYBER_THREAT",
  "SOURCE_CODE", "AUTHENTICATION", "AUDIT", "PUBLIC_INFORMATION"
]);
const OBLIGATIONS = new Set([
  "AUDIT_ACCESS", "NO_EXTERNAL_AI", "LOCAL_PROCESSING_ONLY", "NO_PUBLIC_EXPORT",
  "NO_EXPORT", "WATERMARK", "ENCRYPT_AT_REST", "RECIPIENT_CONFIRMATION",
  "ORIGINATOR_APPROVAL", "PAP_ENFORCEMENT"
]);
const SCOPE_TYPES = new Set(["organization", "organization_unit", "budget_scope", "project", "document", "recipient_set", "public"]);

export interface InformationPolicyBinding {
  schemaVersion: typeof INFORMATION_POLICY_SCHEMA;
  policyBindingId: string;
  policyVersion: typeof INFORMATION_POLICY_VERSION;
  handlingClass: "PUBLIC" | "INTERNAL" | "PROJECT_MANAGEMENT" | "RESTRICTED";
  legalClassification: "NONE";
  tlp?: "TLP:RED" | "TLP:AMBER+STRICT" | "TLP:AMBER" | "TLP:GREEN" | "TLP:CLEAR" | null;
  pap?: "PAP:RED" | "PAP:AMBER" | "PAP:GREEN" | "PAP:CLEAR" | null;
  contentCategories: string[];
  audience: {
    organizationId: typeof STRATOS_ORGANIZATION_ID;
    scopeType: "organization" | "organization_unit" | "budget_scope" | "project" | "document" | "recipient_set" | "public";
    scopeIds?: string[];
    recipientSubjectIds?: string[];
  };
  obligations: string[];
  originatorId?: string | null;
  issuedAt: string;
  reviewAt?: string | null;
}

export interface IntegrationEnvelope {
  schemaVersion: "stratos-integration-envelope-1";
  organizationId: typeof STRATOS_ORGANIZATION_ID;
  sourceSystem: "STRATOS_AIIP";
  externalRef: string;
  actor: { type: "person"; subjectId: string };
  sourceResource: {
    governedResourceId: string;
    application: "AIIP";
    resourceType: "idea";
    resourceId: string;
    sourceVersion: string;
    scope:
      | { type: "own"; ownerSubjectId: string }
      | {
          type: "organization" | "organization_unit" | "budget_scope" | "portfolio" | "project" | "document" | "recipient_set";
          id: string;
        };
  };
  correlationId: string;
  idempotencyKey: string;
  policyBindingId: string;
  policyVersion: typeof INFORMATION_POLICY_VERSION;
  policyHash: string;
  classification: {
    handlingClass: string;
    legalClassification: "NONE";
    tlp: string | null;
    pap: string | null;
  };
  payload: {
    operation: "document_upload";
    entityType: "InnovationRequest" | "InnovationRequestImport";
    entityId: string;
    sourceDocumentId: string;
    sha256: string;
  };
}

export interface StratosBudgetGovernanceScope {
  type: "budget_scope";
  id: string;
}

export interface StratosBudgetIntegrationEnvelope {
  schemaVersion: "stratos-integration-envelope-1";
  organizationId: typeof STRATOS_ORGANIZATION_ID;
  sourceSystem: "STRATOS_BUDGET";
  externalRef: string;
  actor: { type: "person"; subjectId: string };
  correlationId: string;
  idempotencyKey: string;
  policyBindingId: string;
  policyVersion: typeof INFORMATION_POLICY_VERSION;
  policyHash: string;
  classification: {
    handlingClass: string;
    legalClassification: "NONE";
    tlp: string | null;
    pap: string | null;
  };
  payload: {
    contractId: string;
    financialScopeKey: string;
    fileHash: string;
  };
}

export function parseInformationPolicy(value: unknown): InformationPolicyBinding {
  const policy = strictRecord(value, "information_policy");
  assertKeys(policy, [
    "schemaVersion", "policyBindingId", "policyVersion", "handlingClass", "legalClassification",
    "tlp", "pap", "contentCategories", "audience", "obligations", "originatorId", "issuedAt", "reviewAt"
  ], "information_policy");
  requiredEqual(policy.schemaVersion, INFORMATION_POLICY_SCHEMA, "schemaVersion");
  requiredEqual(policy.policyVersion, INFORMATION_POLICY_VERSION, "policyVersion");
  requiredEqual(policy.legalClassification, "NONE", "legalClassification", "LEGAL_CLASSIFICATION_UNSUPPORTED");
  const policyBindingId = requiredText(policy.policyBindingId, "policyBindingId");
  if (!/^(?:pol|pb)_[A-Za-z0-9_-]{8,}$/.test(policyBindingId)) fail("POLICY_BINDING_INVALID", "policyBindingId is invalid.");
  const handlingClass = enumText(policy.handlingClass, HANDLING_CLASSES, "handlingClass");
  const tlp = nullableEnum(policy.tlp, TLP_VALUES, "tlp");
  const pap = nullableEnum(policy.pap, PAP_VALUES, "pap");
  const contentCategories = uniqueEnumList(policy.contentCategories, CONTENT_CATEGORIES, "contentCategories");
  const obligations = uniqueEnumList(policy.obligations, OBLIGATIONS, "obligations", "POLICY_OBLIGATION_UNKNOWN");
  const audience = strictRecord(policy.audience, "audience");
  assertKeys(audience, ["organizationId", "scopeType", "scopeIds", "recipientSubjectIds"], "audience");
  requiredEqual(audience.organizationId, STRATOS_ORGANIZATION_ID, "audience.organizationId");
  const scopeType = enumText(audience.scopeType, SCOPE_TYPES, "audience.scopeType");
  const scopeIds = uniqueTextList(audience.scopeIds, "audience.scopeIds");
  const recipientSubjectIds = uniqueTextList(audience.recipientSubjectIds, "audience.recipientSubjectIds");
  const originatorId = optionalText(policy.originatorId);
  if (tlp === "TLP:RED" && (scopeType !== "recipient_set" || recipientSubjectIds.length === 0 || !originatorId)) {
    fail("POLICY_BINDING_INVALID", "TLP:RED requires recipient_set, explicit recipients and originatorId.");
  }
  return {
    schemaVersion: INFORMATION_POLICY_SCHEMA,
    policyBindingId,
    policyVersion: INFORMATION_POLICY_VERSION,
    handlingClass: handlingClass as InformationPolicyBinding["handlingClass"],
    legalClassification: "NONE",
    tlp: tlp as InformationPolicyBinding["tlp"],
    pap: pap as InformationPolicyBinding["pap"],
    contentCategories,
    audience: {
      organizationId: STRATOS_ORGANIZATION_ID,
      scopeType: scopeType as InformationPolicyBinding["audience"]["scopeType"],
      scopeIds,
      recipientSubjectIds
    },
    obligations,
    originatorId,
    issuedAt: requiredTimestamp(policy.issuedAt, "issuedAt"),
    reviewAt: optionalTimestamp(policy.reviewAt, "reviewAt")
  };
}

export function policyHash(policy: InformationPolicyBinding): string {
  return `sha256:${createHash("sha256").update(canonicalJson({
    policyBindingId: policy.policyBindingId,
    policyVersion: policy.policyVersion,
    handlingClass: policy.handlingClass,
    legalClassification: policy.legalClassification,
    tlp: policy.tlp,
    pap: policy.pap,
    obligations: policy.obligations,
    contentCategories: policy.contentCategories,
    audience: policy.audience,
  })).digest("hex")}`;
}

export function createDefaultInformationPolicy(input: {
  classification: "public" | "internal" | "restricted" | "confidential";
  ownerSubjectId: string;
  contentCategories?: string[];
}): InformationPolicyBinding {
  if (input.classification === "confidential") {
    fail("LEGAL_CLASSIFICATION_UNSUPPORTED", "The legacy confidential classification is not supported in Policy V2.");
  }
  const handlingClass = input.classification.toUpperCase() as "PUBLIC" | "INTERNAL" | "RESTRICTED";
  return parseInformationPolicy({
    schemaVersion: INFORMATION_POLICY_SCHEMA,
    policyBindingId: `pol_${randomUUID().replaceAll("-", "")}`,
    policyVersion: INFORMATION_POLICY_VERSION,
    handlingClass,
    legalClassification: "NONE",
    tlp: null,
    pap: null,
    contentCategories: input.contentCategories ?? [],
    audience: {
      organizationId: STRATOS_ORGANIZATION_ID,
      scopeType: "organization",
      scopeIds: [],
      recipientSubjectIds: []
    },
    obligations: handlingClass === "PUBLIC" ? [] : ["AUDIT_ACCESS"],
    originatorId: input.ownerSubjectId,
    issuedAt: new Date().toISOString(),
    reviewAt: null
  });
}

export function parseIntegrationEnvelope(value: unknown, policy: InformationPolicyBinding): IntegrationEnvelope | null {
  if (value === undefined || value === null) return null;
  const envelope = strictRecord(value, "integration_envelope");
  assertKeys(envelope, [
    "schemaVersion", "organizationId", "sourceSystem", "externalRef", "actor", "correlationId",
    "idempotencyKey", "policyBindingId", "policyVersion", "policyHash", "classification", "payload",
    "sourceResource"
  ], "integration_envelope");
  requiredEqual(envelope.schemaVersion, "stratos-integration-envelope-1", "schemaVersion");
  requiredEqual(envelope.organizationId, STRATOS_ORGANIZATION_ID, "organizationId");
  requiredEqual(envelope.sourceSystem, "STRATOS_AIIP", "sourceSystem");
  requiredEqual(envelope.policyVersion, INFORMATION_POLICY_VERSION, "policyVersion");
  requiredEqual(envelope.policyBindingId, policy.policyBindingId, "policyBindingId");
  const authoritativePolicyHash = requiredText(envelope.policyHash, "policyHash").toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(authoritativePolicyHash)) {
    fail("POLICY_BINDING_INVALID", "policyHash must be a Registry-issued SHA-256 digest.");
  }
  const classification = strictRecord(envelope.classification, "classification");
  assertKeys(classification, ["handlingClass", "legalClassification", "tlp", "pap"], "classification");
  requiredEqual(classification.handlingClass, policy.handlingClass, "classification.handlingClass");
  requiredEqual(classification.legalClassification, "NONE", "classification.legalClassification");
  requiredEqual(classification.tlp ?? null, policy.tlp ?? null, "classification.tlp");
  requiredEqual(classification.pap ?? null, policy.pap ?? null, "classification.pap");
  const actor = strictRecord(envelope.actor, "actor");
  assertKeys(actor, ["type", "subjectId"], "actor");
  requiredEqual(actor.type, "person", "actor.type");
  const sourceResource = strictRecord(envelope.sourceResource, "sourceResource");
  assertKeys(sourceResource, [
    "governedResourceId", "application", "resourceType", "resourceId", "sourceVersion", "scope"
  ], "sourceResource");
  requiredEqual(sourceResource.application, "AIIP", "sourceResource.application");
  requiredEqual(sourceResource.resourceType, "idea", "sourceResource.resourceType");
  const sourceScope = strictRecord(sourceResource.scope, "sourceResource.scope");
  assertKeys(sourceScope, ["type", "id", "ownerSubjectId"], "sourceResource.scope");
  const sourceScopeType = enumText(
    sourceScope.type,
    new Set(["own", "organization", "organization_unit", "budget_scope", "portfolio", "project", "document", "recipient_set"]),
    "sourceResource.scope.type"
  ) as IntegrationEnvelope["sourceResource"]["scope"]["type"];
  const normalizedSourceScope = sourceScopeType === "own"
    ? (() => {
        if (sourceScope.id !== undefined) fail("POLICY_BINDING_INVALID", "An own source scope forbids id.");
        return { type: "own" as const, ownerSubjectId: requiredText(sourceScope.ownerSubjectId, "sourceResource.scope.ownerSubjectId") };
      })()
    : (() => {
        if (sourceScope.ownerSubjectId !== undefined) fail("POLICY_BINDING_INVALID", "ownerSubjectId is valid only for an own source scope.");
        const id = requiredText(sourceScope.id, "sourceResource.scope.id");
        if (sourceScopeType === "organization" && id !== STRATOS_ORGANIZATION_ID) {
          fail("POLICY_BINDING_INVALID", "The organization source scope must identify org_stratos.");
        }
        return { type: sourceScopeType, id };
      })();
  const payload = strictRecord(envelope.payload, "payload");
  assertKeys(payload, ["operation", "entityType", "entityId", "sourceDocumentId", "sha256"], "payload");
  requiredEqual(payload.operation, "document_upload", "payload.operation");
  const entityType = enumText(
    payload.entityType,
    new Set(["InnovationRequest", "InnovationRequestImport"]),
    "payload.entityType"
  ) as IntegrationEnvelope["payload"]["entityType"];
  const payloadSha256 = requiredText(payload.sha256, "payload.sha256").toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(payloadSha256)) {
    fail("POLICY_BINDING_INVALID", "payload.sha256 must use sha256:<64 lowercase hex chars> format.");
  }
  return {
    schemaVersion: "stratos-integration-envelope-1",
    organizationId: STRATOS_ORGANIZATION_ID,
    sourceSystem: "STRATOS_AIIP",
    externalRef: requiredText(envelope.externalRef, "externalRef"),
    actor: { type: "person", subjectId: requiredText(actor.subjectId, "actor.subjectId") },
    sourceResource: {
      governedResourceId: requiredText(sourceResource.governedResourceId, "sourceResource.governedResourceId"),
      application: "AIIP",
      resourceType: "idea",
      resourceId: requiredText(sourceResource.resourceId, "sourceResource.resourceId"),
      sourceVersion: requiredText(sourceResource.sourceVersion, "sourceResource.sourceVersion"),
      scope: normalizedSourceScope
    },
    correlationId: minText(envelope.correlationId, "correlationId", 8),
    idempotencyKey: minText(envelope.idempotencyKey, "idempotencyKey", 8),
    policyBindingId: policy.policyBindingId,
    policyVersion: INFORMATION_POLICY_VERSION,
    policyHash: authoritativePolicyHash,
    classification: {
      handlingClass: policy.handlingClass,
      legalClassification: "NONE",
      tlp: policy.tlp ?? null,
      pap: policy.pap ?? null
    },
    payload: {
      operation: "document_upload",
      entityType,
      entityId: requiredText(payload.entityId, "payload.entityId"),
      sourceDocumentId: requiredText(payload.sourceDocumentId, "payload.sourceDocumentId"),
      sha256: payloadSha256
    }
  };
}

export function parseStratosBudgetIntegrationEnvelope(
  value: unknown,
  policy: InformationPolicyBinding,
  governanceScopeValue: unknown,
): StratosBudgetIntegrationEnvelope {
  const envelope = strictRecord(value, "integration_envelope");
  assertKeys(envelope, [
    "schemaVersion", "organizationId", "sourceSystem", "externalRef", "actor", "correlationId",
    "idempotencyKey", "policyBindingId", "policyVersion", "policyHash", "classification", "payload"
  ], "integration_envelope");
  requiredEqual(envelope.schemaVersion, "stratos-integration-envelope-1", "schemaVersion");
  requiredEqual(envelope.organizationId, STRATOS_ORGANIZATION_ID, "organizationId");
  requiredEqual(envelope.sourceSystem, "STRATOS_BUDGET", "sourceSystem");
  requiredEqual(envelope.policyVersion, INFORMATION_POLICY_VERSION, "policyVersion");
  requiredEqual(envelope.policyBindingId, policy.policyBindingId, "policyBindingId");

  const authoritativePolicyHash = requiredText(envelope.policyHash, "policyHash").toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(authoritativePolicyHash)) {
    fail("POLICY_BINDING_INVALID", "policyHash must be a canonical SHA-256 digest.");
  }
  requiredEqual(authoritativePolicyHash, policyHash(policy), "policyHash");

  const classification = strictRecord(envelope.classification, "classification");
  assertKeys(classification, ["handlingClass", "legalClassification", "tlp", "pap"], "classification");
  requiredEqual(classification.handlingClass, policy.handlingClass, "classification.handlingClass");
  requiredEqual(classification.legalClassification, "NONE", "classification.legalClassification");
  requiredEqual(classification.tlp ?? null, policy.tlp ?? null, "classification.tlp");
  requiredEqual(classification.pap ?? null, policy.pap ?? null, "classification.pap");

  const actor = strictRecord(envelope.actor, "actor");
  assertKeys(actor, ["type", "subjectId"], "actor");
  requiredEqual(actor.type, "person", "actor.type");
  const actorSubjectId = requiredText(actor.subjectId, "actor.subjectId");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,127}$/.test(actorSubjectId)) {
    fail("POLICY_BINDING_INVALID", "actor.subjectId is invalid.");
  }

  const payload = strictRecord(envelope.payload, "payload");
  assertKeys(payload, ["contractId", "financialScopeKey", "fileHash"], "payload");
  const contractId = requiredText(payload.contractId, "payload.contractId");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(contractId)) {
    fail("POLICY_BINDING_INVALID", "payload.contractId is invalid.");
  }
  const financialScopeKey = requiredText(payload.financialScopeKey, "payload.financialScopeKey");
  if (!/^(?:budget-global|budget:[a-z0-9][a-z0-9._-]{0,119})$/.test(financialScopeKey)) {
    fail("POLICY_BINDING_INVALID", "payload.financialScopeKey must identify a canonical budget scope.");
  }
  const fileHash = requiredText(payload.fileHash, "payload.fileHash").toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(fileHash)) {
    fail("POLICY_BINDING_INVALID", "payload.fileHash must use sha256:<64 lowercase hex chars> format.");
  }

  const externalRef = requiredText(envelope.externalRef, "externalRef");
  const contractExternalRef = `contract:${contractId}`;
  if (
    externalRef !== contractExternalRef
    && !new RegExp(`^${escapeRegex(contractExternalRef)}:document:[a-z0-9][a-z0-9._-]{0,127}$`).test(externalRef)
  ) {
    fail("POLICY_BINDING_INVALID", "externalRef must identify the Budget contract document.");
  }

  const governanceScope = strictRecord(governanceScopeValue, "governance_scope");
  assertKeys(governanceScope, ["type", "id"], "governance_scope");
  requiredEqual(governanceScope.type, "budget_scope", "governance_scope.type");
  requiredEqual(governanceScope.id, financialScopeKey, "governance_scope.id");

  return {
    schemaVersion: "stratos-integration-envelope-1",
    organizationId: STRATOS_ORGANIZATION_ID,
    sourceSystem: "STRATOS_BUDGET",
    externalRef,
    actor: { type: "person", subjectId: actorSubjectId },
    correlationId: minText(envelope.correlationId, "correlationId", 8),
    idempotencyKey: minText(envelope.idempotencyKey, "idempotencyKey", 8),
    policyBindingId: policy.policyBindingId,
    policyVersion: INFORMATION_POLICY_VERSION,
    policyHash: authoritativePolicyHash,
    classification: {
      handlingClass: policy.handlingClass,
      legalClassification: "NONE",
      tlp: policy.tlp ?? null,
      pap: policy.pap ?? null
    },
    payload: { contractId, financialScopeKey, fileHash }
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function strictRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("POLICY_BINDING_INVALID", `${field} must be an object.`);
  return value as Record<string, unknown>;
}
function assertKeys(value: Record<string, unknown>, keys: string[], field: string) {
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length) fail("POLICY_BINDING_INVALID", `${field} contains unknown fields: ${unknown.join(", ")}.`);
}
function requiredText(value: unknown, field: string): string { if (typeof value !== "string" || !value.trim()) fail("POLICY_BINDING_INVALID", `${field} must be a non-empty string.`); return value.trim(); }
function minText(value: unknown, field: string, length: number): string { const text = requiredText(value, field); if (text.length < length) fail("POLICY_BINDING_INVALID", `${field} is too short.`); return text; }
function optionalText(value: unknown): string | null { if (value === null || value === undefined) return null; if (typeof value !== "string" || !value.trim()) fail("POLICY_BINDING_INVALID", "Optional policy text must be a non-empty string or null."); return value.trim(); }
function optionalTimestamp(value: unknown, field: string): string | null {
  const normalized = optionalText(value);
  if (normalized === null) return null;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) {
    fail("POLICY_BINDING_INVALID", `${field} must include an explicit timezone.`);
  }
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds)) fail("POLICY_BINDING_INVALID", `${field} must be an ISO-8601 timestamp.`);
  return new Date(milliseconds).toISOString();
}
function requiredTimestamp(value: unknown, field: string): string {
  const normalized = optionalTimestamp(value, field);
  if (normalized === null) fail("POLICY_BINDING_INVALID", `${field} is required.`);
  return normalized;
}
function requiredEqual(value: unknown, expected: unknown, field: string, code = "POLICY_BINDING_INVALID") { if (value !== expected) fail(code, `${field} is not supported.`); }
function enumText(value: unknown, allowed: Set<string>, field: string): string { const text = requiredText(value, field); if (!allowed.has(text)) fail("POLICY_BINDING_INVALID", `${field} is unknown.`); return text; }
function nullableEnum(value: unknown, allowed: Set<string>, field: string): string | null { if (value === null || value === undefined) return null; return enumText(value, allowed, field); }
function uniqueTextList(value: unknown, field: string): string[] { if (value === undefined) return []; if (!Array.isArray(value)) fail("POLICY_BINDING_INVALID", `${field} must be an array.`); const items = value.map((item) => requiredText(item, field)); if (new Set(items).size !== items.length) fail("POLICY_BINDING_INVALID", `${field} must be unique.`); return items; }
function uniqueEnumList(value: unknown, allowed: Set<string>, field: string, code = "POLICY_BINDING_INVALID"): string[] { const items = uniqueTextList(value, field); const unknown = items.filter((item) => !allowed.has(item)); if (unknown.length) fail(code, `${field} contains unknown values.`); return items; }
function fail(code: string, message: string): never { throw new ApiClientError(message, 422, code, "web-information-policy"); }
