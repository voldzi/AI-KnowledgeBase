import { NextRequest, NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import { getOptionalServerOidcSession } from "@/lib/api/server";
import { canUseAdminSurface } from "@/lib/auth/authorization";
import { contextFromOidcSession } from "@/lib/auth/oidc";
import { openRolePreview, ROLE_PREVIEW_COOKIE, ROLE_PREVIEW_PROFILES } from "@/lib/auth/role-preview";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = getAklConfig();

  if (config.authMode === "oidc") {
    const session = await getOptionalServerOidcSession(request);
    if (!session) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }
    const actualContext = contextFromOidcSession(session);
    const preview = openRolePreview(request.cookies.get(ROLE_PREVIEW_COOKIE)?.value, config);
    const activePreview = preview?.subjectId === session.subjectId && canUseAdminSurface(actualContext) ? preview : null;
    return NextResponse.json({
      authenticated: true,
      user: {
        subjectId: session.subjectId,
        name: session.name ?? session.email ?? session.subjectId,
        email: session.email,
        roles: activePreview?.roles ?? session.roles,
        actualRoles: session.roles,
        groups: session.groups
      },
      rolePreview: {
        canUse: canUseAdminSurface(actualContext),
        active: Boolean(activePreview),
        profileId: activePreview?.profileId ?? "",
        label: activePreview?.label ?? "",
        roles: activePreview?.roles ?? [],
        profiles: ROLE_PREVIEW_PROFILES
      }
    });
  }

  const mockRoles = (process.env.AKL_WEB_DEV_ROLES ?? "admin,document_manager,reader")
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
  const mockSubjectId = process.env.AKL_WEB_DEV_SUBJECT ?? "user_dev";
  const mockContext = { subjectId: mockSubjectId, roles: mockRoles };
  const preview = openRolePreview(request.cookies.get(ROLE_PREVIEW_COOKIE)?.value, config);
  const activePreview = preview?.subjectId === mockSubjectId && canUseAdminSurface(mockContext) ? preview : null;

  return NextResponse.json({
    authenticated: true,
    user: {
      subjectId: mockSubjectId,
      name: process.env.AKL_WEB_DEV_NAME ?? "AKL Dev User",
      email: process.env.AKL_WEB_DEV_EMAIL ?? "dev@akl.local",
      roles: activePreview?.roles ?? mockRoles,
      actualRoles: mockRoles,
      groups: (process.env.AKL_WEB_DEV_GROUPS ?? "")
        .split(",")
        .map((group) => group.trim())
        .filter(Boolean)
    },
    rolePreview: {
      canUse: canUseAdminSurface(mockContext),
      active: Boolean(activePreview),
      profileId: activePreview?.profileId ?? "",
      label: activePreview?.label ?? "",
      roles: activePreview?.roles ?? [],
      profiles: ROLE_PREVIEW_PROFILES
    }
  });
}
