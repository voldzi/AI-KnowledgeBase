import { ApiClientError } from "@/lib/types";
import type { AiipGovernanceConfirmation } from "@/lib/stratos/document-ai";

export function parseAiipGovernanceConfirmation(value: unknown): AiipGovernanceConfirmation {
  try {
    const confirmation = exactRecord(value, [
      "parent_source_resource",
      "governed_resource",
      "document_policy_binding_id",
      "document_policy_version",
      "document_policy_hash",
      "actor_subject_id",
      "correlation_id",
      "idempotency_key",
    ]);
    const parent = exactRecord(confirmation.parent_source_resource, [
      "governed_resource_id",
      "application",
      "resource_type",
      "resource_id",
      "source_version",
      "scope",
    ]);
    const governed = exactRecord(confirmation.governed_resource, [
      "id",
      "application",
      "resource_type",
      "resource_id",
      "source_version",
      "parent_id",
      "scope",
      "policy_assignment",
      "explicit_policy_binding_id",
      "inherited_from_resource_id",
      "effective_policy",
      "registered_by_subject_id",
      "confirmed_by_subject_id",
    ]);
    const effectivePolicy = exactRecord(governed.effective_policy, [
      "policy_binding_id",
      "policy_version",
      "policy_hash",
      "originator_id",
      "issued_at",
      "review_at",
    ]);
    const parentScope = parseScope(parent.scope);
    const governedScope = parseScope(governed.scope);

    if (parent.application !== "AIIP" || parent.resource_type !== "idea") throw new TypeError();
    if (governed.application !== "AKB") throw new TypeError();
    if (governed.resource_type !== "document" && governed.resource_type !== "document-version") throw new TypeError();
    if (governed.policy_assignment !== "INHERITED" || governed.explicit_policy_binding_id !== null) throw new TypeError();
    if (
      effectivePolicy.policy_version !== "information-policy-2.0.0" ||
      confirmation.document_policy_version !== "information-policy-2.0.0" ||
      confirmation.document_policy_binding_id !== effectivePolicy.policy_binding_id ||
      confirmation.document_policy_hash !== effectivePolicy.policy_hash ||
      confirmation.actor_subject_id !== governed.confirmed_by_subject_id ||
      parent.governed_resource_id !== governed.inherited_from_resource_id
    ) throw new TypeError();

    const parsed: AiipGovernanceConfirmation = {
      parent_source_resource: {
        governed_resource_id: text(parent.governed_resource_id),
        application: "AIIP",
        resource_type: "idea",
        resource_id: text(parent.resource_id),
        source_version: text(parent.source_version),
        scope: parentScope,
      },
      governed_resource: {
        id: text(governed.id),
        application: "AKB",
        resource_type: governed.resource_type,
        resource_id: text(governed.resource_id),
        source_version: text(governed.source_version),
        parent_id: text(governed.parent_id),
        scope: governedScope,
        policy_assignment: "INHERITED",
        explicit_policy_binding_id: null,
        inherited_from_resource_id: text(governed.inherited_from_resource_id),
        effective_policy: {
          policy_binding_id: text(effectivePolicy.policy_binding_id),
          policy_version: text(effectivePolicy.policy_version),
          policy_hash: sha256(effectivePolicy.policy_hash),
          originator_id: nullableText(effectivePolicy.originator_id),
          issued_at: nullableTimestamp(effectivePolicy.issued_at),
          review_at: nullableTimestamp(effectivePolicy.review_at),
        },
        registered_by_subject_id: text(governed.registered_by_subject_id),
        confirmed_by_subject_id: text(governed.confirmed_by_subject_id),
      },
      document_policy_binding_id: text(confirmation.document_policy_binding_id),
      document_policy_version: text(confirmation.document_policy_version),
      document_policy_hash: sha256(confirmation.document_policy_hash),
      actor_subject_id: text(confirmation.actor_subject_id),
      correlation_id: minText(confirmation.correlation_id, 8),
      idempotency_key: minText(confirmation.idempotency_key, 8),
    };
    return parsed;
  } catch {
    console.error(JSON.stringify({
      service: "registry-api",
      operation: "parseAiipGovernanceConfirmation",
      status: 502,
      error_code: "AIIP_GOVERNANCE_CONFIRMATION_INVALID",
      validation: governanceConfirmationDiagnostic(value),
    }));
    throw new ApiClientError(
      "Registry returned a malformed AIIP governance confirmation.",
      502,
      "AIIP_GOVERNANCE_CONFIRMATION_INVALID",
      "web-stratos-bridge",
    );
  }
}

