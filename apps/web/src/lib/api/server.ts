import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { ApiRequestContext } from "@/lib/types";

import { createApiClients } from ".";
import { getAklConfig } from "./config";
import { createMockContext } from "./correlation";
import { buildPublicAppUrl, contextFromOidcSession, readSessionCookie } from "../auth/oidc";

export function getServerApiClients() {
  return createApiClients();
}

export async function getServerRequestContext(): Promise<ApiRequestContext> {
  const config = getAklConfig();

  if (config.authMode === "oidc") {
    const session = readSessionCookie(await cookies(), config);
    if (!session) {
      redirect(buildPublicAppUrl(config, "/api/auth/login"));
    }
    return contextFromOidcSession(session);
  }

  return createMockContext({
    subjectId: process.env.AKL_WEB_DEV_SUBJECT ?? "user_dev",
    roles: (process.env.AKL_WEB_DEV_ROLES ?? "admin,document_manager,reader")
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean),
    groups: (process.env.AKL_WEB_DEV_GROUPS ?? "")
      .split(",")
      .map((group) => group.trim())
      .filter(Boolean),
    accessToken: config.devAccessToken
  });
}
