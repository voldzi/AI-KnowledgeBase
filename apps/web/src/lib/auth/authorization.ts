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
  "akl_service_governance"
]);

const ADMIN_ROLES = new Set([
  "admin",
  "akl_admin",
  "akb_admin",
  "stratos_admin",
  "stratos_superadmin"
]);

const EMPLOYEE_CHAT_ROLES = new Set(["reader", "akl_reader", "stratos_user", "akb_user"]);

export function hasAnyRole(roles: readonly string[] | undefined, allowed: ReadonlySet<string>): boolean {
  return (roles ?? []).some((role) => allowed.has(role));
}

export function canUseKnowledgeWorkspace(context: Pick<ApiRequestContext, "roles"> | null | undefined): boolean {
  return hasAnyRole(context?.roles, MANAGEMENT_ROLES);
}

export function canUseAdminSurface(context: Pick<ApiRequestContext, "roles"> | null | undefined): boolean {
  return hasAnyRole(context?.roles, ADMIN_ROLES);
}

export function canUseEmployeeChat(context: Pick<ApiRequestContext, "roles" | "subjectId"> | null | undefined): boolean {
  return Boolean(context?.subjectId) || canUseKnowledgeWorkspace(context) || hasAnyRole(context?.roles, EMPLOYEE_CHAT_ROLES);
}

export function surfaceForContext(context: Pick<ApiRequestContext, "roles"> | null | undefined): AklSurface {
  if (canUseAdminSurface(context)) {
    return "admin";
  }
  if (canUseKnowledgeWorkspace(context)) {
    return "knowledge_workspace";
  }
  return "employee_chat";
}

export function isEmployeeChatOnly(context: Pick<ApiRequestContext, "roles"> | null | undefined): boolean {
  return surfaceForContext(context) === "employee_chat";
}