function governanceConfirmationDiagnostic(value: unknown): Record<string, unknown> {
  const confirmation = diagnosticRecord(value);
  const parent = diagnosticRecord(confirmation?.parent_source_resource);
  const governed = diagnosticRecord(confirmation?.governed_resource);
  const effectivePolicy = diagnosticRecord(governed?.effective_policy);
  const topKeys = [
    "parent_source_resource",
    "governed_resource",
    "document_policy_binding_id",
    "document_policy_version",
    "document_policy_hash",
    "actor_subject_id",
    "correlation_id",
    "idempotency_key",
  ];
  const parentKeys = [
    "governed_resource_id",
    "application",
    "resource_type",
    "resource_id",
    "source_version",
    "scope",
  ];
  const governedKeys = [
    "id",
    "application",
    "resource_type",
    "resource_id",
    "source_version",
    "parent_id",
    "scope",
    "policy_assignment",
    "explicit_policy_binding_id",
    "inherited_from_resource_id",
    "effective_policy",
    "registered_by_subject_id",
    "confirmed_by_subject_id",
  ];
  const effectivePolicyKeys = [
    "policy_binding_id",
    "policy_version",
    "policy_hash",
    "originator_id",
    "issued_at",
    "review_at",
  ];
  return {
    shapes: {
      top: diagnosticExactKeys(confirmation, topKeys),
      parent: diagnosticExactKeys(parent, parentKeys),
      governed: diagnosticExactKeys(governed, governedKeys),
      effective_policy: diagnosticExactKeys(effectivePolicy, effectivePolicyKeys),
      parent_scope: diagnosticScope(parent?.scope),
      governed_scope: diagnosticScope(governed?.scope),
    },
    coordinates: {
      parent_application: parent?.application === "AIIP",
      parent_resource_type: parent?.resource_type === "idea",
      governed_application: governed?.application === "AKB",
      governed_resource_type:
        governed?.resource_type === "document" || governed?.resource_type === "document-version",
      policy_assignment: governed?.policy_assignment === "INHERITED",
      explicit_policy_binding: governed?.explicit_policy_binding_id === null,
      policy_version: effectivePolicy?.policy_version === "information-policy-2.0.0",
      document_policy_version: confirmation?.document_policy_version === "information-policy-2.0.0",
    },
    relations: {
      binding: confirmation?.document_policy_binding_id === effectivePolicy?.policy_binding_id,
      hash: confirmation?.document_policy_hash === effectivePolicy?.policy_hash,
      actor: confirmation?.actor_subject_id === governed?.confirmed_by_subject_id,
      inheritance: parent?.governed_resource_id === governed?.inherited_from_resource_id,
    },
    values: {
      document_hash: diagnosticSha256(confirmation?.document_policy_hash),
      effective_hash: diagnosticSha256(effectivePolicy?.policy_hash),
      originator: diagnosticNullableText(effectivePolicy?.originator_id),
      issued_at: diagnosticNullableTimestamp(effectivePolicy?.issued_at),
      review_at: diagnosticNullableTimestamp(effectivePolicy?.review_at),
      correlation_id: diagnosticMinText(confirmation?.correlation_id, 8),
      idempotency_key: diagnosticMinText(confirmation?.idempotency_key, 8),
      required_text: [
        parent?.governed_resource_id,
        parent?.resource_id,
        parent?.source_version,
        governed?.id,
        governed?.resource_id,
        governed?.source_version,
        governed?.parent_id,
        governed?.inherited_from_resource_id,
        governed?.registered_by_subject_id,
        governed?.confirmed_by_subject_id,
        effectivePolicy?.policy_binding_id,
        confirmation?.document_policy_binding_id,
        confirmation?.actor_subject_id,
      ].every(diagnosticText),
    },
  };
}

function diagnosticRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function diagnosticExactKeys(value: Record<string, unknown> | null, expected: string[]): boolean {
  if (!value) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function diagnosticText(value: unknown): boolean {
  return typeof value === "string" && Boolean(value.trim());
}

function diagnosticNullableText(value: unknown): boolean {
  return value === null || diagnosticText(value);
}

function diagnosticMinText(value: unknown, length: number): boolean {
  return diagnosticText(value) && (value as string).length >= length;
}

function diagnosticSha256(value: unknown): boolean {
  return diagnosticText(value) && /^sha256:[a-f0-9]{64}$/i.test(value as string);
}

function diagnosticNullableTimestamp(value: unknown): boolean {
  if (value === null) return true;
  if (!diagnosticText(value) || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value as string)) return false;
  return Number.isFinite(Date.parse(value as string));
}

function diagnosticScope(value: unknown): boolean {
  const scope = diagnosticRecord(value);
  if (!scope) return false;
  if (scope.type === "own") {
    const exact = Object.hasOwn(scope, "id")
      ? diagnosticExactKeys(scope, ["type", "id", "ownerSubjectId"]) && scope.id === null
      : diagnosticExactKeys(scope, ["type", "ownerSubjectId"]);
    return exact && diagnosticText(scope.ownerSubjectId);
  }
  const exact = Object.hasOwn(scope, "ownerSubjectId")
    ? diagnosticExactKeys(scope, ["type", "id", "ownerSubjectId"]) && scope.ownerSubjectId === null
    : diagnosticExactKeys(scope, ["type", "id"]);
  return exact && diagnosticText(scope.id);
}

export function equalAiipGovernanceConfirmation(left: unknown, right: unknown): boolean {
  return equalCanonicalJson(left, right);
}

export function equalCanonicalJson(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(canonicalJsonValue(left)) === JSON.stringify(canonicalJsonValue(right));
  } catch {
    return false;
  }
}

function parseScope(value: unknown): AiipGovernanceConfirmation["governed_resource"]["scope"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError();
  const record = value as Record<string, unknown>;
  if (record.type === "own") {
    const own = Object.hasOwn(record, "id")
      ? exactRecord(record, ["type", "id", "ownerSubjectId"])
      : exactRecord(record, ["type", "ownerSubjectId"]);
    if (Object.hasOwn(own, "id") && own.id !== null) throw new TypeError();
    return { type: "own", ownerSubjectId: text(own.ownerSubjectId) };
  }
  const scope = Object.hasOwn(record, "ownerSubjectId")
    ? exactRecord(record, ["type", "id", "ownerSubjectId"])
    : exactRecord(record, ["type", "id"]);
  if (Object.hasOwn(scope, "ownerSubjectId") && scope.ownerSubjectId !== null) throw new TypeError();
  if (![
    "organization",
    "organization_unit",
    "budget_scope",
    "portfolio",
    "project",
    "document",
    "recipient_set",
  ].includes(String(scope.type))) throw new TypeError();
  if (scope.type === "organization" && scope.id !== "org_stratos") throw new TypeError();
  return {
    type: scope.type as Exclude<AiipGovernanceConfirmation["governed_resource"]["scope"]["type"], "own">,
    id: text(scope.id),
  };
}

function exactRecord(value: unknown, allowedKeys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError();
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== allowedKeys.length || keys.some((key) => !allowedKeys.includes(key))) throw new TypeError();
  return record;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError();
  return value;
}

function nullableText(value: unknown): string | null {
  if (value === null) return null;
  return text(value);
}

function nullableTimestamp(value: unknown): string | null {
  if (value === null) return null;
  const normalized = text(value);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) throw new TypeError();
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds)) throw new TypeError();
  return new Date(milliseconds).toISOString();
}

function minText(value: unknown, length: number): string {
  const normalized = text(value);
  if (normalized.length < length) throw new TypeError();
  return normalized;
}

function sha256(value: unknown): string {
  const normalized = text(value).toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized)) throw new TypeError();
  return normalized;
}

function canonicalJsonValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Governance confirmation is not JSON-safe.");
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalJsonValue);
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalJsonValue(record[key])])
    );
  }
  throw new TypeError("Governance confirmation contains a non-JSON value.");
}
