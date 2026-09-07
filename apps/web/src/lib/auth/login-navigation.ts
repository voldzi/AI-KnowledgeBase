import { authCookieNames } from "@/lib/auth/cookies";
import { NextRequest, NextResponse } from "next/server";
import type { AklConfig } from "@/lib/api/config";
import { buildPublicAppUrl, createPkceVerifier, createState, resolveAuthorizationUrl, type OidcAuthorizationMode } from "./oidc";
import { serverSessionCookieOptions } from "./server-session";

export function automaticSsoBlocked(config: AklConfig, request: NextRequest): boolean {
  return request.nextUrl.searchParams.get("retry") === "required" || request.cookies.has(authCookieNames(config.webProfile).attempt) || request.cookies.has(authCookieNames(config.webProfile).signedOut);
}

export function isSameAppRscNavigation(
  config: AklConfig,
  headers: Pick<Headers, "get">,
): boolean {
  // Next.js removes Flight headers, including rsc, before headers() reaches
  // server components. Fetch Metadata survives that normalization.
  if (
    headers.get("sec-fetch-site") !== "same-origin" ||
    headers.get("sec-fetch-dest") !== "empty" ||
    !["cors", "same-origin"].includes(headers.get("sec-fetch-mode") ?? "")
  ) return false;

  try {
    const app = new URL(buildPublicAppUrl(config, "/"));
    const origin = headers.get("origin");
    if (origin !== null && origin !== app.origin) return false;
    const rawReferer = headers.get("referer");
    // AKB's no-referrer policy omits this even for same-origin router.refresh().
    // Fetch Metadata classifies transport; the caller still validates the session.
    if (rawReferer === null) return true;
    const referer = new URL(rawReferer);
    const basePath = app.pathname.replace(/\/+$/, "");
    return (
      referer.origin === app.origin &&
      !referer.username && !referer.password &&
      (!basePath || referer.pathname === basePath || referer.pathname.startsWith(`${basePath}/`))
    );
  } catch {
    return false;
  }
}

export async function beginOidcNavigation(config: AklConfig, returnTo: string, mode: OidcAuthorizationMode = "interactive"): Promise<NextResponse> {
  const state = createState(returnTo, false, mode);
  const verifier = createPkceVerifier();
  let response: NextResponse;
  try {
    response = NextResponse.redirect(await resolveAuthorizationUrl(config, state, verifier, mode), 303);
    const temporary = { ...serverSessionCookieOptions(config, false), maxAge: 600 };
    response.cookies.set(authCookieNames(config.webProfile).state, state, temporary);
    response.cookies.set(authCookieNames(config.webProfile).pkce, verifier, temporary);
  } catch {
    response = NextResponse.redirect(manualLoginUrl(config, returnTo), 303);
  }
  response.cookies.set(authCookieNames(config.webProfile).attempt, "1", serverSessionCookieOptions(config, false));
  response.headers.set("cache-control", "no-store, max-age=0");
  return response;
}

export function manualLoginUrl(config: AklConfig, returnTo: string): string {
  return buildPublicAppUrl(config, `/api/auth/login?return_to=${encodeURIComponent(returnTo)}&retry=required`);
}
