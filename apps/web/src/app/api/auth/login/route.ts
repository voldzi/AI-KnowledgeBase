import { NextRequest, NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import {
  buildAuthorizationUrl,
  createPkceVerifier,
  createState,
  normalizeReturnToForPublicBase,
  OIDC_STATE_COOKIE,
  OIDC_PKCE_COOKIE,
} from "@/lib/auth/oidc";
import { serverSessionCookieOptions } from "@/lib/auth/server-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = getAklConfig();
  const returnTo = normalizeReturnToForPublicBase(
    config,
    request.nextUrl.searchParams.get("return_to"),
  );
  return new NextResponse(loginPage(request.nextUrl.pathname, returnTo), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

export async function POST(request: NextRequest) {
  const config = getAklConfig();
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: { code: "AUTH_ORIGIN_REJECTED", message: "Přihlášení z tohoto zdroje není povoleno." } }, { status: 403 });
  }
  const form = await request.formData();
  const returnTo = normalizeReturnToForPublicBase(config, String(form.get("return_to") ?? "/"));
  const remember = form.get("remember") === "on";
  const state = createState(returnTo, remember);
  const codeVerifier = createPkceVerifier();
  const response = NextResponse.redirect(
    buildAuthorizationUrl(config, state, codeVerifier),
  );
  const temporaryCookieOptions = { ...serverSessionCookieOptions(config, false), maxAge: 60 * 10 };
  response.cookies.set(OIDC_STATE_COOKIE, state, temporaryCookieOptions);
  response.cookies.set(OIDC_PKCE_COOKIE, codeVerifier, {
    ...temporaryCookieOptions,
  });
  return response;
}

function loginPage(action: string, returnTo: string): string {
  const safeAction = escapeHtml(action);
  const safeReturnTo = escapeHtml(returnTo);
  return `<!doctype html><html lang="cs"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Přihlášení do AKB</title><style>body{margin:0;background:#f4f8f8;color:#14242a;font:16px system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.panel{width:min(420px,calc(100% - 32px));background:#fff;border:1px solid #cbdadc;padding:28px;box-sizing:border-box}.brand{font-size:14px;font-weight:700;color:#087f8c}.panel h1{font-size:28px;margin:8px 0}.hint{color:#53666c;line-height:1.5}.remember{display:flex;gap:12px;align-items:flex-start;margin:24px 0}.remember input{width:20px;height:20px;margin-top:2px}.remember small{display:block;color:#62747a;margin-top:5px;line-height:1.4}button{width:100%;border:0;background:#087f8c;color:#fff;padding:13px 18px;font-weight:700;font-size:16px;cursor:pointer}button:hover{background:#066a75}</style></head><body><main class="panel"><div class="brand">AI KnowledgeBase</div><h1>Přihlášení do AKB</h1><p class="hint">Pokračujte prostřednictvím jednotného přihlášení STRATOS.</p><form method="post" action="${safeAction}"><input type="hidden" name="return_to" value="${safeReturnTo}"><label class="remember"><input type="checkbox" name="remember"><span><strong>Zůstat přihlášen na tomto zařízení</strong><small>Až 90 dní; používejte pouze na vlastním nebo spravovaném zařízení.</small></span></label><button type="submit">Pokračovat k přihlášení</button></form></main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
