import { NextRequest, NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import {
  cookieOptions,
  exchangeAuthorizationCode,
  OIDC_SESSION_COOKIE,
  OIDC_STATE_COOKIE,
  parseState,
  requireOidcConfig,
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

  if (!code || !state || state !== expectedState) {
    return NextResponse.json({ error: "Invalid OIDC callback state." }, { status: 400 });
  }

  const tokens = await exchangeAuthorizationCode(config, code);
  const session = sessionFromTokens(tokens);
  const { returnTo } = parseState(state);
  const response = NextResponse.redirect(new URL(returnTo, request.nextUrl.origin));
  response.cookies.delete(OIDC_STATE_COOKIE);
  response.cookies.set(OIDC_SESSION_COOKIE, sealSession(session, oidc.sessionSecret), cookieOptions(config));
  return response;
}
