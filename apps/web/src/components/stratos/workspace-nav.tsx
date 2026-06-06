import type { ReactNode } from "react";

export interface StratosWorkspaceNavItem {
  id: string;
  label: string;
  icon?: ReactNode;
  trailing?: ReactNode;
  badge?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  href?: string;
  external?: boolean;
  onSelect?: (itemId: string) => void;
}

export interface StratosWorkspaceNavGroup {
  id: string;
  label?: string;
  items: StratosWorkspaceNavItem[];
}

export interface StratosWorkspaceNavProps {
  groups: StratosWorkspaceNavGroup[];
  ariaLabel?: string;
  onSelect?: (itemId: string) => void;
  className?: string;
}

export function StratosWorkspaceSidebar({
  children,
  className,
  collapsed = false,
  footer,
  headerActions,
  showHeader = true,
  subtitle,
  title,
  "aria-label": ariaLabel
}: {
  children: ReactNode;
  className?: string;
  collapsed?: boolean;
  footer?: ReactNode;
  headerActions?: ReactNode;
  showHeader?: boolean;
  subtitle?: string;
  title: string;
  "aria-label"?: string;
}) {
  return (
    <aside
      className={["stratos-workspace-sidebar", className ?? ""].filter(Boolean).join(" ")}
      data-collapsed={collapsed ? "true" : "false"}
      aria-label={ariaLabel ?? title}
    >
      {showHeader ? (
        <header className="stratos-workspace-sidebar-header">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {headerActions ? <div className="stratos-workspace-sidebar-actions">{headerActions}</div> : null}
        </header>
      ) : null}
      <div className="stratos-workspace-sidebar-body">{children}</div>
      {footer ? <footer className="stratos-workspace-sidebar-footer">{footer}</footer> : null}
    </aside>
  );
}

function itemClassName(item: StratosWorkspaceNavItem) {
  return `stratos-workspace-nav-item${item.active ? " is-active" : ""}${item.disabled ? " is-disabled" : ""}`;
}

function renderItem(item: StratosWorkspaceNavItem, onSelect?: (itemId: string) => void) {
  const content = (
    <>
      {item.icon ? <span className="stratos-workspace-nav-icon">{item.icon}</span> : null}
      <span className="stratos-workspace-nav-label">{item.label}</span>
      {item.badge ? <span className="stratos-workspace-nav-badge">{item.badge}</span> : null}
      {item.trailing ? <span className="stratos-workspace-nav-trailing">{item.trailing}</span> : null}
    </>
  );
  const title = item.disabled ? item.disabledReason ?? item.label : item.label;

  if (item.href) {
    return (
      <a
        className={itemClassName(item)}
        href={item.disabled ? undefined : item.href}
        key={item.id}
        target={item.external ? "_blank" : undefined}
        rel={item.external ? "noreferrer" : undefined}
        aria-current={item.active ? "page" : undefined}
        aria-disabled={item.disabled ? "true" : undefined}
        title={title}
        onClick={(event) => {
          if (item.disabled) {
            event.preventDefault();
          }
          item.onSelect?.(item.id);
          onSelect?.(item.id);
        }}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      className={itemClassName(item)}
      key={item.id}
      type="button"
      disabled={item.disabled}
      title={title}
      aria-current={item.active ? "page" : undefined}
      onClick={() => {
        item.onSelect?.(item.id);
        onSelect?.(item.id);
      }}
    >
      {content}
    </button>
  );
}

export function StratosWorkspaceNav({ groups, ariaLabel = "Workspace navigation", onSelect, className }: StratosWorkspaceNavProps) {
  return (
    <nav className={["stratos-workspace-nav", className ?? ""].filter(Boolean).join(" ")} aria-label={ariaLabel}>
      {groups.map((group) => (
        <section className="stratos-workspace-nav-group" key={group.id}>
          {group.label ? <h3>{group.label}</h3> : null}
          <div className="stratos-workspace-nav-items">{group.items.map((item) => renderItem(item, onSelect))}</div>
        </section>
      ))}
    </nav>
  );
}
