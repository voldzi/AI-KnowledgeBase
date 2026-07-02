"use client";

import { useEffect, useState } from "react";
import { Activity, Menu, X } from "lucide-react";
import {
  GlobalTopbar,
  TopbarStatusIndicator,
  buildStratosTopbarApps,
  type TopbarStatusIndicatorTone,
} from "@voldzi/stratos-ui";

import { withAppBasePath } from "@/lib/app-url";
import type { AklLanguage } from "@/lib/i18n";

export interface AklTopbarUserProfile {
  name: string;
  email?: string;
  initials: string;
  avatarColor?: string;
  avatarImageUrl?: string;
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
  mobileMenuOpen?: boolean;
  onMobileMenuOpen?: () => void;
  onSettingsOpen?: () => void;
  projectName: string;
  user: AklTopbarUserProfile;
  workspaceName: string;
  labels: {
    applications: string;
    appComingSoon: string;
    logout: string;
    settings: string;
    userMenu: string;
  };
}

type HealthState = {
  label: string;
  tone: TopbarStatusIndicatorTone;
};

export function ProjectTopbar({
  apiModeLabel,
  authModeLabel,
  commandCenterLabel,
  commandCenterPlaceholder,
  healthLabel,
  labels,
  language,
  mobileMenuOpen = false,
  onCommandCenterOpen,
  onLogout,
  onMobileMenuOpen,
  onSettingsOpen,
  projectName,
  user,
  workspaceName,
}: ProjectTopbarProps) {
  const [healthState, setHealthState] = useState<HealthState>(() => ({
    label: `${healthLabel} · ${apiModeLabel} · ${authModeLabel}`,
    tone: apiModeLabel.toLowerCase().includes("mock") ? "warning" : "good",
  }));

  useEffect(() => {
    let active = true;
    const updateHealth = async () => {
      try {
        const response = await fetch(withAppBasePath("/api/health"), {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!active) {
          return;
        }
        if (!response.ok) {
          setHealthState({
            label: `${healthLabel}: HTTP ${response.status} · ${apiModeLabel} · ${authModeLabel}`,
            tone: "danger",
          });
          return;
        }
        const payload = await response.json().catch(() => ({}));
        const status =
          typeof payload.status === "string" ? payload.status : "ok";
        setHealthState({
          label: `${healthLabel}: ${status} · ${apiModeLabel} · ${authModeLabel}`,
          tone:
            status === "ok"
              ? apiModeLabel.toLowerCase().includes("mock")
                ? "warning"
                : "good"
              : "warning",
        });
      } catch {
        if (active) {
          setHealthState({
            label: `${healthLabel}: nedostupné · ${apiModeLabel} · ${authModeLabel}`,
            tone: "danger",
          });
        }
      }
    };
    void updateHealth();
    const interval = window.setInterval(updateHealth, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [apiModeLabel, authModeLabel, healthLabel]);

  const stratosApps = buildStratosTopbarApps("akb", {
    "budget-contract": process.env.NEXT_PUBLIC_STRATOS_HOME_URL,
    projectflow: process.env.NEXT_PUBLIC_PROJECTFLOW_URL,
    archflow: process.env.NEXT_PUBLIC_ARCHFLOW_URL,
    processforge: process.env.NEXT_PUBLIC_PROCESSFORGE_URL,
  });

  return (
    <GlobalTopbar
      apps={stratosApps}
      mobileMenuTrigger={
        onMobileMenuOpen ? (
          <button
            type="button"
            className="akl-mobile-menu-trigger"
            aria-expanded={mobileMenuOpen}
            aria-label={
              mobileMenuOpen
                ? language === "cs"
                  ? "Zavřít navigaci"
                  : "Close navigation"
                : language === "cs"
                  ? "Otevřít navigaci"
                  : "Open navigation"
            }
            onClick={onMobileMenuOpen}
          >
            {mobileMenuOpen ? (
              <X size={20} aria-hidden="true" />
            ) : (
              <Menu size={20} aria-hidden="true" />
            )}
          </button>
        ) : undefined
      }
      labels={{
        applications: labels.applications,
        userMenu: labels.userMenu,
        settings: labels.settings,
        logout: labels.logout,
      }}
      user={{
        name: user.name,
        email: user.email,
        initials: user.initials,
        status: authModeLabel,
        avatar: user.avatarImageUrl ? (
          <img
            className="akb-topbar-avatar-image"
            src={user.avatarImageUrl}
            alt=""
          />
        ) : (
          <span
            className="akb-topbar-avatar-fill"
            style={{ background: user.avatarColor ?? "#0f8c7f" }}
          >
            {user.initials.slice(0, 2)}
          </span>
        ),
      }}
      context={
        <div className="breadcrumb">
          <span>{workspaceName}</span>
          <span>/</span>
          <strong>{projectName}</strong>
        </div>
      }
      center={
        <button
          type="button"
          className="search-box command-search-trigger"
          aria-label={commandCenterLabel}
          onClick={onCommandCenterOpen}
        >
          <span>{commandCenterPlaceholder}</span>
          <kbd>⌘K</kbd>
        </button>
      }
      status={
        <div className="akl-topbar-status">
          <TopbarStatusIndicator
            label={healthState.label}
            tone={healthState.tone}
            compact
          >
            <Activity size={15} aria-hidden="true" />
          </TopbarStatusIndicator>
        </div>
      }
      onLogout={onLogout}
      onSettings={onSettingsOpen}
    />
  );
}
