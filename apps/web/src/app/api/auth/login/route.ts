import { NextRequest, NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import {
  buildAuthorizationUrl,
  cookieOptions,
  createState,
  normalizeReturnToForPublicBase,
  OIDC_STATE_COOKIE,
} from "@/lib/auth/oidc";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = getAklConfig();
  const returnTo = normalizeReturnToForPublicBase(
    config,
    request.nextUrl.searchParams.get("return_to"),
  );
  const state = createState(returnTo);
  const response = NextResponse.redirect(buildAuthorizationUrl(config, state));
  response.cookies.set(OIDC_STATE_COOKIE, state, { ...cookieOptions(config), maxAge: 60 * 10 });
  return response;
}
