"use client";

import { useEffect, useState } from "react";
import { Activity, Check, Clock, Loader2, Menu, X } from "lucide-react";
import { GlobalTopbar, buildStratosTopbarApps } from "@voldzi/stratos-ui";

import { LanguageSwitcher } from "@/components/language-switcher";
import type { AklLanguage } from "@/lib/i18n";

type SaveState = "saved" | "saving" | "error";

export interface AklTopbarUserProfile {
  name: string;
  email?: string;
  initials: string;
}

interface ProjectTopbarProps {
  apiModeLabel: string;
  authModeLabel: string;
  commandCenterLabel: string;
  commandCenterPlaceholder: string;
  healthLabel: string;
  language: AklLanguage;
  onCommandCenterOpen: () => void;
  onLogout: () => void;
  onLanguageChange: (language: AklLanguage) => void;
  onMobileMenuOpen?: () => void;
  onSettingsOpen?: () => void;
  projectName: string;
  saveState?: SaveState;
  user: AklTopbarUserProfile;
  workspaceName: string;
  labels: {
    applications: string;
    appComingSoon: string;
    logout: string;
    saved: string;
    saveFailed: string;
    saving: string;
    settings: string;
    userMenu: string;
  };
}

export function ProjectTopbar({
  apiModeLabel,
  authModeLabel,
  commandCenterLabel,
  commandCenterPlaceholder,
  healthLabel,
  labels,
  language,
  onCommandCenterOpen,
  onLogout,
  onLanguageChange,
  onMobileMenuOpen,
  onSettingsOpen,
  projectName,
  saveState = "saved",
  user,
  workspaceName
}: ProjectTopbarProps) {
  const [pragueTime, setPragueTime] = useState("");

  useEffect(() => {
    const formatter = new Intl.DateTimeFormat("cs-CZ", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Prague"
    });

    const updateTime = () => setPragueTime(formatter.format(new Date()));
    updateTime();
    const interval = window.setInterval(updateTime, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const stratosApps = buildStratosTopbarApps("akb", {
    "budget-contract": process.env.NEXT_PUBLIC_STRATOS_HOME_URL,
    projectflow:       process.env.NEXT_PUBLIC_PROJECTFLOW_URL,
    archflow:          process.env.NEXT_PUBLIC_ARCHFLOW_URL,
    processforge:      process.env.NEXT_PUBLIC_PROCESSFORGE_URL,
  });

  return (
    <GlobalTopbar
      apps={stratosApps}
      mobileMenuTrigger={onMobileMenuOpen ? (
        <button
          type="button"
          className="akl-mobile-menu-trigger"
          aria-label={language === "cs" ? "Otevřít navigaci" : "Open navigation"}
          onClick={onMobileMenuOpen}
        >
          <Menu size={20} aria-hidden="true" />
        </button>
      ) : undefined}
      labels={{
        applications: labels.applications,
        userMenu: labels.userMenu,
        settings: labels.settings,
        logout: labels.logout
      }}
      user={{
        name: user.name,
        email: user.email,
        initials: user.initials,
        status: authModeLabel
      }}
      context={
        <div className="breadcrumb">
          <span>{workspaceName}</span>
          <span>/</span>
          <strong>{projectName}</strong>
        </div>
      }
      center={
        <button type="button" className="search-box command-search-trigger" aria-label={commandCenterLabel} onClick={onCommandCenterOpen}>
          <span>{commandCenterPlaceholder}</span>
          <kbd>⌘K</kbd>
        </button>
      }
      status={
        <div className="akl-topbar-status">
          <span className={`save-status-pill state-${saveState}`} aria-live="polite" title={`${apiModeLabel} · ${authModeLabel}`}>
            {saveState === "saving" ? (
              <Loader2 className="spin" size={13} aria-hidden="true" />
            ) : saveState === "error" ? (
              <X size={13} aria-hidden="true" />
            ) : (
              <Check size={13} aria-hidden="true" />
            )}
            {saveState === "saving" ? labels.saving : saveState === "error" ? labels.saveFailed : labels.saved}
          </span>
          <span className="topbar__chip">
            <Activity size={15} aria-hidden="true" />
            {healthLabel}
          </span>
          <span className="topbar__chip" title={`Europe/Prague · ${apiModeLabel} · ${authModeLabel}`} aria-live="polite">
            <Clock size={15} aria-hidden="true" />
            {pragueTime ? `Europe/Prague ${pragueTime}` : "Europe/Prague"}
          </span>
        </div>
      }
      actions={<LanguageSwitcher language={language} setLanguage={onLanguageChange} />}
      onLogout={onLogout}
      onSettings={onSettingsOpen}
    />
  );
}
