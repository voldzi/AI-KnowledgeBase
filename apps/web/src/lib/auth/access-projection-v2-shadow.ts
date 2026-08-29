export const SHADOW_PROJECTION_CONTRACT = {
  schemaVersion: "stratos-access-projection-2",
  revision: "2.0.0",
  status: "shadow",
  digest: "sha256:3b11860c9b79bfb82f7792b93815f49d786667a7dd4b74f5a8ad0cb5dd6620b7",
  catalogVersion: "capabilities-1.12.0",
  organizationId: "org_stratos",
} as const;

export const AKB_SHADOW_SURFACES = [
  "registry", "search", "retrieval", "chat", "preview", "download",
  "citation", "source-open", "export", "publication",
] as const;

export type AkbShadowSurface = typeof AKB_SHADOW_SURFACES[number];
export type ProjectionScope = { type: string; id?: string };

export interface ShadowResourceDecisionInput {
  surface: AkbShadowSurface;
  capability: string;
  effectiveScope: ProjectionScope;
  ownerSubjectId?: string;
  organizationId: string;
  published: boolean;
  draft: boolean;
  audienceAllowed: boolean;
  explicitlyDenied: boolean;
  classification: "public" | "internal" | "restricted" | "confidential";
  tlp: "CLEAR" | "GREEN" | "AMBER" | "AMBER+STRICT" | "RED";
  pap: "CLEAR" | "GREEN" | "AMBER" | "RED";
  expiresAt?: string;
  informationPolicyAllowed: boolean;
}

type RecordValue = Record<string, unknown>;

export interface ShadowDecision {
  allowed: boolean;
  reason: string;
  entitlementId?: string;
}

const ROOT_KEYS = ["applicationAccess", "catalogVersion", "contractDigest", "contractRevision", "contractStatus", "expiresAt", "generatedAt", "identity", "membership", "organizationId", "schemaVersion"];
const IDENTITY_KEYS = ["active", "employeeEligible", "kind", "subjectId"];
const MEMBERSHIP_KEYS = ["active", "validUntil"];
const APPLICATION_KEYS = ["applicationId", "entitlements"];
const ENTITLEMENT_KEYS = ["capabilities", "definitionVersion", "effectiveScopes", "entitlementId", "profileId", "scopes", "source", "sourceRef", "validFrom", "validUntil", "virtual"];

export function evaluateShadowProjectionV2(
  payload: unknown,
  resource: ShadowResourceDecisionInput,
  nowMs = Date.now(),
): ShadowDecision {
  try {
    const root = exactRecord(payload, ROOT_KEYS, "projection");
    requireLiteral(root.schemaVersion, SHADOW_PROJECTION_CONTRACT.schemaVersion, "schema");
    requireLiteral(root.contractRevision, SHADOW_PROJECTION_CONTRACT.revision, "revision");
    requireLiteral(root.contractStatus, SHADOW_PROJECTION_CONTRACT.status, "status");
    requireLiteral(root.contractDigest, SHADOW_PROJECTION_CONTRACT.digest, "digest");
    requireLiteral(root.catalogVersion, SHADOW_PROJECTION_CONTRACT.catalogVersion, "catalog");
    requireLiteral(root.organizationId, SHADOW_PROJECTION_CONTRACT.organizationId, "organization");
    const generatedAt = parseDate(root.generatedAt, "generatedAt");
    const expiresAt = parseDate(root.expiresAt, "expiresAt");
    if (generatedAt > nowMs || expiresAt <= nowMs || expiresAt - generatedAt > 15 * 60_000) deny("projection-window");

    const identity = exactRecord(root.identity, IDENTITY_KEYS, "identity");
    const membership = exactRecord(root.membership, MEMBERSHIP_KEYS, "membership");
    if (identity.kind !== "person" || identity.active !== true) deny("inactive-identity");
    if (membership.active !== true) deny("inactive-membership");
    if (membership.validUntil !== null && parseDate(membership.validUntil, "membership.validUntil") <= nowMs) deny("inactive-membership");
    if (resource.organizationId !== root.organizationId) deny("foreign-organization");
    enforceInformationPolicy(resource, nowMs);

    const applications = array(root.applicationAccess, "applicationAccess").map((value) => exactRecord(value, APPLICATION_KEYS, "applicationAccess item"));
    const akb = applications.find((value) => value.applicationId === "akb");
    if (!akb) deny("no-akb-entitlement");
    const entitlements = array(akb.entitlements, "entitlements").map((value) => exactRecord(value, ENTITLEMENT_KEYS, "entitlement"));
    for (const entitlement of entitlements) {
      const validFrom = entitlement.validFrom === null ? null : parseDate(entitlement.validFrom, "validFrom");
      const validUntil = entitlement.validUntil === null ? null : parseDate(entitlement.validUntil, "validUntil");
      if ((validFrom !== null && validFrom > nowMs) || (validUntil !== null && validUntil <= nowMs)) continue;
      const capabilities = stringArray(entitlement.capabilities, "capabilities");
      const scopes = array(entitlement.effectiveScopes, "effectiveScopes").map(parseScope);
      if (capabilities.includes(resource.capability) && scopes.some((scope) => exactScope(scope, resource.effectiveScope, identity.subjectId, resource.ownerSubjectId))) {
        return { allowed: true, reason: "single-entitlement-match", entitlementId: String(entitlement.entitlementId) };
      }
    }
    return { allowed: false, reason: "single-entitlement-required" };
  } catch (error) {
    return { allowed: false, reason: error instanceof ShadowDeny ? error.reason : "invalid-projection" };
  }
}

