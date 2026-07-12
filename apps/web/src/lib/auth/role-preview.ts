import crypto from "node:crypto";

import type { AklConfig } from "@/lib/api/config";
import { canUseAdminSurface } from "@/lib/auth/authorization";
import type { ApiRequestContext } from "@/lib/types";

export const ROLE_PREVIEW_COOKIE = "akl_role_preview";
const ROLE_PREVIEW_MAX_AGE_SECONDS = 60 * 60 * 4;

export interface RolePreviewProfile {
  id: string;
  label: string;
  description: string;
  roles: string[];
}

export interface RolePreviewState {
  profileId: string;
  label: string;
  roles: string[];
  subjectId: string;
  issuedAt: number;
  expiresAt: number;
}

export const ROLE_PREVIEW_PROFILES: RolePreviewProfile[] = [
  {
    id: "employee",
    label: "Běžný zaměstnanec",
    description: "Vidí pouze zaměstnanecký chat a informace dostupné podle oprávnění.",
    roles: ["reader", "stratos_user", "akb_user"]
  },
  {
    id: "gestor",
    label: "Gestor dokumentu",
    description: "Spravuje svěřené dokumenty a jejich verze bez administrace.",
    roles: ["document_gestor", "reader"]
  },
  {
    id: "reviewer",
    label: "Reviewer",
    description: "Kontroluje dokumenty a úkoly před schválením.",
    roles: ["reviewer", "reader"]
  },
  {
    id: "auditor",
    label: "Auditor",
    description: "Vidí dohledové a auditní pohledy podle oprávnění.",
    roles: ["auditor", "reader"]
  },
  {
    id: "analyst",
    label: "Analytik",
    description: "Pracuje s inteligentním hledáním, entitami, vazbami a analytickými spisy.",
    roles: ["analyst", "reader"]
  },
  {
    id: "manager",
    label: "Správce dokumentů",
    description: "Zakládá dokumenty, nahrává verze a řeší provozní workflow.",
    roles: ["document_manager", "document_owner", "reader"]
  },
  {
    id: "admin",
    label: "Admin AKB",
    description: "Plný aplikační pohled včetně administrace.",
    roles: ["admin", "document_manager", "document_owner", "auditor", "reader"]
  }
];

export function getRolePreviewProfile(profileId: string): RolePreviewProfile | undefined {
  return ROLE_PREVIEW_PROFILES.find((profile) => profile.id === profileId);
}

export function createRolePreview(profileId: string, subjectId: string, nowMs = Date.now()): RolePreviewState | null {
  const profile = getRolePreviewProfile(profileId);
  if (!profile) {
    return null;
  }
  return {
    profileId: profile.id,
    label: profile.label,
    roles: profile.roles,
    subjectId,
    issuedAt: nowMs,
    expiresAt: nowMs + ROLE_PREVIEW_MAX_AGE_SECONDS * 1000
  };
}

export function rolePreviewCookieOptions(config: AklConfig) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.environment === "production",
    path: "/",
    maxAge: ROLE_PREVIEW_MAX_AGE_SECONDS
  };
}

export function sealRolePreview(preview: RolePreviewState, config: AklConfig): string {
  const payload = Buffer.from(JSON.stringify(preview), "utf8").toString("base64url");
  return `${payload}.${sign(payload, rolePreviewSecret(config))}`;
}

export function openRolePreview(value: string | undefined, config: AklConfig, nowMs = Date.now()): RolePreviewState | null {
  if (!value) {
    return null;
  }
  const [payload, signature] = value.split(".");
  if (!payload || !signature || !verifySignature(payload, signature, rolePreviewSecret(config))) {
    return null;
  }
  try {
    const preview = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as RolePreviewState;
    if (!preview.subjectId || !preview.profileId || !Array.isArray(preview.roles) || preview.expiresAt <= nowMs) {
      return null;
    }
    return preview;
  } catch {
    return null;
  }
}

export function applyRolePreviewToContext(
  context: ApiRequestContext,
  preview: RolePreviewState | null
): { context: ApiRequestContext; preview: RolePreviewState | null } {
  if (!preview || preview.subjectId !== context.subjectId || !canUseAdminSurface(context)) {
    return { context, preview: null };
  }
  return {
    context: {
      ...context,
      roles: preview.roles
    },
    preview
  };
}

function rolePreviewSecret(config: AklConfig): string {
  if (config.oidc?.sessionSecret) {
    return config.oidc.sessionSecret;
  }
  if (config.environment === "production") {
    throw new Error("Role preview requires OIDC session secret in production.");
  }
  return config.devAccessToken ?? "akb-development-role-preview";
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = sign(payload, secret);
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(signature);
  return expectedBytes.length === actualBytes.length && crypto.timingSafeEqual(expectedBytes, actualBytes);
}
