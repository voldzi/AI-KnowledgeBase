import type { ApiRequestContext } from "@/lib/types";

export type AklSurface = "employee_chat" | "knowledge_workspace" | "admin";

const MANAGEMENT_ROLES = new Set([
  "admin",
  "akl_admin",
  "akb_admin",
  "stratos_admin",
  "stratos_superadmin",
  "document_manager",
  "akl_document_manager",
  "document_owner",
  "akl_document_owner",
  "document_gestor",
  "akl_document_gestor",
  "reviewer",
  "akl_reviewer",
  "auditor",
  "akl_auditor",
  "service_governance",
  "akl_service_governance",
  "analyst",
  "akl_analyst"
]);

const ADMIN_ROLES = new Set([
  "admin",
  "akl_admin",
  "akb_admin",
  "stratos_admin",
  "stratos_superadmin"
]);

const EMPLOYEE_CHAT_ROLES = new Set(["reader", "akl_reader", "stratos_user", "akb_user"]);

const DOCUMENT_CREATOR_ROLES = new Set([
  ...ADMIN_ROLES,
  "document_manager",
  "akl_document_manager"
]);

const DOCUMENT_EDITOR_ROLES = new Set([
  ...DOCUMENT_CREATOR_ROLES,
  "document_owner",
  "akl_document_owner",
  "document_gestor",
  "akl_document_gestor"
]);

const WORKFLOW_ROLES = new Set([
  ...DOCUMENT_EDITOR_ROLES,
  "reviewer",
  "akl_reviewer",
  "auditor",
  "akl_auditor",
  "service_governance",
  "akl_service_governance"
]);

const INTELLIGENCE_ROLES = new Set([
  ...DOCUMENT_CREATOR_ROLES,
  "analyst",
  "akl_analyst",
  "auditor",
  "akl_auditor",
  "service_governance",
  "akl_service_governance"
]);

const AUDIT_ROLES = new Set([
  ...ADMIN_ROLES,
  "auditor",
  "akl_auditor",
  "service_governance",
  "akl_service_governance"
]);

export function hasAnyRole(roles: readonly string[] | undefined, allowed: ReadonlySet<string>): boolean {
  return (roles ?? []).some((role) => allowed.has(role));
}

function hasAnyCapability(capabilities: readonly string[] | undefined, allowed: readonly string[]): boolean {
  return allowed.some((capability) => capabilities?.includes(capability));
}

function usesCapabilityModel(
  context: Pick<ApiRequestContext, "roles" | "capabilities"> | null | undefined
): boolean {
  return Boolean(
    context?.capabilities?.length
    || context?.roles?.some((role) => role === "stratos_user" || role === "stratos_admin")
  );
}

function hasActiveAccess(
  context: Pick<
    ApiRequestContext,
    "identityActive" | "membershipActive" | "applicationAccessActive"
  > | null | undefined
): boolean {
  return context?.identityActive !== false
    && context?.membershipActive !== false
    && context?.applicationAccessActive !== false;
}

export function canUseKnowledgeWorkspace(
  context: Pick<
    ApiRequestContext,
    "roles" | "capabilities" | "identityActive" | "membershipActive" | "applicationAccessActive"
  > | null | undefined
): boolean {
  if (!hasActiveAccess(context)) return false;
  if (usesCapabilityModel(context)) {
    return hasAnyCapability(context?.capabilities, ["akb:read_document", "akb:upload", "akb:manage_document", "akb:read_audit"]);
  }
  return hasAnyRole(context?.roles, MANAGEMENT_ROLES);
}

export function canUseAdminSurface(
  context: Pick<
    ApiRequestContext,
    "roles" | "capabilities" | "identityActive" | "membershipActive" | "applicationAccessActive"
  > | null | undefined
): boolean {
  if (!hasActiveAccess(context)) return false;
  if (usesCapabilityModel(context)) return hasAnyCapability(context?.capabilities, ["akb:manage_access"]);
  return hasAnyRole(context?.roles, ADMIN_ROLES);
}

export function canUseIntelligence(
  context: Pick<
    ApiRequestContext,
    "roles" | "capabilities" | "identityActive" | "membershipActive" | "applicationAccessActive"
  > | null | undefined
): boolean {
  if (!hasActiveAccess(context)) return false;
  if (usesCapabilityModel(context)) {
    return hasAnyCapability(context?.capabilities, ["akb:read_document", "akb:read_audit"]);
  }
  return hasAnyRole(context?.roles, INTELLIGENCE_ROLES);
}