function enforceInformationPolicy(resource: ShadowResourceDecisionInput, nowMs: number): void {
  if (resource.draft || !resource.published) deny("draft-or-unpublished");
  if (!resource.audienceAllowed) deny("narrower-audience");
  if (resource.explicitlyDenied) deny("explicit-denial");
  if (["restricted", "confidential"].includes(resource.classification)) deny("restricted-confidential");
  if (!resource.informationPolicyAllowed) deny("information-policy-deny");
  if (!(["CLEAR", "GREEN"].includes(resource.tlp) && ["CLEAR", "GREEN"].includes(resource.pap))) deny("tlp-pap");
  if (resource.expiresAt && parseDate(resource.expiresAt, "resource.expiresAt") <= nowMs) deny("expired-resource");
}

function exactScope(candidate: ProjectionScope, required: ProjectionScope, subjectId: unknown, ownerSubjectId?: string): boolean {
  if (candidate.type !== required.type || candidate.id !== required.id) return false;
  return candidate.type !== "own" || (typeof subjectId === "string" && subjectId === ownerSubjectId);
}

function parseScope(value: unknown): ProjectionScope {
  const scope = exactRecord(value, undefined, "scope");
  const expected = scope.type === "own" || scope.type === "public" ? ["type"] : ["id", "type"];
  exactKeys(scope, expected, "scope");
  if (typeof scope.type !== "string" || (scope.id !== undefined && typeof scope.id !== "string")) deny("invalid-scope");
  return scope.id === undefined ? { type: scope.type } : { type: scope.type, id: scope.id as string };
}

function exactRecord(value: unknown, keys: string[] | undefined, label: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) deny(`invalid-${label}`);
  const record = value as RecordValue;
  if (keys) exactKeys(record, keys, label);
  return record;
}

function exactKeys(record: RecordValue, expected: string[], label: string): void {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) deny(`unknown-field:${label}`);
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) deny(`invalid-${label}`);
  return value as unknown[];
}

function stringArray(value: unknown, label: string): string[] {
  const values = array(value, label);
  if (!values.every((item) => typeof item === "string") || new Set(values).size !== values.length) deny(`invalid-${label}`);
  return values as string[];
}

function parseDate(value: unknown, label: string): number {
  if (typeof value !== "string") deny(`invalid-${label}`);
  const parsed = Date.parse(value as string);
  if (Number.isNaN(parsed)) deny(`invalid-${label}`);
  return parsed;
}

function requireLiteral(value: unknown, expected: string, label: string): void {
  if (value !== expected) deny(`${label}-drift`);
}

class ShadowDeny extends Error { constructor(readonly reason: string) { super(reason); } }
function deny(reason: string): never { throw new ShadowDeny(reason); }
