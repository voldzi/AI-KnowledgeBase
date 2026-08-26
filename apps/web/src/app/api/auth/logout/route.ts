import { NextRequest, NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import {
  buildLogoutUrl,
  buildPublicAppUrl,
  isAllowedAuthNavigationRequestOrigin,
  OIDC_ACCESS_COOKIE,
  OIDC_REFRESH_COOKIE,
  OIDC_SESSION_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_PKCE_COOKIE,
  requireOidcConfig,
} from "@/lib/auth/oidc";
import {
  CENTRAL_SSO_SYNC_COOKIE,
  revokeServerSession,
  serverSessionCookieOptions,
  SERVER_SESSION_COOKIE,
} from "@/lib/auth/server-session";

export const runtime = "nodejs";

export async function GET() {
  const config = getAklConfig();
  const action = escapeHtml(buildPublicAppUrl(config, "/api/auth/logout"));
  return new NextResponse(`<!doctype html><html lang="cs"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Odhlášení</title></head><body><form method="post" action="${action}"><button type="submit">Odhlásit z AKB</button></form></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'" } });
}

export async function POST(request: NextRequest) {
  const config = getAklConfig();
  if (!isAllowedAuthNavigationRequestOrigin(config, request.headers)) {
    return NextResponse.json({ error: { code: "AUTH_ORIGIN_REJECTED", message: "Odhlášení z tohoto zdroje není povoleno." } }, { status: 403 });
  }
  const selector = request.cookies.get(SERVER_SESSION_COOKIE)?.value;
  const session = selector ? await revokeServerSession(config, selector) : null;
  if (session?.refreshToken) {
    await revokeRefreshToken(config, session.refreshToken).catch(() => undefined);
  }
  const response = NextResponse.redirect(
    buildLogoutUrl(config),
    303,
  );
  response.cookies.delete(OIDC_ACCESS_COOKIE);
  response.cookies.delete(OIDC_REFRESH_COOKIE);
  response.cookies.delete(OIDC_SESSION_COOKIE);
  response.cookies.delete(OIDC_STATE_COOKIE);
  response.cookies.delete(OIDC_PKCE_COOKIE);
  response.cookies.delete(CENTRAL_SSO_SYNC_COOKIE);
  response.cookies.set(SERVER_SESSION_COOKIE, "", { ...serverSessionCookieOptions(config, false), maxAge: 0 });
  return response;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

async function revokeRefreshToken(config: ReturnType<typeof getAklConfig>, refreshToken: string): Promise<void> {
  const oidc = requireOidcConfig(config);
  const body = new URLSearchParams({ token: refreshToken, token_type_hint: "refresh_token", client_id: oidc.clientId });
  if (oidc.clientSecret) body.set("client_secret", oidc.clientSecret);
  await fetch(`${oidc.issuer}/protocol/openid-connect/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(3_000) });
}
