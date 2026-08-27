import { NextRequest, NextResponse } from "next/server";
import type { AklConfig } from "@/lib/api/config";
import { buildPublicAppUrl, createPkceVerifier, createState, OIDC_PKCE_COOKIE, OIDC_STATE_COOKIE, resolveAuthorizationUrl, type OidcAuthorizationMode } from "./oidc";
import { serverSessionCookieOptions, SSO_ATTEMPT_COOKIE, SSO_SIGNED_OUT_COOKIE } from "./server-session";

export function automaticSsoBlocked(request: NextRequest): boolean {
  return request.nextUrl.searchParams.get("retry") === "required" || request.cookies.has(SSO_ATTEMPT_COOKIE) || request.cookies.has(SSO_SIGNED_OUT_COOKIE);
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
