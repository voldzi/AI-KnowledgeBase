import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getAklConfig } from "@/lib/api/config";
import { createMockContext } from "@/lib/api/correlation";
import { getServerApiClients } from "@/lib/api/server";
import {
  canUseAdminSurface,
  canUseEmployeeChat,
  canUseKnowledgeWorkspace,
} from "@/lib/auth/authorization";
import { contextFromOidcSession, readSessionCookie } from "@/lib/auth/oidc";
import { isAklLanguage, type AklLanguage } from "@/lib/language";
import type {
  ApiRequestContext,
  ProfileSettingsBundle,
  ProfileSettingsPutRequest,
  ProfileSettingsResponse,
} from "@/lib/types";

export const runtime = "nodejs";

type SettingsSurfaceMode = "modal" | "sidebar" | "fullscreen";

interface ProfileIdentity {
  subject_id: string;
  display_name: string;
  email: string | null;
  roles: string[];
  groups: string[];
  permissions: string[];
}

const ALLOWED_THEMES = new Set(["system", "light", "dark"]);
const ALLOWED_ACCENTS = new Set([
  "teal",
  "blue",
  "green",
  "amber",
  "rose",
  "purple",
  "slate",
  "indigo",
  "orange",
]);
const ALLOWED_WEEK_START = new Set(["monday", "sunday"]);
const ALLOWED_TIME_FORMAT = new Set(["24h", "12h"]);
const ALLOWED_DATE_FORMAT = new Set(["dd.mm.yyyy", "yyyy-mm-dd", "mm/dd/yyyy"]);
const ALLOWED_SETTINGS_MODES = new Set<SettingsSurfaceMode>([
  "modal",
  "sidebar",
  "fullscreen",
]);

export async function GET() {
  const context = await getOptionalProfileRequestContext();
  if (!context) {
    return NextResponse.json(
      {
        error: { code: "UNAUTHORIZED", message: "Authentication is required." },
      },
      { status: 401 },
    );
  }

  const upstream: ProfileSettingsResponse | Error = await getServerApiClients()
    .registry.getProfileSettings(context)
    .catch((error: unknown) =>
      error instanceof Error
        ? error
        : new Error("Unknown profile settings error"),
    );
  if (upstream instanceof Error) {
    return profileSettingsUpstreamError(upstream);
  }

  const identity = await identityForRequest(context);
  const settings = normalizeSettings(upstream.settings, identity);
  return NextResponse.json({
    subject_id: identity.subject_id,
    settings,
    identity,
  });
}

export async function PUT(request: NextRequest) {
  const context = await getOptionalProfileRequestContext();
  if (!context) {
    return NextResponse.json(
      {
        error: { code: "UNAUTHORIZED", message: "Authentication is required." },
      },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    apps?: unknown;
    core?: unknown;
    settings?: unknown;
  };
  const identity = await identityForRequest(context);
  const requestedSettings = normalizeSettings(
    asSettingsBundle(body.settings ?? body),
    identity,
  );
  const registryPayload: ProfileSettingsPutRequest = {
    settings: settingsForPersistence(requestedSettings),
  };

  const upstream: ProfileSettingsResponse | Error = await getServerApiClients()
    .registry.putProfileSettings(registryPayload, context)
    .catch((error: unknown) =>
      error instanceof Error
        ? error
        : new Error("Unknown profile settings error"),
    );
  if (upstream instanceof Error) {
    return profileSettingsUpstreamError(upstream);
  }

  const settings = normalizeSettings(upstream.settings, identity);
  return NextResponse.json({
    subject_id: identity.subject_id,
    settings,
    identity,
  });
}

async function getOptionalProfileRequestContext(): Promise<ApiRequestContext | null> {
  const config = getAklConfig();

  if (config.authMode === "oidc") {
    const session = readSessionCookie(await cookies(), config);
    return session ? contextFromOidcSession(session) : null;
  }

  return createMockContext({
    subjectId: process.env.AKL_WEB_DEV_SUBJECT ?? "user_dev",
    roles: (process.env.AKL_WEB_DEV_ROLES ?? "admin,document_manager,reader")
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean),
    groups: (process.env.AKL_WEB_DEV_GROUPS ?? "")
      .split(",")
      .map((group) => group.trim())
      .filter(Boolean),
    accessToken: config.devAccessToken,
  });
}

