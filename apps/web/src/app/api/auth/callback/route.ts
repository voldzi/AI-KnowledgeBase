import { NextRequest, NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import {
  exchangeAuthorizationCode,
  OIDC_ACCESS_COOKIE,
  OIDC_REFRESH_COOKIE,
  OIDC_SESSION_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_PKCE_COOKIE,
  buildPublicAppUrl,
  normalizeReturnToForPublicBase,
  safeReturnToFromState,
  parseState,
  sessionFromTokens
} from "@/lib/auth/oidc";
import {
  createServerSession,
  serverSessionCookieOptions,
  SERVER_SESSION_COOKIE,
} from "@/lib/auth/server-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = getAklConfig();
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(OIDC_STATE_COOKIE)?.value;
  const codeVerifier = request.cookies.get(OIDC_PKCE_COOKIE)?.value;
  const returnTo = normalizeReturnToForPublicBase(
    config,
    safeReturnToFromState(state, "/"),
  );

  if (!state || state !== expectedState || !codeVerifier) {
    console.warn("OIDC callback rejected due to invalid state.");
    return redirectToLogin(config, returnTo);
  }

  let parsedState;
  try {
    parsedState = parseState(state);
    if (!parsedState.nonce) throw new Error("Missing state nonce.");
  } catch {
    console.warn("OIDC callback rejected due to malformed state.");
    return redirectToLogin(config, returnTo);
  }

  if (error) {
    if (parsedState.mode === "silent") {
      console.info("Silent STRATOS SSO requires interactive authentication.");
    } else {
      console.warn("Interactive OIDC authorization was not completed.");
    }
    return redirectToLogin(config, returnTo);
  }

  if (!code) {
    console.warn("OIDC callback rejected because the authorization code is missing.");
    return redirectToLogin(config, returnTo);
  }

  let tokens;
  try {
    tokens = await exchangeAuthorizationCode(config, code, codeVerifier);
  } catch {
    console.error("OIDC callback token exchange failed.");
    return redirectToLogin(config, returnTo);
  }

  const session = sessionFromTokens(tokens);
  const persistent = parsedState.remember;
  let selector: string;
  try {
    selector = await createServerSession(config, session, persistent);
  } catch {
    console.error("OIDC callback could not create a server session.");
    return redirectToLogin(config, returnTo);
  }
  const response = redirectTo(buildPublicAppUrl(config, returnTo));
  response.cookies.delete(OIDC_STATE_COOKIE);
  response.cookies.delete(OIDC_PKCE_COOKIE);
  response.cookies.set(SERVER_SESSION_COOKIE, selector, serverSessionCookieOptions(config, persistent));
  response.cookies.delete(OIDC_ACCESS_COOKIE);
  response.cookies.delete(OIDC_REFRESH_COOKIE);
  return response;
}

function redirectToLogin(config: ReturnType<typeof getAklConfig>, returnTo: string) {
  const loginUrl = buildPublicAppUrl(config, `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`);
  const response = redirectTo(loginUrl);
  response.cookies.delete(OIDC_STATE_COOKIE);
  response.cookies.delete(OIDC_PKCE_COOKIE);
  response.cookies.delete(OIDC_SESSION_COOKIE);
  response.cookies.delete(OIDC_ACCESS_COOKIE);
  response.cookies.delete(OIDC_REFRESH_COOKIE);
  return response;
}

function redirectTo(targetUrl: string) {
  const response = NextResponse.redirect(targetUrl, 303);
  response.headers.set("cache-control", "no-store, max-age=0");
  return response;
}
