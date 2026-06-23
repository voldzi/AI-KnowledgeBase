import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { ApiRequestContext } from "@/lib/types";

import { createApiClients } from ".";
import { getAklConfig } from "./config";
import { createMockContext } from "./correlation";
import {
  buildPublicAppUrl,
  contextFromOidcAccessToken,
  contextFromOidcSession,
  cookieOptions,
  OIDC_SESSION_COOKIE,
  readSessionCookie,
  refreshOidcSession,
  requireOidcConfig,
  sealSession,
  type OidcSession
} from "../auth/oidc";

const SESSION_REFRESH_SKEW_MS = 60_000;

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

    const session = await getOptionalServerOidcSession(request);
    if (session) {
      return contextFromOidcSession(session);
    }

    return null;
  }

  return mockRequestContext();
}

export async function getOptionalServerOidcSession(request?: Request): Promise<OidcSession | null> {
  const config = getAklConfig();
  if (config.authMode !== "oidc") {
    return null;
  }

  const cookieStore = await cookies();
  const nowMs = Date.now();
  const session = readSessionCookie(cookieStore, config, nowMs);
  const canRefresh = Boolean(request);
  if (session) {
    if (canRefresh && shouldRefreshSession(session, nowMs)) {
      const refreshed = await refreshOidcSession(config, session, nowMs).catch(() => null);
      if (refreshed && writeSessionCookie(cookieStore, config, refreshed)) {
        return refreshed;
      }
    }
    return session;
  }

  if (!canRefresh) {
    return null;
  }

  const expiredSession = readSessionCookie(cookieStore, config, nowMs, { allowExpired: true });
  if (!expiredSession || expiredSession.expiresAt > nowMs) {
    return null;
  }

  const refreshed = await refreshOidcSession(config, expiredSession, nowMs).catch(() => null);
  if (!refreshed) {
    return null;
  }
  writeSessionCookie(cookieStore, config, refreshed);
  return refreshed;
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

function shouldRefreshSession(session: OidcSession, nowMs: number): boolean {
  return Boolean(session.refreshToken) && session.expiresAt - nowMs <= SESSION_REFRESH_SKEW_MS;
}

function writeSessionCookie(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  config: ReturnType<typeof getAklConfig>,
  session: OidcSession
): boolean {
  try {
    const oidc = requireOidcConfig(config);
    cookieStore.set(OIDC_SESSION_COOKIE, sealSession(session, oidc.sessionSecret), cookieOptions(config));
    return true;
  } catch {
    return false;
  }
}
