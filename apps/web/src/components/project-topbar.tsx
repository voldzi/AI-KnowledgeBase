"use client";

import { useEffect, useState } from "react";
import { Activity, Menu, X } from "lucide-react";
import {
  buildStratosAppsAvailabilityFromAccessProjection,
  CommandCenterTrigger,
  GlobalTopbar,
  GlobalTopbarBreadcrumb,
  TopbarStatusGroup,
  WorkspaceSidebarTriggerButton,
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
  applicationAccess?: Array<{
    application: string;
    capabilities: string[];
    validUntil?: string | null;
  }>;
  workspaceName: string;
  showCommandCenter?: boolean;
}

type HealthState = {
  label: string;
  tone: TopbarStatusIndicatorTone;
};

const dependencyLabels: Record<AklLanguage, Record<string, string>> = {
  cs: {
    registry: "Registry",
    ingestion: "ingestce",
    rag: "AI odpovědi",
    governance: "governance",
  },
  en: {
    registry: "Registry",
    ingestion: "ingestion",
    rag: "AI answers",
    governance: "governance",
  },
};

function unavailableDependencies(
  payload: unknown,
  language: AklLanguage,
): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const dependencies = (payload as { dependencies?: unknown }).dependencies;
  if (!dependencies || typeof dependencies !== "object") {
    return [];
  }
  return Object.entries(dependencies)
    .filter(([, status]) => status !== "ready" && status !== "mock")
    .map(([name]) => dependencyLabels[language][name] ?? name);
}

export function ProjectTopbar({
  apiModeLabel,
  authModeLabel,
  commandCenterLabel,
  commandCenterPlaceholder,
  healthLabel,
  language,
  mobileMenuOpen = false,
  onCommandCenterOpen,
  onLogout,
  onMobileMenuOpen,
  onSettingsOpen,
  projectName,
  user,
  applicationAccess,
  workspaceName,
  showCommandCenter = true,
}: ProjectTopbarProps) {
  const [healthState, setHealthState] = useState<HealthState>(() => ({
    label: `${healthLabel} · ${apiModeLabel} · ${authModeLabel}`,
    tone: apiModeLabel.toLowerCase().includes("mock") ? "warning" : "good",
  }));

  useEffect(() => {
    let active = true;
    const updateHealth = async () => {
      try {
        const response = await fetch(withAppBasePath("/api/ready"), {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!active) {
          return;
        }
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const unavailable = unavailableDependencies(payload, language);
          setHealthState({
            label: unavailable.length > 0
              ? `${healthLabel}: ${language === "cs" ? "omezeno" : "degraded"} (${unavailable.join(", ")}) · ${apiModeLabel} · ${authModeLabel}`
              : `${healthLabel}: HTTP ${response.status} · ${apiModeLabel} · ${authModeLabel}`,
            tone: unavailable.length > 0 ? "warning" : "danger",
          });
          return;
        }
        const status =
          typeof payload.status === "string" ? payload.status : "ok";
        setHealthState({
          label: `${healthLabel}: ${status === "ready" ? language === "cs" ? "připraveno" : "ready" : status} · ${apiModeLabel} · ${authModeLabel}`,
          tone:
            status === "ready"
              ? apiModeLabel.toLowerCase().includes("mock")
                ? "warning"
                : "good"
              : "warning",
        });
      } catch {
        if (active) {
          setHealthState({
            label: `${healthLabel}: ${language === "cs" ? "nedostupné" : "unavailable"} · ${apiModeLabel} · ${authModeLabel}`,
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
  }, [apiModeLabel, authModeLabel, healthLabel, language]);

  return (
    <GlobalTopbar
      currentAppId="akb"
      appAvailability={buildStratosAppsAvailabilityFromAccessProjection(applicationAccess)}
      appUrls={{
        "budget-contract": process.env.NEXT_PUBLIC_STRATOS_HOME_URL,
        projectflow: process.env.NEXT_PUBLIC_PROJECTFLOW_URL,
        "security-preflight": process.env.NEXT_PUBLIC_SECURITY_PREFLIGHT_URL,
        archflow: process.env.NEXT_PUBLIC_ARCHFLOW_URL,
        aiip: process.env.NEXT_PUBLIC_AIIP_URL,
      }}
      mobileBehavior={{
        context: "hide",
        actions: "overflow",
        status: "compact",
      }}
      mobileMenuTrigger={
        onMobileMenuOpen ? (
          <WorkspaceSidebarTriggerButton
            expanded={mobileMenuOpen}
            label={
              mobileMenuOpen
                ? language === "cs"
                  ? "Zavřít navigaci"
                  : "Close navigation"
                : language === "cs"
                  ? "Otevřít navigaci"
                  : "Open navigation"
            }
            onClick={onMobileMenuOpen}
            icon={
              mobileMenuOpen ? (
                <X size={20} aria-hidden="true" />
              ) : (
                <Menu size={20} aria-hidden="true" />
              )
            }
          />
        ) : undefined
      }
      labels={{
        applications: "STRATOS aplikace",
        userMenu: "Uživatelské menu",
        settings: "Nastavení",
        logout: "Odhlásit",
      }}
      user={{
        name: user.name,
        email: user.email,
        initials: user.initials,
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
        <GlobalTopbarBreadcrumb
          ariaLabel={language === "cs" ? "Aktuální umístění" : "Current location"}
          items={[
            { id: "workspace", label: workspaceName },
            { id: "project", label: projectName, current: true },
          ]}
        />
      }
      center={showCommandCenter ? (
        <CommandCenterTrigger
          label={commandCenterPlaceholder}
          aria-label={commandCenterLabel}
          onClick={onCommandCenterOpen}
        />
      ) : undefined}
      status={
        <TopbarStatusGroup
          label={healthLabel}
          ariaLive="polite"
          items={[
            {
              id: "system-health",
              label: healthState.label,
              tone: healthState.tone,
              compact: true,
              icon: <Activity size={15} aria-hidden="true" />,
            },
          ]}
        />
      }
      onLogout={onLogout}
      onSettings={onSettingsOpen}
    />
  );
}
