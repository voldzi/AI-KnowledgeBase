export const SHADOW_PROJECTION_CONTRACT = {
  schemaVersion: "stratos-access-projection-2",
  revision: "2.0.0",
  status: "shadow",
  digest: "sha256:3b11860c9b79bfb82f7792b93815f49d786667a7dd4b74f5a8ad0cb5dd6620b7",
  catalogVersion: "capabilities-1.12.0",
  organizationId: "org_stratos",
} as const;

export const ACTIVE_PROJECTION_CONTRACT = {
  schemaVersion: "stratos-access-projection-2",
  revision: "2.1.0",
  status: "active",
  digest: "sha256:16509ccbdc3e49e7a9918a29c833a8ae1aa7c78777b0a8693a2477acc2f0dafa",
  catalogVersion: "capabilities-1.12.2",
  organizationId: "org_stratos",
  consumerCutover: true,
} as const;

export const AKB_SHADOW_SURFACES = [
  "registry", "search", "retrieval", "chat", "preview", "download",
  "citation", "source-open", "export", "publication",
] as const;

export type AkbShadowSurface = typeof AKB_SHADOW_SURFACES[number];
export type ProjectionScope = { type: string; id?: string };

export interface ActiveProjectionEntitlement {
  entitlementId: string;
  definitionVersion: string;
  profileId: string | null;
  source: "MANUAL" | "KEYCLOAK_GROUP" | "OIDC" | "SYSTEM";
  sourceRef: string | null;
  virtual: boolean;
  capabilities: string[];
  scopes: ProjectionScope[];
  effectiveScopes: ProjectionScope[];
  validFrom: string | null;
  validUntil: string | null;
}

export interface ActiveProjectionV2 {
  subjectId: string;
  identityKind: "person" | "service";
  identityActive: boolean;
  employeeEligible: boolean;
  membershipActive: boolean;
  membershipValidUntil: string | null;
  organizationId: "org_stratos";
  generatedAt: string;
  expiresAt: string;
  applicationAccess: Array<{
    applicationId: string;
    entitlements: ActiveProjectionEntitlement[];
  }>;
}

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
const APPLICATION_IDS = new Set(["executive-center", "budget", "projectflow", "archflow", "akb"]);
const SOURCES = new Set(["MANUAL", "KEYCLOAK_GROUP", "OIDC", "SYSTEM"]);
const SCOPE_TYPES = new Set(["own", "public", "organization", "organization_unit", "budget_scope", "portfolio", "project", "document", "recipient_set"]);
const CAPABILITY_PATTERN = /^[a-z][a-z0-9-]*:[a-z][a-z0-9_.-]*$/;

