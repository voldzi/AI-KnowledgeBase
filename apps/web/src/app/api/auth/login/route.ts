import { NextRequest, NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import {
  buildAuthorizationUrl,
  cookieOptions,
  createPkceVerifier,
  createState,
  normalizeReturnToForPublicBase,
  OIDC_STATE_COOKIE,
  OIDC_PKCE_COOKIE,
} from "@/lib/auth/oidc";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = getAklConfig();
  const returnTo = normalizeReturnToForPublicBase(
    config,
    request.nextUrl.searchParams.get("return_to"),
  );
  const state = createState(returnTo);
  const codeVerifier = createPkceVerifier();
  const response = NextResponse.redirect(
    buildAuthorizationUrl(config, state, codeVerifier),
  );
  response.cookies.set(OIDC_STATE_COOKIE, state, { ...cookieOptions(config), maxAge: 60 * 10 });
  response.cookies.set(OIDC_PKCE_COOKIE, codeVerifier, {
    ...cookieOptions(config),
    maxAge: 60 * 10,
  });
  return response;
}
