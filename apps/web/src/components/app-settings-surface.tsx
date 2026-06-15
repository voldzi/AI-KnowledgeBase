"use client";

import { Database, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import {
  SettingsField,
  SettingsTextInput,
  StratosSettingsSurface,
  type SettingsContentSection,
  type SettingsNavItem,
  type SettingsSurfaceMode,
  type StratosSettingsCoreValue,
  type StratosSettingsCoreValueKey,
  type StratosSettingsCoreValues
} from "@voldzi/stratos-ui";

import type { AklLanguage } from "@/lib/i18n";

interface AppSettingsSurfaceProps {
  apiModeLabel: string;
  authModeLabel: string;
  dirty: boolean;
  language: AklLanguage;
  mode: SettingsSurfaceMode;
  onClose: () => void;
  onLogout: () => void;
  onModeChange: (mode: SettingsSurfaceMode) => void;
  onSave: () => void;
  onValueChange: (key: StratosSettingsCoreValueKey, value: StratosSettingsCoreValue) => void;
  userInitials: string;
  values: StratosSettingsCoreValues;
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
    logout: "Log out"
  }
} satisfies Record<AklLanguage, Record<string, string>>;

export function AppSettingsSurface({
  apiModeLabel,
  authModeLabel,
  dirty,
  language,
  mode,
  onClose,
  onLogout,
  onModeChange,
  onSave,
  onValueChange,
  userInitials,
  values
}: AppSettingsSurfaceProps) {
  const copy = settingsCopy[language];
  const appNavItems = useMemo<SettingsNavItem[]>(
    () => [
      {
        id: "akb-runtime",
        group: copy.runtimeGroup,
        label: copy.runtime,
        description: copy.runtimeDescription,
        icon: <Database size={16} aria-hidden="true" />,
        keywords: ["akb", "api", "auth", "runtime", "provoz"]
      }
    ],
    [copy]
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
      }
    ],
    [apiModeLabel, authModeLabel, copy]
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

export type {
  SettingsSurfaceMode,
  StratosSettingsCoreValue,
  StratosSettingsCoreValueKey,
  StratosSettingsCoreValues
};
