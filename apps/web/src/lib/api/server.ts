import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import type { ApiRequestContext } from "@/lib/types";

import { createApiClients } from ".";
import { getAklConfig } from "./config";
import { createMockContext } from "./correlation";
import {
  buildPublicAppUrl,
  type OidcSession,
} from "../auth/oidc";
import {
  CENTRAL_SSO_SYNC_COOKIE,
  hasCurrentCentralSsoSyncMarker,
  resolveServerSession,
  serverSessionCookieOptions,
  SERVER_SESSION_COOKIE,
  type ResolvedServerSession,
} from "../auth/server-session";
import { contextFromStratosAccessProjection } from "../auth/access-projection";
import { isSameAppRscNavigation } from "../auth/login-navigation";

export {
  getStratosActorRequestContext,
  requireStratosActorSubjectMatch,
} from "../stratos/actor-authorization";

type RequestLike = Request & {
  cookies?: {
    get(name: string): { value: string } | undefined;
  };
  nextUrl?: URL;
};

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

const requestOidcSessions = new WeakMap<object, Promise<ResolvedServerSession | null>>();
const requestContexts = new WeakMap<object, Promise<ApiRequestContext | null>>();
// React cache is scoped to the current server render, not a cross-request TTL.
const renderSession = cache(() => resolveOptionalServerOidcSession());
const renderContext = cache(() => resolveOptionalServerRequestContext());

export function getServerApiClients() {
  return createApiClients();
}

export async function getServerRequestContext(): Promise<ApiRequestContext> {
  const context = await getOptionalServerRequestContext();
  if (context) {
    return context;
  }

  const config = getAklConfig();
  redirect(buildPublicAppUrl(config, "/api/auth/sso"));
}

export async function getServerRequestContextForPath(
  returnTo: string,
): Promise<ApiRequestContext> {
  await requireCurrentCentralSso(returnTo);
  const context = await getOptionalServerRequestContext();
  if (context) {
    return context;
  }

  const config = getAklConfig();
  redirect(
    buildPublicAppUrl(
      config,
      `/api/auth/sso?return_to=${encodeURIComponent(returnTo)}`,
    ),
  );
}

async function requireCurrentCentralSso(returnTo: string): Promise<void> {
  const config = getAklConfig();
  if (config.authMode !== "oidc") return;

  const cookieStore = await cookies();
  const selector = cookieStore.get(SERVER_SESSION_COOKIE)?.value;
  // Internal RSC refreshes cannot complete a browser OIDC redirect. This only
  // skips entry synchronization; the session and access projection below still
  // have to authorize every request, including forged transport metadata.
  if (selector && isSameAppRscNavigation(config, await headers())) return;
  if (
    selector &&
    await hasCurrentCentralSsoSyncMarker(
      config,
      selector,
      cookieStore.get(CENTRAL_SSO_SYNC_COOKIE)?.value,
    )
  ) {
    return;
  }

  redirect(
    buildPublicAppUrl(
      config,
      `/api/auth/sso?return_to=${encodeURIComponent(returnTo)}`,
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
      `/api/auth/sso?return_to=${encodeURIComponent(returnTo)}`,
    ),
  );
}

export async function getOptionalServerRequestContext(
  request?: RequestLike,
): Promise<ApiRequestContext | null> {
  if (!request) return renderContext();
  const pending = requestContexts.get(request);
  if (pending) return pending;
  const resolved = resolveOptionalServerRequestContext(request);
  requestContexts.set(request, resolved);
  return resolved;
}

async function resolveOptionalServerRequestContext(request?: RequestLike): Promise<ApiRequestContext | null> {
  const bearerToken = bearerTokenFromRequest(request);
  if (bearerToken) {
    return contextFromStratosAccessProjection(bearerToken, getAklConfig());
  }

  const session = await getOptionalServerOidcSession(request);
  if (session) {
    if (!session.accessToken) return null;
    return contextFromStratosAccessProjection(session.accessToken, getAklConfig());
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
    capabilities: (process.env.AKL_WEB_DEV_CAPABILITIES ?? "")
      .split(",")
      .map((capability) => capability.trim())
      .filter(Boolean),
    scopes: (process.env.AKL_WEB_DEV_SCOPES ?? "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
    organizationId: process.env.AKL_WEB_DEV_ORGANIZATION_ID ?? "org_stratos",
    identityActive: true,
    membershipActive: true,
    applicationAccessActive: true,
    authorizationSource: "mock",
    accessToken: config.devAccessToken,
  });
}

export async function getOptionalServerOidcSession(
  request?: RequestLike,
): Promise<OidcSession | null> {
  return (await getOptionalResolvedServerSession(request))?.oidc ?? null;
}

export async function getOptionalResolvedServerSession(request?: RequestLike): Promise<ResolvedServerSession | null> {
  if (request) {
    const pending = requestOidcSessions.get(request);
    if (pending) return pending;
    const resolved = resolveOptionalServerOidcSession(request);
    requestOidcSessions.set(request, resolved);
    return resolved;
  }
  return renderSession();
}

async function resolveOptionalServerOidcSession(
  request?: RequestLike,
): Promise<ResolvedServerSession | null> {
  const config = getAklConfig();
  if (config.authMode !== "oidc") {
    return null;
  }
  const cookieStore = request
    ? cookieReaderFromRequest(request)
    : await cookies();
  const selector = cookieStore.get(SERVER_SESSION_COOKIE)?.value;
  if (!selector) return null;
  const resolved = await resolveServerSession(config, selector);
  if (resolved && request) {
    try {
      // Route handlers propagate a policy downgrade to the browser immediately.
      (await cookies()).set(SERVER_SESSION_COOKIE, selector, serverSessionCookieOptions(config, resolved.persistent, resolved.absoluteExpiresAt));
    } catch {
      // Read-only rendering cannot set cookies; /api/auth/session synchronizes
      // them. Server expiry and revocation remain authoritative in either case.
    }
  }
  return resolved;
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
