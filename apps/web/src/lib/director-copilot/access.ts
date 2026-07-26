import type { ApiRequestContext } from "@/lib/types";

import { canonicalDirectorCopilotApplication } from "./application-id";
import type { DomainApplication, ScopeCoordinate } from "./contracts";
import { parseScopeString, stableSha256 } from "./contracts";
import { domainCatalogToolForApplication } from "./domain-catalog";

const MAX_SOURCE_SCOPES = 100;

export interface DomainAccess {
  application: DomainApplication;
  authorized: boolean;
  requiredCapabilities: string[];
  scopes: ScopeCoordinate[];
  reason:
    | "allowed"
    | "projection_required"
    | "organization_invalid"
    | "application_inactive"
    | "access_capability_missing"
    | "read_capability_missing"
    | "scope_missing"
    | "scope_limit_exceeded";
}

export function domainAccessFor(
  context: ApiRequestContext,
  application: DomainApplication,
  nowMs = Date.now(),
): DomainAccess {
  const tool = domainCatalogToolForApplication(application);
  const requiredCapabilities = tool.read_capabilities;
  if (context.authorizationSource !== "stratos_projection") {
    return { application, authorized: false, requiredCapabilities, scopes: [], reason: "projection_required" };
  }
  if (context.organizationId !== "org_stratos") {
    return { application, authorized: false, requiredCapabilities, scopes: [], reason: "organization_invalid" };
  }
  if (context.identityActive === false || context.membershipActive === false) {
    return { application, authorized: false, requiredCapabilities, scopes: [], reason: "application_inactive" };
  }
  const access = context.applicationAccess?.find(
    (candidate) => canonicalDirectorCopilotApplication(candidate.application) === application,
  );
  if (!access || !validAt(access.validUntil, nowMs)) {
    return { application, authorized: false, requiredCapabilities, scopes: [], reason: "application_inactive" };
  }
  const accessCapability = tool.access_capability;
  if (accessCapability && !access.capabilities.includes(accessCapability)) {
    return { application, authorized: false, requiredCapabilities, scopes: [], reason: "access_capability_missing" };
  }
  if (!requiredCapabilities.some((capability) => access.capabilities.includes(capability))) {
    return { application, authorized: false, requiredCapabilities, scopes: [], reason: "read_capability_missing" };
  }
  const effectiveScopeKeys = new Set(
    (access.effectiveScopes ?? [])
      .map(parseScopeString)
      .filter((scope): scope is ScopeCoordinate => scope !== null)
      .map(scopeKey),
  );
  const scopes = [...new Map(
    (access.scopes ?? [])
      .map(parseScopeString)
      .filter((scope): scope is ScopeCoordinate => (
        scope !== null
        && tool.scope_types.includes(scope.type)
        && effectiveScopeKeys.has(scopeKey(scope))
        && scopeAllowedByReadCapability(application, scope, access.capabilities)
      ))
      .map((scope) => [scopeKey(scope), scope]),
  ).values()];
  if (!scopes.length) {
    return { application, authorized: false, requiredCapabilities, scopes: [], reason: "scope_missing" };
  }
  if (scopes.length > MAX_SOURCE_SCOPES) {
    return { application, authorized: false, requiredCapabilities, scopes: [], reason: "scope_limit_exceeded" };
  }
  return { application, authorized: true, requiredCapabilities, scopes, reason: "allowed" };
}

export function accessProjectionHash(context: ApiRequestContext): string {
  const applicationAccess = (context.applicationAccess ?? [])
    .map((access) => ({
      application:
        canonicalDirectorCopilotApplication(access.application)
        ?? access.application.trim().toLowerCase().replaceAll("_", "-"),
      capabilities: [...new Set(access.capabilities)].sort(),
      scopes: [...new Set(access.scopes ?? [])].sort(),
      effective_scopes: [...new Set(access.effectiveScopes ?? [])].sort(),
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

function validAt(validUntil: string | null | undefined, nowMs: number): boolean {
  if (!validUntil) return true;
  const parsed = Date.parse(validUntil);
  return !Number.isNaN(parsed) && parsed > nowMs;
}

function scopeKey(scope: ScopeCoordinate): string {
  return `${scope.type}:${scope.id ?? ""}`;
}

function scopeAllowedByReadCapability(
  application: DomainApplication,
  scope: ScopeCoordinate,
  capabilities: string[],
): boolean {
  if (application === "budget" || application === "projectflow") {
    return true;
  }
  if (application === "archflow") {
    if (scope.type === "own") return capabilities.includes("archflow:read_own");
    if (scope.type === "organization_unit") {
      return capabilities.includes("archflow:read_unit")
        || capabilities.includes("archflow:read_organization");
    }
    if (scope.type === "organization") {
      return capabilities.includes("archflow:read_organization");
    }
    if (scope.type === "recipient_set") {
      return capabilities.includes("archflow:read_unit")
        || capabilities.includes("archflow:read_organization");
    }
    return false;
  }
  if (scope.type === "own") return capabilities.includes("aiip:read_own");
  if (scope.type === "organization_unit") return capabilities.includes("aiip:read_unit");
  if (scope.type === "organization" || scope.type === "recipient_set") {
    return capabilities.includes("aiip:read_organization");
  }
  return false;
}
