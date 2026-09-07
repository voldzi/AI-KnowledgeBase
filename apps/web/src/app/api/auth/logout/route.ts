import { authCookieNames } from "@/lib/auth/cookies";
import { NextRequest, NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import {
  resolveLogoutUrl,
  revokeOidcRefreshToken,
  buildPublicAppUrl,
  isAllowedAuthNavigationRequestOrigin,
} from "@/lib/auth/oidc";
import {
  revokeServerSession,
  serverSessionCookieOptions,
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
  const selector = request.cookies.get(authCookieNames(config.webProfile).session)?.value;
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
  const expired = { ...serverSessionCookieOptions(config, false), maxAge: 0 };
  response.cookies.set(authCookieNames(config.webProfile).state, "", expired);
  response.cookies.set(authCookieNames(config.webProfile).pkce, "", expired);
  response.cookies.set(authCookieNames(config.webProfile).sync, "", expired);
  // Preserve the opaque selector on a store outage so a retry can revoke it.
  if (!revocationFailed) {
    response.cookies.set(authCookieNames(config.webProfile).session, "", expired);
    response.cookies.set(authCookieNames(config.webProfile).signedOut, "1", serverSessionCookieOptions(config, false));
  }
  response.headers.set("cache-control", "no-store");
  return response;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
