import type { ApiRequestContext } from "@/lib/types";

import type { DomainApplication, ScopeCoordinate } from "./contracts";
import { parseScopeString, stableSha256 } from "./contracts";

const REQUIRED_CAPABILITY = {
  budget: "budget:read",
  projectflow: "projectflow:read",
} as const;

const SOURCE_SCOPE_TYPES: Record<DomainApplication, ReadonlySet<ScopeCoordinate["type"]>> = {
  budget: new Set(["organization", "budget_scope", "project"]),
  projectflow: new Set(["organization", "portfolio", "project"]),
};

const MAX_SOURCE_SCOPES = 100;

export interface DomainAccess {
  application: DomainApplication;
  authorized: boolean;
  requiredCapability: (typeof REQUIRED_CAPABILITY)[DomainApplication];
  scopes: ScopeCoordinate[];
  reason: "allowed" | "projection_required" | "organization_invalid" | "application_inactive" | "capability_missing" | "scope_missing" | "scope_limit_exceeded";
}

export function domainAccessFor(
  context: ApiRequestContext,
  application: DomainApplication,
  nowMs = Date.now(),
): DomainAccess {
  const requiredCapability = REQUIRED_CAPABILITY[application];
  if (context.authorizationSource !== "stratos_projection") {
    return { application, authorized: false, requiredCapability, scopes: [], reason: "projection_required" };
  }
  if (context.organizationId !== "org_stratos") {
    return { application, authorized: false, requiredCapability, scopes: [], reason: "organization_invalid" };
  }
  if (context.identityActive === false || context.membershipActive === false) {
    return { application, authorized: false, requiredCapability, scopes: [], reason: "application_inactive" };
  }
  const access = context.applicationAccess?.find(
    (candidate) => normalizeApplication(candidate.application) === application,
  );
  if (!access || !validAt(access.validUntil, nowMs)) {
    return { application, authorized: false, requiredCapability, scopes: [], reason: "application_inactive" };
  }
  if (!access.capabilities.includes(requiredCapability)) {
    return { application, authorized: false, requiredCapability, scopes: [], reason: "capability_missing" };
  }
  const scopes = [...new Map(
    (access.scopes ?? [])
      .map(parseScopeString)
      .filter((scope): scope is ScopeCoordinate => (
        scope !== null && SOURCE_SCOPE_TYPES[application].has(scope.type)
      ))
      .map((scope) => [`${scope.type}:${scope.id ?? ""}`, scope]),
  ).values()];
  if (!scopes.length) {
    return { application, authorized: false, requiredCapability, scopes: [], reason: "scope_missing" };
  }
  if (scopes.length > MAX_SOURCE_SCOPES) {
    return { application, authorized: false, requiredCapability, scopes: [], reason: "scope_limit_exceeded" };
  }
  return { application, authorized: true, requiredCapability, scopes, reason: "allowed" };
}

export function accessProjectionHash(context: ApiRequestContext): string {
  const applicationAccess = (context.applicationAccess ?? [])
    .map((access) => ({
      application: normalizeApplication(access.application),
      capabilities: [...new Set(access.capabilities)].sort(),
      scopes: [...new Set(access.scopes ?? [])].sort(),
      valid_until: access.validUntil ?? null,
    }))
    .sort((left, right) => left.application.localeCompare(right.application));
  return stableSha256({
    organization_id: context.organizationId ?? null,
    identity_active: context.identityActive !== false,
    membership_active: context.membershipActive !== false,
    application_access: applicationAccess,
  });
}

function normalizeApplication(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", "-");
}

function validAt(validUntil: string | null | undefined, nowMs: number): boolean {
  if (!validUntil) return true;
  const parsed = Date.parse(validUntil);
  return !Number.isNaN(parsed) && parsed > nowMs;
}
