import { NextRequest, NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import { getOptionalServerOidcSession } from "@/lib/api/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = getAklConfig();

  if (config.authMode === "oidc") {
    const session = await getOptionalServerOidcSession(request);
    if (!session) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }
    return NextResponse.json({
      authenticated: true,
      user: {
        subjectId: session.subjectId,
        name: session.name ?? session.email ?? session.subjectId,
        email: session.email,
        roles: session.roles,
        groups: session.groups
      }
    });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      subjectId: process.env.AKL_WEB_DEV_SUBJECT ?? "user_dev",
      name: process.env.AKL_WEB_DEV_NAME ?? "AKL Dev User",
      email: process.env.AKL_WEB_DEV_EMAIL ?? "dev@akl.local",
      roles: (process.env.AKL_WEB_DEV_ROLES ?? "admin,document_manager,reader")
        .split(",")
        .map((role) => role.trim())
        .filter(Boolean),
      groups: (process.env.AKL_WEB_DEV_GROUPS ?? "")
        .split(",")
        .map((group) => group.trim())
        .filter(Boolean)
    }
  });
}
