import { NextRequest, NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import { getOptionalServerRequestContext } from "@/lib/api/server";
import { isAllowedPublicOrigin } from "@/lib/auth/oidc";
import {
  listSubjectSessions,
  resolveServerSession,
  revokeAllSubjectSessions,
  revokeSubjectSession,
  SERVER_SESSION_COOKIE,
  serverSessionCookieOptions,
} from "@/lib/auth/server-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const current = await currentSession(request);
  if (!current) return unauthorized();
  const devices = await listSubjectSessions(current.config, current.subjectId);
  return NextResponse.json({
    sessions: devices.map((device) => ({
      ...device,
      current: device.sessionId === current.sessionId,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: NextRequest) {
  const config = getAklConfig();
  if (!isAllowedPublicOrigin(config, request.headers.get("origin"))) {
    return NextResponse.json({ error: { code: "AUTH_ORIGIN_REJECTED", message: "Požadavek z tohoto zdroje není povolen." } }, { status: 403 });
  }
  const current = await currentSession(request, config);
  if (!current) return unauthorized();
  const body = await request.json().catch(() => ({})) as { session_id?: string; all?: boolean };
  const revokeAll = body.all === true;
  const target = body.session_id;
  if (!revokeAll && !target) {
    return NextResponse.json({ error: { code: "SESSION_TARGET_REQUIRED", message: "Vyberte relaci, kterou chcete odvolat." } }, { status: 400 });
  }
  const ok = revokeAll
    ? await revokeAllSubjectSessions(current.config, current.subjectId)
    : await revokeSubjectSession(current.config, current.subjectId, target!);
  if (!ok) {
    return NextResponse.json({ error: { code: "SESSION_REVOCATION_FAILED", message: "Relaci se nepodařilo odvolat." } }, { status: 503 });
  }
  const response = new NextResponse(null, { status: 204 });
  if (revokeAll || target === current.sessionId) {
    response.cookies.set(SERVER_SESSION_COOKIE, "", {
      ...serverSessionCookieOptions(current.config, false),
      maxAge: 0,
    });
  }
  return response;
}

async function currentSession(
  request: NextRequest,
  config = getAklConfig(),
) {
  const context = await getOptionalServerRequestContext(request);
  const selector = request.cookies.get(SERVER_SESSION_COOKIE)?.value;
  if (!context || !selector) return null;
  const resolved = await resolveServerSession(config, selector);
  if (!resolved || resolved.oidc.subjectId !== context.subjectId) return null;
  return {
    config,
    subjectId: context.subjectId,
    sessionId: resolved.internalSessionId,
  };
}

function unauthorized() {
  return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: "Přihlášení je vyžadováno." } }, { status: 401 });
}
