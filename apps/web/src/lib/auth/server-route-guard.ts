import "server-only";

import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import {
  canUseAdminSurface,
  canUseEmployeeChat,
  canUseIntelligence,
  canUseKnowledgeWorkspace,
  isEmployeeChatOnly
} from "@/lib/auth/authorization";
import { getAklConfig } from "@/lib/api/config";
import type { ApiRequestContext } from "@/lib/types";

type PageAccess = "employee_chat" | "knowledge_workspace" | "intelligence" | "admin";

function employeeChatPath(): string {
  return getAklConfig().webProfile === "chat" ? "/" : "/chat";
}

export function requirePageAccess(context: ApiRequestContext, access: PageAccess): void {
  if (access === "employee_chat" && canUseEmployeeChat(context)) {
    return;
  }
  if (access === "knowledge_workspace" && canUseKnowledgeWorkspace(context)) {
    return;
  }
  if (access === "intelligence" && canUseIntelligence(context)) {
    return;
  }
  if (access === "admin" && canUseAdminSurface(context)) {
    return;
  }
  redirect(employeeChatPath());
}

export function redirectEmployeeChatOnly(context: ApiRequestContext): void {
  if (isEmployeeChatOnly(context)) {
    redirect(employeeChatPath());
  }
}

export function forbiddenApiResponse(message = "This AKB surface is not available for the current user role."): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: "FORBIDDEN",
        message
      }
    },
    { status: 403 }
  );
}

export function requireApiAccess(context: ApiRequestContext, access: PageAccess): NextResponse | null {
  if (access === "employee_chat" && canUseEmployeeChat(context)) {
    return null;
  }
  if (access === "knowledge_workspace" && canUseKnowledgeWorkspace(context)) {
    return null;
  }
  if (access === "intelligence" && canUseIntelligence(context)) {
    return null;
  }
  if (access === "admin" && canUseAdminSurface(context)) {
    return null;
  }
  return forbiddenApiResponse();
}
