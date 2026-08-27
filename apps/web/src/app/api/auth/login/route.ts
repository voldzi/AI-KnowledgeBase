import { NextRequest, NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import {
  buildPublicAppUrl,
  isAllowedAuthNavigationRequestOrigin,
  normalizeReturnToForPublicBase,
  requireOidcConfig,
} from "@/lib/auth/oidc";
import { serverSessionCookieOptions, SSO_SIGNED_OUT_COOKIE } from "@/lib/auth/server-session";
import { automaticSsoBlocked, beginOidcNavigation } from "@/lib/auth/login-navigation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = getAklConfig();
  const oidcAuthorizationOrigin = new URL(
    requireOidcConfig(config).issuer,
  ).origin;
  const returnTo = normalizeReturnToForPublicBase(
    config,
    request.nextUrl.searchParams.get("return_to"),
  );
  if (!automaticSsoBlocked(request)) return beginOidcNavigation(config, returnTo);
  return new NextResponse(
    loginPage(buildPublicAppUrl(config, "/api/auth/login"), returnTo),
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${oidcAuthorizationOrigin}; base-uri 'none'; frame-ancestors 'none'`,
      },
    },
  );
}

export async function POST(request: NextRequest) {
  const config = getAklConfig();
  if (!isAllowedAuthNavigationRequestOrigin(config, request.headers)) {
    return NextResponse.json({ error: { code: "AUTH_ORIGIN_REJECTED", message: "Přihlášení z tohoto zdroje není povoleno." } }, { status: 403 });
  }
  const form = await request.formData();
  const returnTo = normalizeReturnToForPublicBase(config, String(form.get("return_to") ?? "/"));
  const response = await beginOidcNavigation(config, returnTo);
  response.cookies.set(SSO_SIGNED_OUT_COOKIE, "", { ...serverSessionCookieOptions(config, false), maxAge: 0 });
  return response;
}

function loginPage(action: string, returnTo: string): string {
  const safeAction = escapeHtml(action);
  const safeReturnTo = escapeHtml(returnTo);
  return `<!doctype html><html lang="cs"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Přihlášení do AKB</title><style>body{margin:0;background:#f4f8f8;color:#14242a;font:16px system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.panel{width:min(420px,calc(100% - 32px));background:#fff;border:1px solid #cbdadc;padding:28px;box-sizing:border-box}.brand{font-size:14px;font-weight:700;color:#087f8c}.panel h1{font-size:28px;margin:8px 0}.hint{color:#53666c;line-height:1.5}button{width:100%;border:0;background:#087f8c;color:#fff;padding:13px 18px;font-weight:700;font-size:16px;cursor:pointer}button:hover{background:#066a75}</style></head><body><main class="panel"><div class="brand">AI KnowledgeBase</div><h1>Přihlášení do AKB</h1><p class="hint">Relace není aktivní. Přihlášení můžete znovu zahájit přes centrální SSO.</p><form method="post" action="${safeAction}"><input type="hidden" name="return_to" value="${safeReturnTo}"><button type="submit">Pokračovat k přihlášení</button></form></main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