export function parseActiveProjectionV2(payload: unknown, nowMs = Date.now()): ActiveProjectionV2 {
  const root = exactRecord(payload, ROOT_KEYS, "projection");
  requireLiteral(root.schemaVersion, ACTIVE_PROJECTION_CONTRACT.schemaVersion, "schema");
  requireLiteral(root.contractRevision, ACTIVE_PROJECTION_CONTRACT.revision, "revision");
  requireLiteral(root.contractStatus, ACTIVE_PROJECTION_CONTRACT.status, "status");
  requireLiteral(root.contractDigest, ACTIVE_PROJECTION_CONTRACT.digest, "digest");
  requireLiteral(root.catalogVersion, ACTIVE_PROJECTION_CONTRACT.catalogVersion, "catalog");
  requireLiteral(root.organizationId, ACTIVE_PROJECTION_CONTRACT.organizationId, "organization");
  const generatedAt = parseDate(root.generatedAt, "generatedAt");
  const expiresAt = parseDate(root.expiresAt, "expiresAt");
  if (generatedAt > nowMs || expiresAt <= nowMs || expiresAt <= generatedAt || expiresAt - generatedAt > 15 * 60_000) {
    deny("projection-window");
  }
  const identity = exactRecord(root.identity, IDENTITY_KEYS, "identity");
  if (typeof identity.subjectId !== "string" || identity.subjectId.length < 1 || identity.subjectId.length > 200
    || !["person", "service"].includes(String(identity.kind))
    || typeof identity.active !== "boolean" || typeof identity.employeeEligible !== "boolean") {
    deny("invalid-identity");
  }
  const membership = exactRecord(root.membership, MEMBERSHIP_KEYS, "membership");
  if (typeof membership.active !== "boolean" || (membership.validUntil !== null && typeof membership.validUntil !== "string")) {
    deny("invalid-membership");
  }
  const membershipValidUntilMs = membership.validUntil === null ? null : parseDate(membership.validUntil, "membership.validUntil");
  const membershipActive = membership.active === true && (membershipValidUntilMs === null || membershipValidUntilMs > nowMs);
  const applicationValues = array(root.applicationAccess, "applicationAccess");
  if (applicationValues.length > 5) deny("invalid-applicationAccess");
  const seenApplications = new Set<string>();
  const applicationAccess = applicationValues.map((value) => {
    const application = exactRecord(value, APPLICATION_KEYS, "applicationAccess item");
    if (typeof application.applicationId !== "string" || !APPLICATION_IDS.has(application.applicationId) || seenApplications.has(application.applicationId)) {
      deny("invalid-applicationId");
    }
    seenApplications.add(application.applicationId);
    const entitlementValues = array(application.entitlements, "entitlements");
    if (entitlementValues.length < 1 || entitlementValues.length > 32) deny("invalid-entitlements");
    const seenEntitlements = new Set<string>();
    const entitlements = entitlementValues.map((item): ActiveProjectionEntitlement => {
      const entitlement = exactRecord(item, ENTITLEMENT_KEYS, "entitlement");
      if (typeof entitlement.entitlementId !== "string" || entitlement.entitlementId.length < 1 || entitlement.entitlementId.length > 240
        || seenEntitlements.has(entitlement.entitlementId)
        || entitlement.definitionVersion !== ACTIVE_PROJECTION_CONTRACT.catalogVersion
        || (entitlement.profileId !== null && (typeof entitlement.profileId !== "string" || entitlement.profileId.length > 100))
        || typeof entitlement.source !== "string" || !SOURCES.has(entitlement.source)
        || (entitlement.sourceRef !== null && (typeof entitlement.sourceRef !== "string" || entitlement.sourceRef.length > 240))
        || typeof entitlement.virtual !== "boolean") deny("invalid-entitlement");
      seenEntitlements.add(entitlement.entitlementId);
      const capabilities = stringArray(entitlement.capabilities, "capabilities");
      if (capabilities.length < 1 || capabilities.some((capability) => !CAPABILITY_PATTERN.test(capability) || !capability.startsWith(`${application.applicationId}:`))) {
        deny("invalid-capabilities");
      }
      const scopes = parseScopeArray(entitlement.scopes, "scopes");
      const effectiveScopes = parseScopeArray(entitlement.effectiveScopes, "effectiveScopes");
      const validFrom = entitlement.validFrom === null ? null : isoDate(entitlement.validFrom, "validFrom");
      const validUntil = entitlement.validUntil === null ? null : isoDate(entitlement.validUntil, "validUntil");
      if (entitlement.virtual !== true && validFrom === null) deny("invalid-validFrom");
      if (validFrom !== null && validUntil !== null && Date.parse(validUntil) <= Date.parse(validFrom)) {
        deny("invalid-entitlement-window");
      }
      const parsed: ActiveProjectionEntitlement = {
        entitlementId: entitlement.entitlementId,
        definitionVersion: String(entitlement.definitionVersion),
        profileId: entitlement.profileId as string | null,
        source: entitlement.source as ActiveProjectionEntitlement["source"],
        sourceRef: entitlement.sourceRef as string | null,
        virtual: entitlement.virtual,
        capabilities,
        scopes,
        effectiveScopes,
        validFrom,
        validUntil,
      };
      if (parsed.virtual && !validEmployeeBaseline(parsed, identity, membershipActive)) deny("invalid-virtual-entitlement");
      return parsed;
    });
    return { applicationId: application.applicationId, entitlements };
  });
  return {
    subjectId: identity.subjectId,
    identityKind: identity.kind as "person" | "service",
    identityActive: identity.active,
    employeeEligible: identity.employeeEligible,
    membershipActive,
    membershipValidUntil: membership.validUntil as string | null,
    organizationId: "org_stratos",
    generatedAt: String(root.generatedAt),
    expiresAt: String(root.expiresAt),
    applicationAccess,
  };
}

