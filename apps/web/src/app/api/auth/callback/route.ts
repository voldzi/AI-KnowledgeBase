import { NextRequest, NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import {
  cookieOptions,
  exchangeAuthorizationCode,
  OIDC_SESSION_COOKIE,
  OIDC_STATE_COOKIE,
  buildPublicAppUrl,
  requireOidcConfig,
  safeReturnToFromState,
  sealSession,
  sessionFromTokens
} from "@/lib/auth/oidc";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = getAklConfig();
  const oidc = requireOidcConfig(config);
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(OIDC_STATE_COOKIE)?.value;
  const returnTo = safeReturnToFromState(state, "/chat");

  if (!code || !state || state !== expectedState) {
    console.warn("OIDC callback rejected due to invalid state.");
    return redirectToLogin(config, returnTo);
  }

  let tokens;
  try {
    tokens = await exchangeAuthorizationCode(config, code);
  } catch (error) {
    console.error("OIDC callback token exchange failed.", error);
    return redirectToLogin(config, returnTo);
  }

  const session = sessionFromTokens(tokens);
  const response = NextResponse.redirect(buildPublicAppUrl(config, returnTo));
  response.cookies.delete(OIDC_STATE_COOKIE);
  response.cookies.set(OIDC_SESSION_COOKIE, sealSession(session, oidc.sessionSecret), cookieOptions(config));
  return response;
}

function redirectToLogin(config: ReturnType<typeof getAklConfig>, returnTo: string) {
  const loginUrl = buildPublicAppUrl(config, `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`);
  const response = NextResponse.redirect(loginUrl, 303);
  response.cookies.delete(OIDC_STATE_COOKIE);
  response.cookies.delete(OIDC_SESSION_COOKIE);
  return response;
}
