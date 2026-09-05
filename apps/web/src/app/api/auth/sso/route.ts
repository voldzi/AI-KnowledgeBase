import { NextRequest, NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import {
  normalizeReturnToForPublicBase,
} from "@/lib/auth/oidc";
import { SERVER_SESSION_COOKIE } from "@/lib/auth/server-session";
import { automaticSsoBlocked, beginOidcNavigation, manualLoginUrl } from "@/lib/auth/login-navigation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = getAklConfig();
  const returnTo = normalizeReturnToForPublicBase(
    config,
    request.nextUrl.searchParams.get("return_to"),
  );
  if (automaticSsoBlocked(request)) return NextResponse.redirect(manualLoginUrl(config, returnTo), { status: 303, headers: { "cache-control": "no-store" } });
  return beginOidcNavigation(config, returnTo, request.cookies.has(SERVER_SESSION_COOKIE) ? "silent" : "interactive");
}
