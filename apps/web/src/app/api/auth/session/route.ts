import { NextRequest, NextResponse } from "next/server";

import { getAklConfig } from "@/lib/api/config";
import { getOptionalServerOidcSession, getOptionalServerRequestContext } from "@/lib/api/server";
import { canUseAdminSurface } from "@/lib/auth/authorization";
import { openRolePreview, ROLE_PREVIEW_COOKIE, ROLE_PREVIEW_PROFILES } from "@/lib/auth/role-preview";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = getAklConfig();

  if (config.authMode === "oidc") {
    const session = await getOptionalServerOidcSession(request);
    if (!session) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }
    const actualContext = await getOptionalServerRequestContext(request);
    if (!actualContext) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }
    const preview = openRolePreview(request.cookies.get(ROLE_PREVIEW_COOKIE)?.value, config);
    const activePreview = preview?.subjectId === session.subjectId && canUseAdminSurface(actualContext) ? preview : null;
    return NextResponse.json({
      authenticated: true,
      user: {
        subjectId: session.subjectId,
        name: session.name ?? session.email ?? session.subjectId,
        email: session.email,
        roles: activePreview?.roles ?? actualContext.roles ?? [],
        actualRoles: session.roles,
        groups: session.groups,
        capabilities: actualContext.capabilities ?? []
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
        .filter(Boolean),
      capabilities: (process.env.AKL_WEB_DEV_CAPABILITIES ?? "")
        .split(",")
        .map((capability) => capability.trim())
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