export function evaluateShadowProjectionV2(
  payload: unknown,
  resource: ShadowResourceDecisionInput,
  nowMs = Date.now(),
): ShadowDecision {
  return evaluateProjectionV2(payload, resource, SHADOW_PROJECTION_CONTRACT, nowMs);
}

export function evaluateActiveProjectionV2(
  payload: unknown,
  resource: ShadowResourceDecisionInput,
  nowMs = Date.now(),
): ShadowDecision {
  return evaluateProjectionV2(payload, resource, ACTIVE_PROJECTION_CONTRACT, nowMs);
}

type ProjectionContract = Pick<
  typeof SHADOW_PROJECTION_CONTRACT | typeof ACTIVE_PROJECTION_CONTRACT,
  "schemaVersion" | "revision" | "status" | "digest" | "catalogVersion" | "organizationId"
>;

function evaluateProjectionV2(
  payload: unknown,
  resource: ShadowResourceDecisionInput,
  contract: ProjectionContract,
  nowMs: number,
): ShadowDecision {
  try {
    const root = exactRecord(payload, ROOT_KEYS, "projection");
    requireLiteral(root.schemaVersion, contract.schemaVersion, "schema");
    requireLiteral(root.contractRevision, contract.revision, "revision");
    requireLiteral(root.contractStatus, contract.status, "status");
    requireLiteral(root.contractDigest, contract.digest, "digest");
    requireLiteral(root.catalogVersion, contract.catalogVersion, "catalog");
    requireLiteral(root.organizationId, contract.organizationId, "organization");
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
  if (typeof scope.type !== "string" || !SCOPE_TYPES.has(scope.type)
    || (scope.id !== undefined && (typeof scope.id !== "string" || scope.id.length < 1 || scope.id.length > 200))) deny("invalid-scope");
  return scope.id === undefined ? { type: scope.type } : { type: scope.type, id: scope.id as string };
}

function parseScopeArray(value: unknown, label: string): ProjectionScope[] {
  const scopes = array(value, label).map(parseScope);
  if (scopes.length < 1 || scopes.some((scope) => !SCOPE_TYPES.has(scope.type))) deny(`invalid-${label}`);
  const keys = scopes.map((scope) => `${scope.type}\u0000${scope.id ?? ""}`);
  if (new Set(keys).size !== keys.length) deny(`invalid-${label}`);
  return scopes;
}

function isoDate(value: unknown, label: string): string {
  parseDate(value, label);
  return value as string;
}

function validEmployeeBaseline(
  entitlement: ActiveProjectionEntitlement,
  identity: RecordValue,
  membershipActive: boolean,
): boolean {
  const expectedCapabilities = ["akb:access", "akb:chat", "akb:read_document"];
  const expectedScopes = ["organization\u0000org_stratos", "public\u0000", "recipient_set\u0000employee-directives"];
  const scopeKeys = entitlement.scopes.map((scope) => `${scope.type}\u0000${scope.id ?? ""}`).sort();
  const effectiveScopeKeys = new Set(entitlement.effectiveScopes.map((scope) => `${scope.type}\u0000${scope.id ?? ""}`));
  return entitlement.entitlementId === "system:akb:employee-baseline"
    && entitlement.profileId === "stratos-user"
    && entitlement.source === "SYSTEM"
    && entitlement.sourceRef === "employee-baseline"
    && entitlement.validFrom === null
    && entitlement.validUntil === null
    && [...entitlement.capabilities].sort().join("\u0000") === expectedCapabilities.sort().join("\u0000")
    && scopeKeys.join("\u0000") === expectedScopes.sort().join("\u0000")
    && expectedScopes.every((scope) => effectiveScopeKeys.has(scope))
    && identity.kind === "person"
    && identity.active === true
    && identity.employeeEligible === true
    && membershipActive;
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
