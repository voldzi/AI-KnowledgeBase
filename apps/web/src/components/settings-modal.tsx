"use client";

import { Mail, Palette, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react";
import { useMemo, useState } from "react";

import { SettingsSurface, type SettingsSurfaceMode } from "@/components/stratos/settings-surface";
import type { AklLanguage } from "@/lib/i18n";

interface SettingsModalProps {
  authModeLabel: string;
  language: AklLanguage;
  onLogout: () => void;
  onClose: () => void;
  user: {
    name: string;
    email?: string;
    initials: string;
    roles: string[];
  };
}

const settingsCopy = {
  cs: {
    title: "Všechna nastavení",
    subtitle: "Nastavení aplikace AKL ve společném STRATOS povrchu.",
    search: "Hledat nastavení",
    empty: "Nenalezeno žádné nastavení.",
    admin: "Admin",
    features: "Funkce",
    mine: "Moje nastavení",
    profile: "Profil",
    profileDescription: "Osobní informace a základní údaje účtu.",
    security: "Bezpečnost",
    securityDescription: "Zabezpečení účtu a přístupové volby.",
    appearance: "Vzhled",
    appearanceDescription: "Téma, barvy a hustota rozhraní.",
    preferences: "Preference",
    preferencesDescription: "Jazyk, čas a klávesové ovládání.",
    fullName: "Jméno",
    email: "E-mail",
    role: "Role",
    saved: "Uloženo",
    save: "Uložit",
    close: "Zavřít nastavení",
    logout: "Odhlásit",
    modal: "Okno",
    fullscreen: "Celá obrazovka",
    sidebar: "Postranní panel",
    unsavedChanges: "Máte neuložené změny. Zavřít bez uložení?",
    accountTitle: "Účet",
    accountDescription: "Základní pracovní identita pro AKL.",
    interfaceTitle: "Rozhraní",
    interfaceDescription: "Dočasné aplikační hodnoty do dodání centrálních STRATOS nastavení."
  },
  en: {
    title: "All settings",
    subtitle: "AKL application settings in the shared STRATOS surface.",
    search: "Search settings",
    empty: "No settings found.",
    admin: "Admin",
    features: "Features",
    mine: "My settings",
    profile: "Profile",
    profileDescription: "Personal information and basic account data.",
    security: "Security",
    securityDescription: "Account security and access options.",
    appearance: "Appearance",
    appearanceDescription: "Theme, colors and interface density.",
    preferences: "Preferences",
    preferencesDescription: "Language, time and keyboard behavior.",
    fullName: "Full name",
    email: "Email",
    role: "Role",
    saved: "Saved",
    save: "Save",
    close: "Close settings",
    logout: "Log out",
    modal: "Modal",
    fullscreen: "Full screen",
    sidebar: "Sidebar",
    unsavedChanges: "You have unsaved changes. Close anyway?",
    accountTitle: "Account",
    accountDescription: "Basic working identity for AKL.",
    interfaceTitle: "Interface",
    interfaceDescription: "Temporary app values until central STRATOS settings are delivered."
  }
} satisfies Record<AklLanguage, Record<string, string>>;

export function SettingsModal({ authModeLabel, language, onClose, onLogout, user }: SettingsModalProps) {
  const copy = settingsCopy[language];
  const [mode, setMode] = useState<SettingsSurfaceMode>("modal");

  const navItems = useMemo(
    () => [
      { id: "profile", group: copy.admin, label: copy.profile, description: copy.profileDescription, icon: <UserRound size={18} aria-hidden="true" /> },
      { id: "security", group: copy.admin, label: copy.security, description: copy.securityDescription, icon: <ShieldCheck size={18} aria-hidden="true" /> },
      { id: "appearance", group: copy.features, label: copy.appearance, description: copy.appearanceDescription, icon: <Palette size={18} aria-hidden="true" /> },
      { id: "preferences", group: copy.mine, label: copy.preferences, description: copy.preferencesDescription, icon: <SlidersHorizontal size={18} aria-hidden="true" /> }
    ],
    [copy]
  );

  const sections = useMemo(
    () => [
      {
        id: "profile-account",
        navItemId: "profile",
        title: copy.accountTitle,
        description: copy.accountDescription,
        children: (
          <div className="akl-settings-profile">
            <div className="stratos-settings-avatar-block">
              <span className="stratos-settings-avatar">{user.initials}</span>
              <span>
                <strong>{user.name}</strong>
                <small>{authModeLabel}</small>
              </span>
            </div>
            <label className="akl-settings-field">
              <span>{copy.fullName}</span>
              <input value={user.name} readOnly />
            </label>
            <label className="akl-settings-field">
              <span>{copy.email}</span>
              <span className="akl-settings-readonly">
                <Mail size={16} aria-hidden="true" />
                {user.email ?? "-"}
              </span>
            </label>
            <label className="akl-settings-field">
              <span>{copy.role}</span>
              <input value={user.roles.length > 0 ? user.roles.join(", ") : authModeLabel} readOnly />
            </label>
          </div>
        )
      },
      {
        id: "security-basic",
        navItemId: "security",
        title: copy.security,
        description: copy.securityDescription,
        children: <p className="akl-settings-note">{authModeLabel}</p>
      },
      {
        id: "appearance-basic",
        navItemId: "appearance",
        title: copy.interfaceTitle,
        description: copy.interfaceDescription,
        children: <p className="akl-settings-note">STRATOS / AKL</p>
      },
      {
        id: "preferences-basic",
        navItemId: "preferences",
        title: copy.preferences,
        description: copy.preferencesDescription,
        children: <p className="akl-settings-note">{language.toUpperCase()}</p>
      }
    ],
    [authModeLabel, copy, language, user]
  );

  return (
    <SettingsSurface
      open
      variant="modal"
      title={copy.title}
      subtitle={copy.subtitle}
      navItems={navItems}
      sections={sections}
      searchPlaceholder={copy.search}
      emptyLabel={copy.empty}
      saveLabel={copy.save}
      savedLabel={copy.saved}
      closeLabel={copy.close}
      logoutLabel={copy.logout}
      labels={{
        modal: copy.modal,
        fullscreen: copy.fullscreen,
        sidebar: copy.sidebar,
        unsavedChanges: copy.unsavedChanges
      }}
      mode={mode}
      dirty={false}
      onClose={onClose}
      onLogout={onLogout}
      onModeChange={setMode}
      onSave={() => undefined}
    />
  );
}
