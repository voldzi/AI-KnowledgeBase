import { NextRequest, NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import { canUseAdminSurface } from "@/lib/auth/authorization";
import {
  createRolePreview,
  getRolePreviewProfile,
  ROLE_PREVIEW_COOKIE,
  ROLE_PREVIEW_PROFILES,
  rolePreviewCookieOptions,
  sealRolePreview
} from "@/lib/auth/role-preview";
import { getOptionalServerOidcSession, getOptionalServerRequestContext } from "@/lib/api/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const current = await getCurrentSubjectForRolePreview(request);
  if (!current) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Role preview is available only to AKB administrators." } }, { status: 403 });
  }
  return NextResponse.json({
    profiles: ROLE_PREVIEW_PROFILES.map((profile) => ({
      id: profile.id,
      label: profile.label,
      description: profile.description,
      roles: profile.roles
    }))
  });
}

export async function POST(request: NextRequest) {
  const config = getAklConfig();
  const current = await getCurrentSubjectForRolePreview(request);
  if (!current) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Role preview is available only to AKB administrators." } }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { profileId?: unknown };
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const response = NextResponse.json({
    role_preview: profileId
      ? {
          active: true,
          profile: getRolePreviewProfile(profileId)
        }
      : {
          active: false,
          profile: null
        }
  });

  if (!profileId) {
    response.cookies.set(ROLE_PREVIEW_COOKIE, "", { ...rolePreviewCookieOptions(config), maxAge: 0 });
    return response;
  }

  const preview = createRolePreview(profileId, current.subjectId);
  if (!preview) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Unknown role preview profile." } }, { status: 400 });
  }

  response.cookies.set(ROLE_PREVIEW_COOKIE, sealRolePreview(preview, config), rolePreviewCookieOptions(config));
  return response;
}

async function getCurrentSubjectForRolePreview(request: NextRequest): Promise<{ subjectId: string } | null> {
  const config = getAklConfig();
  if (config.authMode === "oidc") {
    const session = await getOptionalServerOidcSession(request);
    const context = session ? await getOptionalServerRequestContext(request) : null;
    if (!session || !context || !canUseAdminSurface(context)) {
      return null;
    }
    return { subjectId: session.subjectId };
  }

  const roles = (process.env.AKL_WEB_DEV_ROLES ?? "admin,document_manager,reader")
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
  if (!canUseAdminSurface({ roles })) {
    return null;
  }
  return { subjectId: process.env.AKL_WEB_DEV_SUBJECT ?? "user_dev" };
}
