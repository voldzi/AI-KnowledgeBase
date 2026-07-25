import type { ApiRequestContext } from "@/lib/types";

import {
  type DirectorCopilotV2Application,
  type DirectorCopilotV2Granularity,
  type DirectorCopilotV2Manifest,
  type DirectorCopilotV2Scope,
  type DirectorCopilotV2ScopeType,
} from "./contracts";

const MAX_SOURCE_SCOPES = 100;

export interface DirectorCopilotV2AccessDecision {
  application: DirectorCopilotV2Application;
  authorized: boolean;
  capabilities: string[];
  scopes: DirectorCopilotV2Scope[];
  reason:
    | "allowed"
    | "projection_required"
    | "organization_mismatch"
    | "identity_inactive"
    | "application_access_missing"
    | "grant_expired"
    | "capability_missing"
    | "scope_missing"
    | "scope_limit_exceeded";
}

export function directorCopilotV2AccessFor(
  context: ApiRequestContext,
  application: DirectorCopilotV2Application,
  manifest: DirectorCopilotV2Manifest,
  granularity: DirectorCopilotV2Granularity,
  nowMs = Date.now(),
): DirectorCopilotV2AccessDecision {
  if (context.authorizationSource !== "stratos_projection" || !context.accessToken) {
    return denied(application, "projection_required");
  }
  if (context.organizationId !== "org_stratos") {
    return denied(application, "organization_mismatch");
  }
  if (
    context.identityActive === false
    || context.membershipActive === false
    || context.applicationAccessActive === false
  ) {
    return denied(application, "identity_inactive");
  }
  const access = (context.applicationAccess ?? []).find(
    (candidate) => normalizeApplication(candidate.application) === application,
  );
  if (!access) return denied(application, "application_access_missing");
  if (!validAt(access.validUntil, nowMs)) return denied(application, "grant_expired");

  const capabilities = [...new Set(access.capabilities)].sort();
  if (!satisfiesClause(
    capabilities,
    manifest.capability_requirements.all_of,
    manifest.capability_requirements.any_of,
  )) {
    return {
      ...denied(application, "capability_missing"),
      capabilities,
    };
  }

  const effective = new Set(
    (access.effectiveScopes ?? []).flatMap((scope) => {
      const parsed = parseScope(scope);
      return parsed ? [scopeKey(parsed)] : [];
    }),
  );
  const scopes = [...new Map(
    (access.scopes ?? []).flatMap((scope) => {
      const parsed = parseScope(scope);
      if (
        !parsed
        || !manifest.supported_scope_types.includes(parsed.type)
        || !effective.has(scopeKey(parsed))
        || !scopeCanCoverGranularity(parsed.type, granularity)
        || !conditionalCapabilitiesSatisfied(capabilities, parsed.type, granularity, manifest)
      ) {
        return [];
      }
      return [[scopeKey(parsed), parsed] as const];
    }),
  ).values()];
  if (!scopes.length) {
    return {
      ...denied(application, "scope_missing"),
      capabilities,
    };
  }
  if (scopes.length > MAX_SOURCE_SCOPES) {
    return {
      ...denied(application, "scope_limit_exceeded"),
      capabilities,
    };
  }
  return {
    application,
    authorized: true,
    capabilities,
    scopes,
    reason: "allowed",
  };
}

function scopeCanCoverGranularity(
  scopeType: DirectorCopilotV2ScopeType,
  granularity: DirectorCopilotV2Granularity,
): boolean {
  if (granularity === "item") return true;
  const coverage: Record<
    Exclude<DirectorCopilotV2Granularity, "item">,
    DirectorCopilotV2ScopeType[]
  > = {
    organization: ["organization"],
    organization_unit: ["organization", "organization_unit"],
    portfolio: ["organization", "organization_unit", "portfolio"],
    project: [
      "organization",
      "organization_unit",
      "budget_scope",
      "portfolio",
      "project",
    ],
  };
  return coverage[granularity].includes(scopeType);
}

function conditionalCapabilitiesSatisfied(
  capabilities: string[],
  scopeType: DirectorCopilotV2ScopeType,
  granularity: DirectorCopilotV2Granularity,
  manifest: DirectorCopilotV2Manifest,
): boolean {
  const applicable = manifest.capability_requirements.conditional.filter(
    (clause) => clause.when.scope_types.includes(scopeType)
      && clause.when.granularities.includes(granularity),
  );
  return applicable.every((clause) => (
    satisfiesClause(capabilities, clause.all_of, clause.any_of)
  ));
}

function satisfiesClause(
  capabilities: string[],
  allOf: string[],
  anyOf: string[],
): boolean {
  const available = new Set(capabilities);
  return allOf.every((capability) => available.has(capability))
    && (anyOf.length === 0 || anyOf.some((capability) => available.has(capability)));
}

function parseScope(value: string): DirectorCopilotV2Scope | null {
  const separator = value.indexOf(":");
  const rawType = separator >= 0 ? value.slice(0, separator) : value;
  const rawId = separator >= 0 ? value.slice(separator + 1) : "";
  const type = rawType.trim() as DirectorCopilotV2ScopeType;
  if (!SCOPE_TYPES.has(type)) return null;
  const id = rawId.trim();
  if (id.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(id)) return null;
  return id ? { type, id } : { type };
}

const SCOPE_TYPES = new Set<DirectorCopilotV2ScopeType>([
  "own",
  "public",
  "organization",
  "organization_unit",
  "budget_scope",
  "portfolio",
  "project",
  "document",
  "recipient_set",
]);

function scopeKey(scope: DirectorCopilotV2Scope): string {
  return `${scope.type}:${scope.id ?? ""}`;
}

function normalizeApplication(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", "-");
}

function validAt(validUntil: string | null | undefined, nowMs: number): boolean {
  if (!validUntil) return true;
  const parsed = Date.parse(validUntil);
  return !Number.isNaN(parsed) && parsed > nowMs;
}

function denied(
  application: DirectorCopilotV2Application,
  reason: DirectorCopilotV2AccessDecision["reason"],
): DirectorCopilotV2AccessDecision {
  return {
    application,
    authorized: false,
    capabilities: [],
    scopes: [],
    reason,
  };
}
