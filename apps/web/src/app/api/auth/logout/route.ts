import { NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import {
  buildLogoutUrl,
  OIDC_ACCESS_COOKIE,
  OIDC_REFRESH_COOKIE,
  OIDC_SESSION_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_PKCE_COOKIE,
} from "@/lib/auth/oidc";

export const runtime = "nodejs";

export async function GET() {
  const config = getAklConfig();
  const response = NextResponse.redirect(buildLogoutUrl(config));
  response.cookies.delete(OIDC_ACCESS_COOKIE);
  response.cookies.delete(OIDC_REFRESH_COOKIE);
  response.cookies.delete(OIDC_SESSION_COOKIE);
  response.cookies.delete(OIDC_STATE_COOKIE);
  response.cookies.delete(OIDC_PKCE_COOKIE);
  return response;
}
