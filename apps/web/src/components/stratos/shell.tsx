import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export interface StratosNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  id?: string;
  onSelect?: (item: StratosNavItem) => void;
}

interface StratosAppShellProps {
  children: React.ReactNode;
  sidebarCollapsed?: boolean;
  mobileSidebarOpen?: boolean;
  onMobileSidebarClose?: () => void;
  rail: React.ReactNode;
  sidebar?: React.ReactNode;
  topbar: React.ReactNode;
}

export function StratosAppShell({
  children,
  mobileSidebarOpen = false,
  onMobileSidebarClose,
  rail,
  sidebar,
  sidebarCollapsed = false,
  topbar
}: StratosAppShellProps) {
  return (
    <div
      className="stratos-app-shell"
      data-sidebar-collapsed={sidebarCollapsed ? "true" : "false"}
      data-mobile-sidebar-open={mobileSidebarOpen ? "true" : "false"}
    >
      <div className="akl-sidebar-backdrop" aria-hidden="true" onClick={onMobileSidebarClose} />
      <div className="stratos-app-shell__topbar">{topbar}</div>
      {rail}
      {sidebar}
      <div className="stratos-workspace">
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}

interface StratosAppRailProps {
  activePathname: string;
  brandHref: string;
  brandMark: string;
  brandName: string;
  brandSubtitle: string;
  footer: React.ReactNode;
  items: StratosNavItem[];
}

export function StratosAppRail({
  activePathname,
  brandHref,
  brandMark,
  brandName,
  brandSubtitle,
  footer,
  items
}: StratosAppRailProps) {
  return (
    <aside className="stratos-app-rail">
      <Link className="stratos-brand" href={brandHref}>
        <span className="stratos-brand__mark">{brandMark}</span>
        <span>
          <strong>{brandName}</strong>
          <small>{brandSubtitle}</small>
        </span>
      </Link>
      <nav className="stratos-nav-list" aria-label="Primary">
        {items.map((item) => {
          const Icon = item.icon;
          const active = activePathname === item.href || (item.href !== "/" && activePathname.startsWith(item.href));
          return (
            <Link
              className={`stratos-nav-item ${active ? "stratos-nav-item--active" : ""}`}
              href={item.href}
              key={item.href}
              title={item.label}
              onClick={() => item.onSelect?.(item)}
            >
              <Icon size={17} strokeWidth={2} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="stratos-app-rail__footer">{footer}</div>
    </aside>
  );
}

export function StratosTopbar({ children }: { children: React.ReactNode }) {
  return <header className="stratos-topbar">{children}</header>;
}
