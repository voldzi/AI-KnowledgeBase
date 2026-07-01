"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { AppRail, AppShell, Topbar } from "@voldzi/stratos-ui";

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
  const sidebarOpen = !sidebarCollapsed || mobileSidebarOpen;
  const className = [
    "stratos-akb-shell",
    sidebarCollapsed ? "is-sidebar-collapsed" : "",
    mobileSidebarOpen ? "is-mobile-sidebar-open" : ""
  ].filter(Boolean).join(" ");

  return (
    <AppShell
      className={className}
      topbarPlacement="global"
      sidebarOpen={sidebarOpen}
      onSidebarChange={(open) => {
        if (!open) {
          onMobileSidebarClose?.();
        }
      }}
      rail={rail}
      sidebar={sidebar}
      topbar={topbar}
    >
      {children}
    </AppShell>
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
  const router = useRouter();
  const activeItemId = items.find((item) => isActiveRoute(activePathname, item.href))?.id ?? items[0]?.id ?? "";

  return (
    <div className="stratos-akb-rail-frame">
      <AppRail
        workspaceMark={
          <Link className="stratos-akb-rail-mark" href={brandHref} title={`${brandName} · ${brandSubtitle}`}>
            {brandMark}
          </Link>
        }
        items={items.map((item) => ({
          id: item.id ?? item.href,
          label: item.label,
          icon: item.icon,
          tooltip: item.label
        }))}
        activeItemId={activeItemId}
        panelOpen
        ariaLabel="STRATOS portfolio navigation"
        onItemSelect={(itemId) => {
          const item = items.find((entry) => (entry.id ?? entry.href) === itemId);
          if (!item) {
            return;
          }
          item.onSelect?.(item);
          router.push(item.href);
        }}
        footerItems={[]}
      />
      <div className="stratos-akb-rail-footer">{footer}</div>
    </div>
  );
}

export function StratosTopbar({ children }: { children: React.ReactNode }) {
  return <Topbar trailing={children} />;
}

function isActiveRoute(activePathname: string, href: string): boolean {
  return activePathname === href || (href !== "/" && activePathname.startsWith(href));
}
