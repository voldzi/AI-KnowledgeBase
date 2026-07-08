import { NextRequest, NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import {
  cookieOptions,
  exchangeAuthorizationCode,
  OIDC_ACCESS_COOKIE,
  OIDC_REFRESH_COOKIE,
  OIDC_SESSION_COOKIE,
  OIDC_STATE_COOKIE,
  buildPublicAppUrl,
  requireOidcConfig,
  safeReturnToFromState,
  sealAccessToken,
  sealBrowserSession,
  sealRefreshToken,
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
  const response = redirectByReplacingLocation(buildPublicAppUrl(config, returnTo));
  response.cookies.delete(OIDC_STATE_COOKIE);
  response.cookies.set(OIDC_SESSION_COOKIE, sealBrowserSession(session, oidc.sessionSecret), cookieOptions(config));
  if (session.accessToken) {
    response.cookies.set(OIDC_ACCESS_COOKIE, sealAccessToken(session.accessToken, oidc.sessionSecret), cookieOptions(config));
  }
  if (session.refreshToken) {
    response.cookies.set(OIDC_REFRESH_COOKIE, sealRefreshToken(session.refreshToken, oidc.sessionSecret), cookieOptions(config));
  }
  return response;
}

function redirectToLogin(config: ReturnType<typeof getAklConfig>, returnTo: string) {
  const loginUrl = buildPublicAppUrl(config, `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`);
  const response = redirectByReplacingLocation(loginUrl);
  response.cookies.delete(OIDC_STATE_COOKIE);
  response.cookies.delete(OIDC_SESSION_COOKIE);
  response.cookies.delete(OIDC_ACCESS_COOKIE);
  response.cookies.delete(OIDC_REFRESH_COOKIE);
  return response;
}

function redirectByReplacingLocation(targetUrl: string) {
  const scriptUrl = JSON.stringify(targetUrl).replace(/</g, "\\u003c");
  const htmlUrl = targetUrl
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return new NextResponse(
    `<!doctype html>
<html lang="cs">
  <head>
    <meta charset="utf-8">
    <meta name="robots" content="noindex">
    <meta http-equiv="refresh" content="0;url=${htmlUrl}">
    <title>AKB</title>
    <script>window.location.replace(${scriptUrl});</script>
  </head>
  <body>
    <a href="${htmlUrl}">Continue to AKB</a>
  </body>
</html>`,
    {
      status: 200,
      headers: {
        "cache-control": "no-store, max-age=0",
        "content-type": "text/html; charset=utf-8"
      }
    }
  );
}
