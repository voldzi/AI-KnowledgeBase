"use client";

import { Database, KeyRound, ShieldCheck, UserCog } from "lucide-react";
import { useMemo } from "react";
import {
  HelpHint,
  SelectField,
  SettingsField,
  SettingsTextInput,
  AccessEffectiveMatrix,
  StratosSettingsSurface,
  type AccessMatrixTenant,
  type SettingsContentSection,
  type SettingsNavItem,
  type SettingsSurfaceMode,
  type StratosSettingsCoreValue,
  type StratosSettingsCoreValueKey,
  type StratosSettingsCoreValues
} from "@voldzi/stratos-ui";

import type { AklLanguage } from "@/lib/i18n";

interface AppSettingsSurfaceProps {
  accessInfo: SettingsAccessInfo;
  apiModeLabel: string;
  authModeLabel: string;
  dirty: boolean;
  language: AklLanguage;
  mode: SettingsSurfaceMode;
  onClose: () => void;
  onLogout: () => void;
  onModeChange: (mode: SettingsSurfaceMode) => void;
  onRolePreviewChange: (profileId: string) => void;
  onSave: () => void;
  onValueChange: (key: StratosSettingsCoreValueKey, value: StratosSettingsCoreValue) => void;
  rolePreview: RolePreviewSettings;
  userInitials: string;
  values: StratosSettingsCoreValues;
}

interface SettingsAccessInfo {
  subjectId: string;
  roles: string[];
  groups: string[];
  permissions: string[];
}

export interface RolePreviewSettings {
  canUse: boolean;
  active: boolean;
  profileId: string;
  label: string;
  roles: string[];
  profiles: Array<{
    id: string;
    label: string;
    description: string;
    roles: string[];
  }>;
}

const settingsCopy = {
  cs: {
    runtimeGroup: "AKB",
    runtime: "Prostředí AKB",
    runtimeDescription: "Aplikační stav a režimy používané webovým rozhraním.",
    apiMode: "API klienti",
    apiModeDescription: "Režim napojení webu na AKB služby.",
    authMode: "Autentizace",
    authModeDescription: "Režim přihlášení a autorizace uživatele.",
    owner: "Vlastník aplikace",
    ownerDescription: "Sdílený STRATOS modul správy znalostí.",
    accessGroup: "Oprávnění",
    access: "Role a oprávnění",
    accessDescription: "Read-only přehled z přihlášení a RBAC. Hodnoty se neupravují v AKB.",
    subject: "Uživatel",
    roles: "Role",
    groups: "Skupiny",
    permissions: "Povolené plochy",
    accessActive: "Aktivní",
    accessInactive: "Neaktivní",
    accessEmpty: "Pro aktuální identitu není k dispozici žádný efektivní přístup.",
    accessSource: "Keycloak / AKB RBAC",
    accessTenant: "STRATOS",
    accessEmployeeChat: "AKB chat",
    accessWorkspace: "AKB dokumenty",
    accessAdmin: "AKB administrace",
    accessAllowed: "Povoleno",
    accessDenied: "Nepovoleno",
    emptyAccess: "Nepřiřazeno",
    previewGroup: "Testování",
    previewTitle: "Náhled role",
    previewDescription: "Admin může dočasně zobrazit AKB tak, jak ji uvidí vybraný typ uživatele.",
    previewField: "Zobrazit aplikaci jako",
    previewFieldHelp: "Náhled se uloží pouze pro tuto relaci a po uložení obnoví stránku.",
    previewHelpLabel: "Nápověda k náhledu role",
    previewOff: "Skutečná role uživatele",
    previewActive: "Aktivní náhled",
    previewRoles: "Role v náhledu",
    logout: "Odhlásit"
  },
  en: {
    runtimeGroup: "AKB",
    runtime: "AKB environment",
    runtimeDescription: "Application state and modes used by the web interface.",
    apiMode: "API clients",
    apiModeDescription: "Web connection mode for AKB services.",
    authMode: "Authentication",
    authModeDescription: "User sign-in and authorization mode.",
    owner: "Application owner",
    ownerDescription: "Shared STRATOS knowledge management module.",
    accessGroup: "Access",
    access: "Roles and permissions",
    accessDescription: "Read-only summary from sign-in and RBAC. AKB does not edit these values.",
    subject: "User",
    roles: "Roles",
    groups: "Groups",
    permissions: "Allowed surfaces",
    accessActive: "Active",
    accessInactive: "Inactive",
    accessEmpty: "No effective access is available for the current identity.",
    accessSource: "Keycloak / AKB RBAC",
    accessTenant: "STRATOS",
    accessEmployeeChat: "AKB chat",
    accessWorkspace: "AKB documents",
    accessAdmin: "AKB administration",
    accessAllowed: "Allowed",
    accessDenied: "Not allowed",
    emptyAccess: "Not assigned",
    previewGroup: "Testing",
    previewTitle: "Role preview",
    previewDescription: "Admins can temporarily view AKB as a selected user type.",
    previewField: "Show application as",
    previewFieldHelp: "The preview is stored only for this session and refreshes the page after saving.",
    previewHelpLabel: "Role preview help",
    previewOff: "Actual user role",
    previewActive: "Active preview",
    previewRoles: "Preview roles",
    logout: "Log out"
  }
} satisfies Record<AklLanguage, Record<string, string>>;

