import { createHash } from "node:crypto";

import type { ApiRequestContext } from "@/lib/types";

export type DirectorCopilotApplication =
  | "budget"
  | "projectflow"
  | "archflow"
  | "aiip";

export type DirectorCopilotIntent =
  | "portfolio_risk_correlation"
  | "portfolio_performance_overview"
  | "project_portfolio_status"
  | "budget_portfolio_status"
  | "project_access_overview"
  | "archflow_demand_overview"
  | "aiip_idea_overview"
  | "innovation_delivery_trace";

const APPLICATION_ALIASES: Readonly<Record<string, DirectorCopilotApplication>> = {
  budget: "budget",
  "budget-contract": "budget",
  projectflow: "projectflow",
  "project-flow": "projectflow",
  archflow: "archflow",
  "arch-flow": "archflow",
  aiip: "aiip",
  "ai-innovation-portal": "aiip",
};

export function canonicalDirectorCopilotApplication(
  value: string,
): DirectorCopilotApplication | null {
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  return APPLICATION_ALIASES[normalized] ?? null;
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

export function stableSha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, inner]) => `${JSON.stringify(key)}:${canonicalJson(inner)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
