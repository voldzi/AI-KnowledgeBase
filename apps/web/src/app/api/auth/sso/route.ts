import { NextRequest, NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import {
  buildAuthorizationUrl,
  createPkceVerifier,
  createState,
  normalizeReturnToForPublicBase,
  OIDC_PKCE_COOKIE,
  OIDC_STATE_COOKIE,
} from "@/lib/auth/oidc";
import { serverSessionCookieOptions } from "@/lib/auth/server-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = getAklConfig();
  const returnTo = normalizeReturnToForPublicBase(
    config,
    request.nextUrl.searchParams.get("return_to"),
  );
  const state = createState(returnTo, false, "silent");
  const codeVerifier = createPkceVerifier();
  const response = NextResponse.redirect(
    buildAuthorizationUrl(config, state, codeVerifier, "silent"),
    303,
  );
  const temporaryCookieOptions = {
    ...serverSessionCookieOptions(config, false),
    maxAge: 60 * 10,
  };
  response.cookies.set(OIDC_STATE_COOKIE, state, temporaryCookieOptions);
  response.cookies.set(OIDC_PKCE_COOKIE, codeVerifier, temporaryCookieOptions);
  response.headers.set("cache-control", "no-store, max-age=0");
  return response;
}
