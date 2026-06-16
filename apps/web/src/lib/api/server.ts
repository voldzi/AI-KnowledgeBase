import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { ApiRequestContext } from "@/lib/types";

import { createApiClients } from ".";
import { getAklConfig } from "./config";
import { createMockContext } from "./correlation";
import { buildPublicAppUrl, contextFromOidcAccessToken, contextFromOidcSession, readSessionCookie } from "../auth/oidc";

export function getServerApiClients() {
  return createApiClients();
}

function mockRequestContext(): ApiRequestContext {
  const config = getAklConfig();
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

function bearerTokenFromRequest(request: Request | undefined): string | null {
  const authorization = request?.headers.get("authorization") ?? "";
  const [scheme, token] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token.trim() : null;
}

export async function getOptionalServerRequestContext(request?: Request): Promise<ApiRequestContext | null> {
  const config = getAklConfig();

  if (config.authMode === "oidc") {
    const bearerToken = bearerTokenFromRequest(request);
    if (bearerToken) {
      try {
        return contextFromOidcAccessToken(bearerToken);
      } catch {
        return null;
      }
    }

    const session = readSessionCookie(await cookies(), config);
    if (session) {
      return contextFromOidcSession(session);
    }

    return null;
  }

  return mockRequestContext();
}

export async function getServerRequestContext(): Promise<ApiRequestContext> {
  const context = await getOptionalServerRequestContext();
  if (context) return context;

  const config = getAklConfig();
  redirect(buildPublicAppUrl(config, "/api/auth/login"));
}

export async function getServerRequestContextForPath(returnTo: string): Promise<ApiRequestContext> {
  const context = await getOptionalServerRequestContext();
  if (context) return context;

  const config = getAklConfig();
  redirect(buildPublicAppUrl(config, `/api/auth/login?return_to=${encodeURIComponent(normalizeReturnTo(returnTo))}`));
}

export async function getServerRequestContextForRequest(request: Request): Promise<ApiRequestContext> {
  const context = await getOptionalServerRequestContext(request);
  if (context) return context;

  const config = getAklConfig();
  redirect(buildPublicAppUrl(config, "/api/auth/login"));
}

function normalizeReturnTo(returnTo: string): string {
  return returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
}
