import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { AppRail, AppShell } from "@voldzi/stratos-ui";

import { withAppBasePath } from "@/lib/app-url";

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
  const shellClassName = [
    "stratos-akb-shell",
    sidebarCollapsed ? "is-sidebar-collapsed" : "",
    mobileSidebarOpen ? "is-mobile-sidebar-open" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <AppShell
      className={shellClassName}
      rail={rail}
      sidebar={sidebar}
      sidebarOpen={mobileSidebarOpen}
      topbar={topbar}
      topbarPlacement="global"
      onSidebarChange={(open) => {
        if (!open) {
          onMobileSidebarClose?.();
        }
      }}
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
  const activeItem =
    items.find((item) => item.href === activePathname) ??
    items.find((item) => activePathname.startsWith(item.href) && item.href !== "/") ??
    items[0];

  return (
    <div className="stratos-akb-rail-frame">
      <Link className="stratos-brand" href={brandHref}>
        <span className="stratos-brand__mark">{brandMark}</span>
        <span>
          <strong>{brandName}</strong>
          <small>{brandSubtitle}</small>
        </span>
      </Link>
      <AppRail
        activeItemId={activeItem?.id ?? activePathname}
        panelOpen
        items={items.map((item) => ({
          id: item.id ?? item.href,
          icon: item.icon,
          label: item.label,
          tooltip: item.label
        }))}
        onItemSelect={(itemId) => {
          const item = items.find((candidate) => (candidate.id ?? candidate.href) === itemId);
          if (!item) {
            return;
          }
          item.onSelect?.(item);
          router.push(withAppBasePath(item.href));
        }}
      />
      <div className="stratos-app-rail__footer">{footer}</div>
    </div>
  );
}

export function StratosTopbar({ children }: { children: React.ReactNode }) {
  return <header className="stratos-topbar">{children}</header>;
}
