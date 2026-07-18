"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ChevronDown,
  Database,
  LogOut,
  Menu,
  Settings,
  X,
} from "lucide-react";
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
  standaloneChat?: boolean;
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
  standaloneChat = false,
}: ProjectTopbarProps) {
  const [healthState, setHealthState] = useState<HealthState>(() => ({
    label: `${healthLabel} · ${apiModeLabel} · ${authModeLabel}`,
    tone: apiModeLabel.toLowerCase().includes("mock") ? "warning" : "good",
  }));

  useEffect(() => {
    if (standaloneChat) {
      return;
    }
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
  }, [apiModeLabel, authModeLabel, healthLabel, language, standaloneChat]);

  if (standaloneChat) {
    return (
      <StandaloneChatTopbar
        language={language}
        onLogout={onLogout}
        onSettingsOpen={onSettingsOpen}
        user={user}
      />
    );
  }

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

function StandaloneChatTopbar({
  language,
  onLogout,
  onSettingsOpen,
  user,
}: {
  language: AklLanguage;
  onLogout: () => void;
  onSettingsOpen?: () => void;
  user: AklTopbarUserProfile;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const closeOnOutside = (event: PointerEvent) => {
      if (!menuRootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const labels = language === "cs"
    ? {
        app: "AKB Chat",
        assistant: "Znalostní asistent",
        menu: "Uživatelské menu",
        settings: "Nastavení",
        logout: "Odhlásit",
      }
    : {
        app: "AKB Chat",
        assistant: "Knowledge assistant",
        menu: "User menu",
        settings: "Settings",
        logout: "Sign out",
      };

  return (
    <header className="akb-standalone-topbar">
      <Link
        className="akb-standalone-topbar__brand"
        href={withAppBasePath("/")}
        aria-label={labels.app}
      >
        <span className="akb-standalone-topbar__mark" aria-hidden="true">
          <Database size={20} strokeWidth={2.2} />
        </span>
        <span>
          <strong>{labels.app}</strong>
          <small>{labels.assistant}</small>
        </span>
      </Link>
      <div className="akb-standalone-topbar__user" ref={menuRootRef}>
        <button
          ref={triggerRef}
          type="button"
          className="akb-standalone-topbar__user-trigger"
          aria-label={labels.menu}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="akb-standalone-topbar__user-name">
            {user.name}
          </span>
          <span className="akb-standalone-topbar__avatar" aria-hidden="true">
            {user.avatarImageUrl ? (
              <img src={user.avatarImageUrl} alt="" />
            ) : (
              <span style={{ background: user.avatarColor ?? "#0f8c7f" }}>
                {user.initials.slice(0, 2)}
              </span>
            )}
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {menuOpen ? (
          <div className="akb-standalone-topbar__menu" role="menu">
            <div className="akb-standalone-topbar__identity">
              <strong>{user.name}</strong>
              {user.email ? <span>{user.email}</span> : null}
            </div>
            {onSettingsOpen ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onSettingsOpen();
                }}
              >
                <Settings size={17} aria-hidden="true" />
                {labels.settings}
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onLogout();
              }}
            >
              <LogOut size={17} aria-hidden="true" />
              {labels.logout}
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