export function AppSettingsSurface({
  accessInfo,
  apiModeLabel,
  authModeLabel,
  dirty,
  language,
  mode,
  onClose,
  onLogout,
  onModeChange,
  onRolePreviewChange,
  onSave,
  onValueChange,
  rolePreview,
  userInitials,
  values
}: AppSettingsSurfaceProps) {
  const copy = settingsCopy[language];
  const effectiveAccessTenants = useMemo<AccessMatrixTenant[]>(
    () => buildEffectiveAccessTenants(accessInfo, copy),
    [accessInfo, copy]
  );
  const appNavItems = useMemo<SettingsNavItem[]>(
    () => [
      {
        id: "akb-runtime",
        group: copy.runtimeGroup,
        label: copy.runtime,
        description: copy.runtimeDescription,
        icon: <Database size={16} aria-hidden="true" />,
        keywords: ["akb", "api", "auth", "runtime", "provoz"]
      },
      {
        id: "akb-access",
        group: copy.accessGroup,
        label: copy.access,
        description: copy.accessDescription,
        icon: <KeyRound size={16} aria-hidden="true" />,
        keywords: ["akb", "role", "rbac", "keycloak", "opravneni"]
      },
      ...(rolePreview.canUse
        ? [
            {
              id: "akb-role-preview",
              group: copy.previewGroup,
              label: copy.previewTitle,
              description: copy.previewDescription,
              icon: <UserCog size={16} aria-hidden="true" />,
              keywords: ["akb", "role", "preview", "test", "opravneni"]
            }
          ]
        : [])
    ],
    [copy, rolePreview.canUse]
  );
  const appSections = useMemo<SettingsContentSection[]>(
    () => [
      {
        id: "akb-runtime-state",
        navItemId: "akb-runtime",
        title: copy.runtime,
        description: copy.runtimeDescription,
        keywords: ["akb", "api", "auth", "owner"],
        children: (
          <>
            <SettingsField label={copy.apiMode} description={copy.apiModeDescription}>
              <SettingsTextInput value={apiModeLabel} readOnly onChange={() => undefined} />
            </SettingsField>
            <SettingsField label={copy.authMode} description={copy.authModeDescription}>
              <SettingsTextInput icon={<ShieldCheck size={15} aria-hidden="true" />} value={authModeLabel} readOnly onChange={() => undefined} />
            </SettingsField>
            <SettingsField label={copy.owner} description={copy.ownerDescription}>
              <SettingsTextInput value="STRATOS / AKB" readOnly onChange={() => undefined} />
            </SettingsField>
          </>
        )
      },
      {
        id: "akb-access-state",
        navItemId: "akb-access",
        title: copy.access,
        description: copy.accessDescription,
        keywords: ["akb", "role", "rbac", "keycloak", "opravneni"],
        children: (
          <>
            <SettingsField label={copy.subject} description={copy.accessDescription}>
              <SettingsTextInput value={accessInfo.subjectId || copy.emptyAccess} readOnly onChange={() => undefined} />
            </SettingsField>
            <AccessEffectiveMatrix
              tenants={effectiveAccessTenants}
              emptyLabel={copy.accessEmpty}
              labels={{ active: copy.accessActive, inactive: copy.accessInactive, empty: copy.accessEmpty }}
            />
          </>
        )
      },
      ...(rolePreview.canUse
        ? [
            {
              id: "akb-role-preview-state",
              navItemId: "akb-role-preview",
              title: copy.previewTitle,
              description: copy.previewDescription,
              keywords: ["akb", "role", "preview", "test", "opravneni"],
              children: (
                <>
                  <SelectField
                    id="akb-role-preview-profile"
                    label={copy.previewField}
                    labelAccessory={<HelpHint label={copy.previewHelpLabel} text={copy.previewFieldHelp} />}
                    description={rolePreview.active ? `${copy.previewActive}: ${rolePreview.label}` : copy.previewFieldHelp}
                    value={rolePreview.profileId}
                    onChange={(event) => onRolePreviewChange(event.currentTarget.value)}
                  >
                    <option value="">{copy.previewOff}</option>
                    {rolePreview.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.label}
                      </option>
                    ))}
                  </SelectField>
                  {rolePreview.profileId ? (
                    <SettingsField label={copy.previewRoles} description={copy.previewFieldHelp}>
                      <SettingsTextInput value={rolePreview.roles.join(", ")} readOnly onChange={() => undefined} />
                    </SettingsField>
                  ) : null}
                </>
              )
            }
          ]
        : [])
    ],
    [accessInfo, apiModeLabel, authModeLabel, copy, effectiveAccessTenants, onRolePreviewChange, rolePreview]
  );

  return (
    <StratosSettingsSurface
      open
      variant="modal"
      locale={language}
      values={values}
      userInitials={userInitials}
      appNavItems={appNavItems}
      appSections={appSections}
      logoutLabel={copy.logout}
      roleReadOnly
      dirty={dirty}
      mode={mode}
      onClose={onClose}
      onLogout={onLogout}
      onModeChange={onModeChange}
      onSave={onSave}
      onValueChange={onValueChange}
    />
  );
}

