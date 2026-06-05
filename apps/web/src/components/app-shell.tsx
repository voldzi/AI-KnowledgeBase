"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bot,
  Database,
  FileClock,
  FilePlus2,
  Gauge,
  LayoutDashboard,
  Search,
  Settings,
  ShieldCheck
} from "lucide-react";

const navigation = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/documents", label: "Documents", icon: Database },
  { href: "/upload", label: "Upload", icon: FilePlus2 },
  { href: "/ingestion", label: "Ingestion", icon: FileClock },
  { href: "/chat", label: "Knowledge chat", icon: Bot },
  { href: "/audit", label: "Audit", icon: ShieldCheck },
  { href: "/admin", label: "Admin", icon: Settings }
];

interface AppShellProps {
  children: React.ReactNode;
  apiMode: "mock" | "production";
  authMode: "mock" | "oidc";
}

export function AppShell({ children, apiMode, authMode }: AppShellProps) {
  const pathname = usePathname();
  const apiModeLabel = apiMode === "mock" ? "Mock API mode" : "Production API clients";
  const authModeLabel = authMode === "mock" ? "dev auth" : "OIDC auth";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand__mark">AKL</span>
          <span>
            <strong>AKL Platform</strong>
            <small>AI Knowledge Library</small>
          </span>
        </Link>
        <nav className="nav-list" aria-label="Primary">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link className={`nav-item ${active ? "nav-item--active" : ""}`} href={item.href} key={item.href}>
                <Icon size={17} strokeWidth={2} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar__footer">
          <div className="health-dot" aria-hidden="true" />
          <span>{apiModeLabel} · {authModeLabel}</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar__search">
            <Search size={17} strokeWidth={2} aria-hidden="true" />
            <span>Find document, version, citation, or audit event</span>
          </div>
          <div className="topbar__status">
            <span className="topbar__chip">
              <Activity size={15} aria-hidden="true" />
              Health OK
            </span>
            <span className="topbar__chip">
              <Gauge size={15} aria-hidden="true" />
              Europe/Prague
            </span>
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
