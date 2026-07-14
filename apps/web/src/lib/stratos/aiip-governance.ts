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
    throw new ApiClientError(
      "Registry returned a malformed AIIP governance confirmation.",
      502,
      "AIIP_GOVERNANCE_CONFIRMATION_INVALID",
      "web-stratos-bridge",
    );
  }
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
    const own = exactRecord(record, ["type", "ownerSubjectId"]);
    return { type: "own", ownerSubjectId: text(own.ownerSubjectId) };
  }
  const scope = exactRecord(record, ["type", "id"]);
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
