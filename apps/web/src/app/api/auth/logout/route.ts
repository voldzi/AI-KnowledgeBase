import { NextRequest, NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import {
  resolveLogoutUrl,
  revokeOidcRefreshToken,
  buildPublicAppUrl,
  isAllowedAuthNavigationRequestOrigin,
  OIDC_ACCESS_COOKIE,
  OIDC_REFRESH_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_PKCE_COOKIE,
} from "@/lib/auth/oidc";
import {
  CENTRAL_SSO_SYNC_COOKIE,
  revokeServerSession,
  serverSessionCookieOptions,
  SERVER_SESSION_COOKIE,
  SSO_SIGNED_OUT_COOKIE,
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
  let session = null;
  let revocationFailed = false;
  try {
    session = selector ? await revokeServerSession(config, selector) : null;
  } catch {
    revocationFailed = true;
  }
  if (session?.refreshToken) {
    await revokeOidcRefreshToken(config, session).catch(() => undefined);
  }
  const response = revocationFailed ? NextResponse.json({ error: { code: "SESSION_REVOCATION_UNAVAILABLE", message: "Relaci se nepodařilo odvolat. Zkuste odhlášení znovu." } }, { status: 503 }) : NextResponse.redirect(
    await resolveLogoutUrl(config).catch(() => buildPublicAppUrl(config, "/api/auth/login?retry=required")),
    303,
  );
  response.cookies.delete(OIDC_ACCESS_COOKIE);
  response.cookies.delete(OIDC_REFRESH_COOKIE);
  const expired = { ...serverSessionCookieOptions(config, false), maxAge: 0 };
  response.cookies.set(OIDC_STATE_COOKIE, "", expired);
  response.cookies.set(OIDC_PKCE_COOKIE, "", expired);
  response.cookies.set(CENTRAL_SSO_SYNC_COOKIE, "", expired);
  // Preserve the opaque selector on a store outage so a retry can revoke it.
  if (!revocationFailed) {
    response.cookies.set(SERVER_SESSION_COOKIE, "", expired);
    response.cookies.set(SSO_SIGNED_OUT_COOKIE, "1", serverSessionCookieOptions(config, false));
  }
  response.headers.set("cache-control", "no-store");
  return response;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
