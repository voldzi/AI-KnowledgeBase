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
  readSessionCookie,
  refreshOidcSession,
  type OidcSession,
} from "../auth/oidc";

type RequestLike = Request & {
  cookies?: {
    get(name: string): { value: string } | undefined;
  };
  nextUrl?: URL;
};

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

export function getServerApiClients() {
  return createApiClients();
}

export async function getServerRequestContext(): Promise<ApiRequestContext> {
  const context = await getOptionalServerRequestContext();
  if (context) {
    return context;
  }

  const config = getAklConfig();
  redirect(buildPublicAppUrl(config, "/api/auth/login"));
}

export async function getServerRequestContextForPath(
  returnTo: string,
): Promise<ApiRequestContext> {
  const context = await getOptionalServerRequestContext();
  if (context) {
    return context;
  }

  const config = getAklConfig();
  redirect(
    buildPublicAppUrl(
      config,
      `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`,
    ),
  );
}

export async function getServerRequestContextForRequest(
  request: RequestLike,
): Promise<ApiRequestContext> {
  const context = await getOptionalServerRequestContext(request);
  if (context) {
    return context;
  }

  const config = getAklConfig();
  const requestUrl = request.nextUrl ?? new URL(request.url);
  const returnTo = `${requestUrl.pathname}${requestUrl.search}`;
  redirect(
    buildPublicAppUrl(
      config,
      `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`,
    ),
  );
}

export async function getOptionalServerRequestContext(
  request?: RequestLike,
): Promise<ApiRequestContext | null> {
  const bearerToken = bearerTokenFromRequest(request);
  if (bearerToken) {
    const bearerContext = contextFromOidcAccessToken(bearerToken);
    if (bearerContext) {
      return bearerContext;
    }
  }

  const session = await getOptionalServerOidcSession(request);
  if (session) {
    return contextFromOidcSession(session);
  }

  const config = getAklConfig();
  if (config.authMode === "oidc") {
    return null;
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
    accessToken: config.devAccessToken,
  });
}

export async function getOptionalServerOidcSession(
  request?: RequestLike,
): Promise<OidcSession | null> {
  const config = getAklConfig();
  if (config.authMode !== "oidc") {
    return null;
  }
  const cookieStore = request
    ? cookieReaderFromRequest(request)
    : await cookies();
  const session = readSessionCookie(cookieStore, config);
  return session ? refreshOidcSession(config, session) : null;
}

function cookieReaderFromRequest(request: RequestLike): CookieReader {
  if (request.cookies) {
    return request.cookies;
  }
  const parsedCookies = new Map<string, string>();
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) {
      continue;
    }
    parsedCookies.set(rawName, decodeURIComponent(rawValue.join("=")));
  }
  return {
    get(name: string) {
      const value = parsedCookies.get(name);
      return value === undefined ? undefined : { value };
    },
  };
}

function bearerTokenFromRequest(request?: RequestLike): string | null {
  const authorization = request?.headers.get("authorization") ?? null;
  if (!authorization) {
    return null;
  }
  const [scheme, token] = authorization.trim().split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token;
}