function buildEffectiveAccessTenants(
  accessInfo: SettingsAccessInfo,
  copy: (typeof settingsCopy)[AklLanguage]
): AccessMatrixTenant[] {
  const permissions = new Set(accessInfo.permissions);
  const roleLabel = accessInfo.roles.length > 0 ? accessInfo.roles.join(", ") : copy.emptyAccess;
  const groupSuffix = accessInfo.groups.length > 0 ? ` · ${accessInfo.groups.join(", ")}` : "";
  const application = (id: string, label: string, permission: string) => {
    const active = permissions.has(permission);
    return {
      id,
      label,
      active,
      role: active ? copy.accessAllowed : copy.accessDenied,
      source: copy.accessSource,
      reason: permission
    };
  };

  return [
    {
      id: "stratos",
      name: copy.accessTenant,
      role: `${roleLabel}${groupSuffix}`,
      active: accessInfo.permissions.length > 0 || accessInfo.roles.length > 0,
      applications: [
        application("akb-chat", copy.accessEmployeeChat, "employee_chat"),
        application("akb-workspace", copy.accessWorkspace, "knowledge_workspace"),
        application("akb-admin", copy.accessAdmin, "admin")
      ]
    }
  ];
}

export type {
  SettingsSurfaceMode,
  StratosSettingsCoreValue,
  StratosSettingsCoreValueKey,
  StratosSettingsCoreValues
};
