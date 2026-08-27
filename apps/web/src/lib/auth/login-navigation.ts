import { NextRequest, NextResponse } from "next/server";
import type { AklConfig } from "@/lib/api/config";
import { buildPublicAppUrl, createPkceVerifier, createState, OIDC_PKCE_COOKIE, OIDC_STATE_COOKIE, resolveAuthorizationUrl, type OidcAuthorizationMode } from "./oidc";
import { serverSessionCookieOptions, SSO_ATTEMPT_COOKIE, SSO_SIGNED_OUT_COOKIE } from "./server-session";

export function automaticSsoBlocked(request: NextRequest): boolean {
  return request.nextUrl.searchParams.get("retry") === "required" || request.cookies.has(SSO_ATTEMPT_COOKIE) || request.cookies.has(SSO_SIGNED_OUT_COOKIE);
}

export function isSameAppRscNavigation(
  config: AklConfig,
  headers: Pick<Headers, "get">,
): boolean {
  if (
    headers.get("rsc") !== "1" ||
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
    response.cookies.set(OIDC_STATE_COOKIE, state, temporary);
    response.cookies.set(OIDC_PKCE_COOKIE, verifier, temporary);
  } catch {
    response = NextResponse.redirect(manualLoginUrl(config, returnTo), 303);
  }
  response.cookies.set(SSO_ATTEMPT_COOKIE, "1", serverSessionCookieOptions(config, false));
  response.headers.set("cache-control", "no-store, max-age=0");
  return response;
}

export function manualLoginUrl(config: AklConfig, returnTo: string): string {
  return buildPublicAppUrl(config, `/api/auth/login?return_to=${encodeURIComponent(returnTo)}&retry=required`);
}
