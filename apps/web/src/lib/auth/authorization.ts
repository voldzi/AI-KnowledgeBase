import type { ApiRequestContext, AuthorizationHint } from "@/lib/types";
import type { WebProfile } from "@/lib/api/config";

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
]);

const INTELLIGENCE_ROLES = new Set([
  ...DOCUMENT_CREATOR_ROLES,
  "analyst",
  "akl_analyst",
  "auditor",
  "akl_auditor",
]);

const AUDIT_ROLES = new Set([
  ...ADMIN_ROLES,
  "auditor",
  "akl_auditor",
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

export function canReadTeamTasks(context: ApiRequestContext): boolean {
  if (!hasActiveAccess(context)) return false;
  if (usesCapabilityModel(context)) return Boolean(context.capabilities?.includes("akb:manage_document"));
  return hasAnyRole(context.roles, DOCUMENT_CREATOR_ROLES) || hasAnyRole(context.roles, AUDIT_ROLES);
}

export function canUseIntelligence(
  context: Pick<
    ApiRequestContext,
    "roles" | "capabilities" | "identityActive" | "membershipActive" | "applicationAccessActive"
  > | null | undefined
): boolean {
  if (!hasActiveAccess(context)) return false;
  if (usesCapabilityModel(context)) {
    return hasAnyCapability(context?.capabilities, ["akb:manage_document", "akb:read_audit"]);
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
    if (routeMatches(route, "/sources")) return effectiveCapabilities.includes("akb:manage_document");
    if (routeMatches(route, "/audit")) return effectiveCapabilities.includes("akb:read_audit");
    if (routeMatches(route, "/intelligence")) {
      return hasAnyCapability(effectiveCapabilities, ["akb:manage_document", "akb:read_audit"]);
    }
    if (routeMatches(route, "/controlled-documentation")) {
      return hasAnyCapability(effectiveCapabilities, ["akb:read_document", "akb:manage_document"]);
    }
    if (routeMatches(route, "/documents/new") || routeMatches(route, "/upload")) {
      return hasAnyCapability(effectiveCapabilities, ["akb:upload", "akb:manage_document"]);
    }
    if (routeMatches(route, "/ingestion")) {
      return effectiveCapabilities.includes("akb:manage_document");
    }
    if (routeMatches(route, "/tasks")) {
      return hasAnyCapability(effectiveCapabilities, ["akb:read_document", "akb:manage_document"]);
    }
    if (routeMatches(route, "/documents")) {
      return hasAnyCapability(effectiveCapabilities, ["akb:read_document", "akb:manage_document", "akb:upload"]);
    }
    if (route === "/" || routeMatches(route, "/dashboard")) {
      return hasAnyCapability(effectiveCapabilities, ["akb:manage_document", "akb:read_audit"]);
    }
    return false;
  }
  if (routeMatches(route, "/chat") || routeMatches(route, "/help")) {
    return true;
  }
  if (routeMatches(route, "/admin")) {
    return hasAnyRole(roles, ADMIN_ROLES);
  }
  if (routeMatches(route, "/sources")) {
    return hasAnyRole(roles, DOCUMENT_CREATOR_ROLES);
  }
  if (routeMatches(route, "/audit")) {
    return hasAnyRole(roles, AUDIT_ROLES);
  }
  if (routeMatches(route, "/intelligence")) {
    return hasAnyRole(roles, INTELLIGENCE_ROLES);
  }
  if (routeMatches(route, "/controlled-documentation")) {
    return hasAnyRole(roles, MANAGEMENT_ROLES);
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

export function canAccessAppShellRoute(
  roles: readonly string[] | undefined,
  href: string,
  capabilities: readonly string[] | undefined,
  profile: WebProfile,
): boolean {
  const route = normalizeRoute(href);
  if (profile === "chat") {
    return (route === "/" || route === "/chat")
      && canAccessWorkspaceRoute(roles, "/chat", capabilities);
  }
  return canAccessWorkspaceRoute(roles, route, capabilities);
}

export function canAccessWorkspaceRouteForContext(
  context: Pick<
    ApiRequestContext,
    "roles" | "capabilities" | "identityActive" | "membershipActive" | "applicationAccessActive"
  > | null | undefined,
  href: string,
): boolean {
  if (!hasActiveAccess(context)) return false;
  return canAccessWorkspaceRoute(context?.roles, href, context?.capabilities);
}

export function constrainAuthorizationHintsToContext(
  context: Pick<
    ApiRequestContext,
    "roles" | "capabilities" | "identityActive" | "membershipActive" | "applicationAccessActive"
  > | null | undefined,
  authorization: AuthorizationHint,
): AuthorizationHint {
  if (!hasActiveAccess(context)) return denyAllAuthorizationHints();
  if (!usesCapabilityModel(context)) return authorization;

  const capabilities = context?.capabilities ?? [];
  return {
    can_read: authorization.can_read && hasAnyCapability(capabilities, [
      "akb:read_document",
      "akb:manage_document",
      "akb:upload",
    ]),
    can_update: authorization.can_update && capabilities.includes("akb:manage_document"),
    can_ingest: authorization.can_ingest && hasAnyCapability(capabilities, [
      "akb:upload",
      "akb:manage_document",
    ]),
    can_publish: authorization.can_publish && hasAnyCapability(capabilities, [
      "akb:manage_document",
      "akb:publish_public",
    ]),
    can_read_audit: authorization.can_read_audit && capabilities.includes("akb:read_audit"),
    can_manage_admin: authorization.can_manage_admin && capabilities.includes("akb:manage_access"),
  };
}

function denyAllAuthorizationHints(): AuthorizationHint {
  return {
    can_read: false,
    can_update: false,
    can_ingest: false,
    can_publish: false,
    can_read_audit: false,
    can_manage_admin: false,
  };
}

function normalizeRoute(href: string): string {
  const route = href.split(/[?#]/, 1)[0]?.trim() || "/";
  return route.length > 1 ? route.replace(/\/+$/, "") : route;
}

function routeMatches(route: string, prefix: string): boolean {
  return route === prefix || route.startsWith(`${prefix}/`);
}
