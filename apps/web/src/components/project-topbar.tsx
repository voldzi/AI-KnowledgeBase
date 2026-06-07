"use client";

import { useEffect, useState } from "react";
import { Activity, Check, ChevronDown, Clock, Loader2, Search, X } from "lucide-react";

import { StratosGlobalTopbar, type StratosGlobalTopbarApp } from "@/components/stratos";
import { LanguageSwitcher } from "@/components/language-switcher";
import type { AklLanguage } from "@/lib/i18n";

type SaveState = "saved" | "saving" | "error";

interface ProjectTopbarProps {
  apiModeLabel: string;
  authModeLabel: string;
  commandCenterLabel: string;
  commandCenterPlaceholder: string;
  healthLabel: string;
  language: AklLanguage;
  onCommandCenterOpen: () => void;
  onLanguageChange: (language: AklLanguage) => void;
  onSettingsOpen?: () => void;
  projectName: string;
  saveState?: SaveState;
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
  onLanguageChange,
  onSettingsOpen,
  projectName,
  saveState = "saved",
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

  const stratosApps: StratosGlobalTopbarApp[] = [
    {
      id: "akl",
      label: "AKB",
      shortLabel: "AK",
      active: true,
      href: "https://stratos.zeleznalady.cz/akb"
    },
    {
      id: "budget-contract",
      label: "Budget & Contract",
      shortLabel: "BC",
      href: "https://stratos.zeleznalady.cz/"
    },
    {
      id: "projectflow",
      label: "ProjectFlow",
      shortLabel: "PF",
      href: "https://stratos.zeleznalady.cz/project"
    },
    {
      id: "archflow",
      label: "ArchFlow",
      shortLabel: "AF",
      href: "https://stratos.zeleznalady.cz/arch"
    }
  ];

  return (
    <StratosGlobalTopbar
      apps={stratosApps}
      labels={{
        applications: labels.applications,
        userMenu: labels.userMenu,
        settings: labels.settings,
        logout: labels.logout
      }}
      user={{
        name: "AKL Admin",
        initials: "AK",
        status: authModeLabel
      }}
      context={
        <div className="breadcrumb">
          <span>{workspaceName}</span>
          <span>/</span>
          <strong>{projectName}</strong>
          <ChevronDown size={16} aria-hidden="true" />
        </div>
      }
      center={
        <button type="button" className="search-box command-search-trigger" aria-label={commandCenterLabel} onClick={onCommandCenterOpen}>
          <Search size={16} aria-hidden="true" />
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
      onSettings={onSettingsOpen}
    />
  );
}
