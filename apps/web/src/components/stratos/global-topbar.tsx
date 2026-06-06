"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, LogOut, Settings } from "lucide-react";

export type StratosGlobalTopbarApp = {
  id: string;
  label: string;
  shortLabel?: string;
  icon?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSelect?: () => void;
};

export type StratosGlobalTopbarUser = {
  name: string;
  email?: string;
  initials: string;
  status?: string;
  avatar?: ReactNode;
};

export type StratosGlobalTopbarLabels = {
  applications: string;
  userMenu: string;
  settings: string;
  logout: string;
};

interface StratosGlobalTopbarProps {
  actions?: ReactNode;
  apps: StratosGlobalTopbarApp[];
  center?: ReactNode;
  className?: string;
  context?: ReactNode;
  labels: StratosGlobalTopbarLabels;
  onLogout?: () => void;
  onSettings?: () => void;
  status?: ReactNode;
  user: StratosGlobalTopbarUser;
}

export function StratosGlobalTopbar({
  actions,
  apps,
  center,
  className,
  context,
  labels,
  onLogout,
  onSettings,
  status,
  user
}: StratosGlobalTopbarProps) {
  const [openMenu, setOpenMenu] = useState<"apps" | "user" | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeApp = useMemo(() => apps.find((app) => app.active) ?? apps[0], [apps]);

  useEffect(() => {
    if (!openMenu) {
      return;
    }

    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    };

    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenu]);

  function selectApp(app: StratosGlobalTopbarApp) {
    if (app.disabled) {
      return;
    }
    app.onSelect?.();
    setOpenMenu(null);
  }

  return (
    <header ref={rootRef} className={["stratos-global-topbar", className].filter(Boolean).join(" ")}>
      <div className="stratos-global-topbar-left">
        <div className="stratos-global-topbar-switcher">
          <button
            type="button"
            className="stratos-app-switcher-trigger"
            aria-haspopup="menu"
            aria-expanded={openMenu === "apps"}
            onClick={() => setOpenMenu(openMenu === "apps" ? null : "apps")}
          >
            <span className="stratos-app-switcher-mark" aria-hidden="true">
              {activeApp?.icon ?? activeApp?.shortLabel?.slice(0, 2) ?? activeApp?.label.slice(0, 1) ?? "S"}
            </span>
            <span className="stratos-app-switcher-label">{activeApp?.label ?? labels.applications}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>

          {openMenu === "apps" ? (
            <div className="stratos-topbar-popover stratos-app-switcher-menu" role="menu" aria-label={labels.applications}>
              <div className="stratos-topbar-popover-heading">{labels.applications}</div>
              <div className="stratos-app-switcher-list">
                {apps.map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    role="menuitem"
                    className={["stratos-app-switcher-item", app.active ? "is-active" : "", app.disabled ? "is-disabled" : ""]
                      .filter(Boolean)
                      .join(" ")}
                    disabled={app.disabled}
                    title={app.disabled ? app.disabledReason : undefined}
                    onClick={() => selectApp(app)}
                  >
                    <span className="stratos-app-switcher-mark" aria-hidden="true">
                      {app.icon ?? app.shortLabel?.slice(0, 2) ?? app.label.slice(0, 1)}
                    </span>
                    <span>
                      <strong>{app.label}</strong>
                      {app.disabledReason ? <small>{app.disabledReason}</small> : null}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        {context ? <div className="stratos-global-topbar-context">{context}</div> : null}
      </div>

      {center ? <div className="stratos-global-topbar-center">{center}</div> : null}

      <div className="stratos-global-topbar-right">
        {status}
        {actions}
        <div className="stratos-global-topbar-user">
          <button
            type="button"
            className="stratos-user-avatar-trigger"
            aria-label={labels.userMenu}
            aria-haspopup="menu"
            aria-expanded={openMenu === "user"}
            onClick={() => setOpenMenu(openMenu === "user" ? null : "user")}
          >
            <span className="stratos-user-avatar">
              {user.avatar ?? user.initials.slice(0, 2)}
              {user.status ? <span className="stratos-user-status-dot" aria-hidden="true" /> : null}
            </span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>

          {openMenu === "user" ? (
            <div className="stratos-topbar-popover stratos-user-menu" role="menu" aria-label={labels.userMenu}>
              <div className="stratos-user-menu-profile">
                <span className="stratos-user-avatar is-large">
                  {user.avatar ?? user.initials.slice(0, 2)}
                  {user.status ? <span className="stratos-user-status-dot" aria-hidden="true" /> : null}
                </span>
                <span>
                  <strong>{user.name}</strong>
                  {user.status ? <small>{user.status}</small> : null}
                  {user.email ? <small>{user.email}</small> : null}
                </span>
              </div>
              <div className="stratos-user-menu-section">
                <button
                  type="button"
                  role="menuitem"
                  className="stratos-user-menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    onSettings?.();
                  }}
                >
                  <Settings size={18} aria-hidden="true" />
                  <span>{labels.settings}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="stratos-user-menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    onLogout?.();
                  }}
                >
                  <LogOut size={18} aria-hidden="true" />
                  <span>{labels.logout}</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