export function canUseEmployeeChat(
  context: Pick<
    ApiRequestContext,
    "roles" | "subjectId" | "capabilities" | "identityActive" | "membershipActive" | "applicationAccessActive"
  > | null | undefined
): boolean {
  if (!hasActiveAccess(context)) return false;
  if (usesCapabilityModel(context)) return Boolean(context?.capabilities?.includes("akb:chat"));
  return Boolean(context?.subjectId) || canUseKnowledgeWorkspace(context) || hasAnyRole(context?.roles, EMPLOYEE_CHAT_ROLES);
}

export function surfaceForContext(context: Pick<ApiRequestContext, "roles" | "capabilities"> | null | undefined): AklSurface {
  if (canUseAdminSurface(context)) {
    return "admin";
  }
  if (canUseKnowledgeWorkspace(context)) {
    return "knowledge_workspace";
  }
  return "employee_chat";
}

export function isEmployeeChatOnly(context: Pick<ApiRequestContext, "roles" | "capabilities"> | null | undefined): boolean {
  return surfaceForContext(context) === "employee_chat";
}

export function canAccessWorkspaceRoute(
  roles: readonly string[] | undefined,
  href: string,
  capabilities?: readonly string[]
): boolean {
  const route = normalizeRoute(href);
  const effectiveCapabilities = capabilities ?? [];
  if (capabilities?.length || roles?.some((role) => role === "stratos_user" || role === "stratos_admin")) {
    if (routeMatches(route, "/help")) return true;
    if (routeMatches(route, "/chat")) return effectiveCapabilities.includes("akb:chat");
    if (routeMatches(route, "/admin")) return effectiveCapabilities.includes("akb:manage_access");
    if (routeMatches(route, "/audit")) return effectiveCapabilities.includes("akb:read_audit");
    if (routeMatches(route, "/intelligence")) return hasAnyCapability(effectiveCapabilities, ["akb:read_document", "akb:read_audit"]);
    if (routeMatches(route, "/documents/new") || routeMatches(route, "/upload")) {
      return hasAnyCapability(effectiveCapabilities, ["akb:upload", "akb:manage_document"]);
    }
    if (routeMatches(route, "/documents") || routeMatches(route, "/ingestion") || routeMatches(route, "/tasks")) {
      return hasAnyCapability(effectiveCapabilities, ["akb:read_document", "akb:manage_document", "akb:upload"]);
    }
    if (route === "/" || routeMatches(route, "/dashboard")) {
      return canUseKnowledgeWorkspace({ roles: [...(roles ?? [])], capabilities: [...effectiveCapabilities] });
    }
    return false;
  }
  if (routeMatches(route, "/chat") || routeMatches(route, "/help")) {
    return true;
  }
  if (routeMatches(route, "/admin")) {
    return hasAnyRole(roles, ADMIN_ROLES);
  }
  if (routeMatches(route, "/audit")) {
    return hasAnyRole(roles, AUDIT_ROLES);
  }
  if (routeMatches(route, "/intelligence")) {
    return hasAnyRole(roles, INTELLIGENCE_ROLES);
  }
  if (routeMatches(route, "/documents/new")) {
    return hasAnyRole(roles, DOCUMENT_CREATOR_ROLES);
  }
  if (routeMatches(route, "/upload")) {
    return hasAnyRole(roles, DOCUMENT_EDITOR_ROLES);
  }
  if (routeMatches(route, "/ingestion")) {
    return hasAnyRole(roles, DOCUMENT_CREATOR_ROLES);
  }
  if (routeMatches(route, "/documents")) {
    return hasAnyRole(roles, MANAGEMENT_ROLES);
  }
  if (routeMatches(route, "/tasks")) {
    return hasAnyRole(roles, WORKFLOW_ROLES);
  }
  if (route === "/" || routeMatches(route, "/dashboard")) {
    return hasAnyRole(roles, MANAGEMENT_ROLES);
  }
  return false;
}

function normalizeRoute(href: string): string {
  const route = href.split(/[?#]/, 1)[0]?.trim() || "/";
  return route.length > 1 ? route.replace(/\/+$/, "") : route;
}

function routeMatches(route: string, prefix: string): boolean {
  return route === prefix || route.startsWith(`${prefix}/`);
}