async function identityForRequest(
  context: ApiRequestContext,
): Promise<ProfileIdentity> {
  const config = getAklConfig();
  const roles = [...(context.roles ?? [])].sort();
  const groups = [...(context.groups ?? [])].sort();

  if (config.authMode === "oidc") {
    const session = readSessionCookie(await cookies(), config);
    return {
      subject_id: context.subjectId,
      display_name: session?.name ?? session?.email ?? context.subjectId,
      email: session?.email ?? null,
      roles,
      groups,
      permissions: permissionsForContext(context),
    };
  }

  return {
    subject_id: context.subjectId,
    display_name: process.env.AKL_WEB_DEV_NAME ?? "AKB Dev User",
    email: process.env.AKL_WEB_DEV_EMAIL ?? "dev@akl.local",
    roles,
    groups,
    permissions: permissionsForContext(context),
  };
}

function permissionsForContext(context: ApiRequestContext): string[] {
  const permissions: string[] = [];
  if (canUseEmployeeChat(context)) {
    permissions.push("employee_chat");
  }
  if (canUseKnowledgeWorkspace(context)) {
    permissions.push("knowledge_workspace");
  }
  if (canUseAdminSurface(context)) {
    permissions.push("admin");
  }
  return permissions;
}

function normalizeSettings(
  input: ProfileSettingsBundle,
  identity: ProfileIdentity,
): ProfileSettingsBundle {
  const core = input.core ?? {};
  const language = languageValue(core.language ?? core.locale);
  const accent = enumValue(
    core.accent ?? core.accentColor,
    ALLOWED_ACCENTS,
    "teal",
  );
  const avatarId = stringValue(
    core.avatarId,
    stringValue(core.avatarColor, "teal", 80),
    80,
  );
  const avatarColor = stringValue(core.avatarColor, avatarId, 80);
  return {
    core: {
      avatarId,
      avatarColor,
      avatarImageUrl: stringValue(core.avatarImageUrl, "", 50_000),
      displayName: stringValue(core.displayName, identity.display_name, 200),
      email: stringValue(core.email, identity.email ?? "", 320),
      role:
        identity.roles.length > 0
          ? identity.roles.join(", ")
          : "STRATOS uživatel",
      language,
      locale: language,
      theme: enumValue(core.theme, ALLOWED_THEMES, "system"),
      accent,
      accentColor: accent,
      highContrast: booleanValue(core.highContrast, false),
      timezone: stringValue(core.timezone, "Europe/Prague", 80),
      notifyTimezone: booleanValue(core.notifyTimezone, true),
      weekStart: enumValue(core.weekStart, ALLOWED_WEEK_START, "monday"),
      timeFormat: enumValue(core.timeFormat, ALLOWED_TIME_FORMAT, "24h"),
      dateFormat: enumValue(core.dateFormat, ALLOWED_DATE_FORMAT, "dd.mm.yyyy"),
      compactMode: booleanValue(core.compactMode, false),
      commandHints: booleanValue(core.commandHints, true),
      flyoutToasts: booleanValue(core.flyoutToasts, true),
      markdown: booleanValue(core.markdown, true),
      keyboardShortcuts: booleanValue(core.keyboardShortcuts, true),
    },
    apps: {
      akb: normalizeAkbSettings(input.apps?.akb),
    },
  };
}

function settingsForPersistence(
  settings: ProfileSettingsBundle,
): ProfileSettingsBundle {
  const { role: _role, ...core } = settings.core;
  return {
    core,
    apps: {
      akb: settings.apps.akb ?? {},
    },
  };
}

function normalizeAkbSettings(
  input: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return {
    settingsMode: enumValue(
      input?.settingsMode,
      ALLOWED_SETTINGS_MODES,
      "modal",
    ),
    rolePreviewProfileId: stringValue(input?.rolePreviewProfileId, "", 80),
  };
}

function asSettingsBundle(input: unknown): ProfileSettingsBundle {
  if (!input || typeof input !== "object") {
    return { core: {}, apps: {} };
  }
  const value = input as Record<string, unknown>;
  return {
    core:
      value.core && typeof value.core === "object" && !Array.isArray(value.core)
        ? { ...(value.core as Record<string, unknown>) }
        : {},
    apps: normalizeApps(value.apps),
  };
}

function normalizeApps(
  input: unknown,
): Record<string, Record<string, unknown>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const result: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = { ...(value as Record<string, unknown>) };
    }
  }
  return result;
}

function languageValue(value: unknown): AklLanguage {
  return typeof value === "string" && isAklLanguage(value) ? value : "cs";
}

function stringValue(
  value: unknown,
  fallback: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    return fallback;
  }
  return value.trim().slice(0, maxLength);
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function enumValue(
  value: unknown,
  allowed: ReadonlySet<string>,
  fallback: string,
): string {
  return typeof value === "string" && allowed.has(value) ? value : fallback;
}

function profileSettingsUpstreamError(error: Error) {
  return NextResponse.json(
    {
      error: {
        code: "PROFILE_SETTINGS_UNAVAILABLE",
        message: "Profile settings are not available.",
        detail: error.message,
      },
    },
    { status: 502 },
  );
}
