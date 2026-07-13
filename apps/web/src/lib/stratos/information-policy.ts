import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { ApiClientError } from "@/lib/types";

export const INFORMATION_POLICY_VERSION = "information-policy-2.0.0";
export const INFORMATION_POLICY_SCHEMA = "stratos-information-policy-2";
export const STRATOS_ORGANIZATION_ID = "org_stratos";

const HANDLING_CLASSES = new Set(["PUBLIC", "INTERNAL", "RESTRICTED"]);
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
const SCOPE_TYPES = new Set(["organization", "organization_unit", "project", "document", "recipient_set", "public"]);

export interface InformationPolicyBinding {
  schemaVersion: typeof INFORMATION_POLICY_SCHEMA;
  policyBindingId: string;
  policyVersion: typeof INFORMATION_POLICY_VERSION;
  handlingClass: "PUBLIC" | "INTERNAL" | "RESTRICTED";
  legalClassification: "NONE";
  tlp?: "TLP:RED" | "TLP:AMBER+STRICT" | "TLP:AMBER" | "TLP:GREEN" | "TLP:CLEAR" | null;
  pap?: "PAP:RED" | "PAP:AMBER" | "PAP:GREEN" | "PAP:CLEAR" | null;
  contentCategories: string[];
  audience: {
    organizationId: typeof STRATOS_ORGANIZATION_ID;
    scopeType: "organization" | "organization_unit" | "project" | "document" | "recipient_set" | "public";
    scopeIds?: string[];
    recipientSubjectIds?: string[];
  };
  obligations: string[];
  originatorId?: string | null;
  issuedAt?: string | null;
  reviewAt?: string | null;
}

export interface IntegrationEnvelope {
  schemaVersion: "stratos-integration-envelope-1";
  organizationId: typeof STRATOS_ORGANIZATION_ID;
  sourceSystem: string;
  externalRef: string;
  actor: { type: "person" | "service"; subjectId: string };
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
  payload: Record<string, unknown>;
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
    issuedAt: optionalText(policy.issuedAt),
    reviewAt: optionalText(policy.reviewAt)
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
    "idempotencyKey", "policyBindingId", "policyVersion", "policyHash", "classification", "payload"
  ], "integration_envelope");
  requiredEqual(envelope.schemaVersion, "stratos-integration-envelope-1", "schemaVersion");
  requiredEqual(envelope.organizationId, STRATOS_ORGANIZATION_ID, "organizationId");
  requiredEqual(envelope.policyVersion, INFORMATION_POLICY_VERSION, "policyVersion");
  requiredEqual(envelope.policyBindingId, policy.policyBindingId, "policyBindingId");
  requiredEqual(envelope.policyHash, policyHash(policy), "policyHash");
  const classification = strictRecord(envelope.classification, "classification");
  requiredEqual(classification.handlingClass, policy.handlingClass, "classification.handlingClass");
  requiredEqual(classification.legalClassification, "NONE", "classification.legalClassification");
  requiredEqual(classification.tlp ?? null, policy.tlp ?? null, "classification.tlp");
  requiredEqual(classification.pap ?? null, policy.pap ?? null, "classification.pap");
  const actor = strictRecord(envelope.actor, "actor");
  const actorType = enumText(actor.type, new Set(["person", "service"]), "actor.type");
  return {
    schemaVersion: "stratos-integration-envelope-1",
    organizationId: STRATOS_ORGANIZATION_ID,
    sourceSystem: requiredText(envelope.sourceSystem, "sourceSystem"),
    externalRef: requiredText(envelope.externalRef, "externalRef"),
    actor: { type: actorType as "person" | "service", subjectId: requiredText(actor.subjectId, "actor.subjectId") },
    correlationId: minText(envelope.correlationId, "correlationId", 8),
    idempotencyKey: minText(envelope.idempotencyKey, "idempotencyKey", 8),
    policyBindingId: policy.policyBindingId,
    policyVersion: INFORMATION_POLICY_VERSION,
    policyHash: policyHash(policy),
    classification: {
      handlingClass: policy.handlingClass,
      legalClassification: "NONE",
      tlp: policy.tlp ?? null,
      pap: policy.pap ?? null
    },
    payload: strictRecord(envelope.payload, "payload")
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

function strictRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("POLICY_BINDING_INVALID", `${field} must be an object.`);
  return value as Record<string, unknown>;
}
function assertKeys(value: Record<string, unknown>, keys: string[], field: string) {
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length) fail("POLICY_BINDING_INVALID", `${field} contains unknown fields: ${unknown.join(", ")}.`);
}
function requiredText(value: unknown, field: string): string { const text = String(value ?? "").trim(); if (!text) fail("POLICY_BINDING_INVALID", `${field} is required.`); return text; }
function minText(value: unknown, field: string, length: number): string { const text = requiredText(value, field); if (text.length < length) fail("POLICY_BINDING_INVALID", `${field} is too short.`); return text; }
function optionalText(value: unknown): string | null { const text = String(value ?? "").trim(); return text || null; }
function requiredEqual(value: unknown, expected: unknown, field: string, code = "POLICY_BINDING_INVALID") { if (value !== expected) fail(code, `${field} is not supported.`); }
function enumText(value: unknown, allowed: Set<string>, field: string): string { const text = requiredText(value, field); if (!allowed.has(text)) fail("POLICY_BINDING_INVALID", `${field} is unknown.`); return text; }
function nullableEnum(value: unknown, allowed: Set<string>, field: string): string | null { if (value === null || value === undefined) return null; return enumText(value, allowed, field); }
function uniqueTextList(value: unknown, field: string): string[] { if (value === undefined) return []; if (!Array.isArray(value)) fail("POLICY_BINDING_INVALID", `${field} must be an array.`); const items = value.map((item) => requiredText(item, field)); if (new Set(items).size !== items.length) fail("POLICY_BINDING_INVALID", `${field} must be unique.`); return items; }
function uniqueEnumList(value: unknown, allowed: Set<string>, field: string, code = "POLICY_BINDING_INVALID"): string[] { const items = uniqueTextList(value, field); const unknown = items.filter((item) => !allowed.has(item)); if (unknown.length) fail(code, `${field} contains unknown values.`); return items; }
function fail(code: string, message: string): never { throw new ApiClientError(message, 422, code, "web-information-policy"); }
