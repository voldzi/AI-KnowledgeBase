"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, LogOut, Search, X } from "lucide-react";

import { SurfaceModeMenu, type SurfaceModeLabels, type SurfaceWindowMode } from "./surface-mode-menu";

export type SettingsSurfaceMode = SurfaceWindowMode;
export type SettingsSurfaceVariant = "embedded" | "page" | "modal";

export type SettingsNavItem = {
  badge?: ReactNode;
  description?: string;
  group?: string;
  icon?: ReactNode;
  id: string;
  keywords?: string[];
  label: string;
};

export type SettingsContentSection = {
  children: ReactNode;
  description?: string;
  id: string;
  keywords?: string[];
  navItemId: string;
  title: string;
};

interface SettingsSurfaceProps {
  actions?: ReactNode;
  activeItemId?: string;
  className?: string;
  closeLabel?: string;
  dirty?: boolean;
  emptyLabel?: string;
  footer?: ReactNode;
  labels?: SurfaceModeLabels & { unsavedChanges?: string };
  logoutLabel?: string;
  mode?: SettingsSurfaceMode;
  navItems: SettingsNavItem[];
  onActiveItemChange?: (itemId: string) => void;
  onClose?: () => void;
  onLogout?: () => void;
  onModeChange?: (mode: SettingsSurfaceMode) => void;
  onSave?: () => void;
  open?: boolean;
  saveLabel?: string;
  savedLabel?: string;
  searchPlaceholder?: string;
  sections: SettingsContentSection[];
  subtitle?: string;
  title?: string;
  variant?: SettingsSurfaceVariant;
}

function normalizeSettingsText(value: unknown) {
  return String(value ?? "")
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function groupSettingsItems(items: SettingsNavItem[]) {
  const groups: Array<{ items: SettingsNavItem[]; name: string }> = [];
  for (const item of items) {
    const groupName = item.group ?? "";
    let group = groups.find((candidate) => candidate.name === groupName);
    if (!group) {
      group = { name: groupName, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

export function SettingsSurface({
  actions,
  activeItemId,
  className,
  closeLabel = "Zavřít nastavení",
  dirty = false,
  emptyLabel = "Nenalezeno",
  footer,
  labels,
  logoutLabel = "Odhlásit",
  mode,
  navItems,
  onActiveItemChange,
  onClose,
  onLogout,
  onModeChange,
  onSave,
  open = true,
  saveLabel = "Uložit",
  savedLabel = "Uloženo",
  searchPlaceholder = "Hledat nastavení",
  sections,
  subtitle,
  title = "Všechna nastavení",
  variant = "embedded"
}: SettingsSurfaceProps) {
  const [query, setQuery] = useState("");
  const [internalActiveItemId, setInternalActiveItemId] = useState(activeItemId ?? navItems[0]?.id ?? "");
  const normalizedQuery = normalizeSettingsText(query.trim());

  const sectionMatchesByItem = useMemo(() => {
    const result = new Map<string, boolean>();
    if (!normalizedQuery) return result;
    for (const section of sections) {
      const haystack = normalizeSettingsText([section.title, section.description, ...(section.keywords ?? [])].join(" "));
      if (haystack.includes(normalizedQuery)) {
        result.set(section.navItemId, true);
      }
    }
    return result;
  }, [normalizedQuery, sections]);

  const filteredNavItems = useMemo(() => {
    if (!normalizedQuery) return navItems;
    return navItems.filter((item) => {
      const haystack = normalizeSettingsText([item.label, item.description, item.group, ...(item.keywords ?? [])].join(" "));
      return haystack.includes(normalizedQuery) || sectionMatchesByItem.get(item.id);
    });
  }, [navItems, normalizedQuery, sectionMatchesByItem]);

  const selectedItemId = useMemo(() => {
    const requested = activeItemId ?? internalActiveItemId;
    if (filteredNavItems.some((item) => item.id === requested)) return requested;
    return filteredNavItems[0]?.id ?? navItems[0]?.id ?? "";
  }, [activeItemId, filteredNavItems, internalActiveItemId, navItems]);

  const activeSections = useMemo(() => sections.filter((section) => section.navItemId === selectedItemId), [sections, selectedItemId]);

  useEffect(() => {
    if (!activeItemId && selectedItemId && selectedItemId !== internalActiveItemId) {
      setInternalActiveItemId(selectedItemId);
    }
  }, [activeItemId, internalActiveItemId, selectedItemId]);

  if (!open) return null;

  const effectiveMode = mode ?? (variant === "modal" ? "modal" : undefined);
  const shouldUseLayer = variant === "modal" || Boolean(mode);
  const requestClose = () => {
    if (dirty && typeof window !== "undefined") {
      const confirmed = window.confirm(labels?.unsavedChanges ?? "Máte neuložené změny. Zavřít bez uložení?");
      if (!confirmed) return;
    }
    onClose?.();
  };

  const surface = (
    <section
      className={["stratos-settings-surface", `is-${variant}`, effectiveMode ? `is-${effectiveMode}` : null, className].filter(Boolean).join(" ")}
      data-mode={effectiveMode}
      aria-label={title}
    >
      <header className="stratos-detail-header stratos-settings-topbar">
        <div className="stratos-detail-header-main stratos-settings-topbar-main">
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {(onModeChange && effectiveMode) || onClose ? (
          <div className="stratos-detail-header-actions">
            {onModeChange && effectiveMode ? (
              <SurfaceModeMenu mode={effectiveMode} labels={labels} ariaLabel="Změnit režim nastavení" popoverLabel="Režim nastavení" onModeChange={onModeChange} />
            ) : null}
            {onClose ? (
              <button type="button" title={closeLabel} aria-label={closeLabel} onClick={requestClose}>
                <X size={18} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      <aside className="stratos-settings-sidebar" aria-label={title}>
        <label className="stratos-settings-search">
          <Search size={16} aria-hidden="true" />
          <input type="search" value={query} placeholder={searchPlaceholder} onChange={(event) => setQuery(event.target.value)} />
          {query ? (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </label>

        <nav className="stratos-settings-nav">
          {filteredNavItems.length ? groupSettingsItems(filteredNavItems).map((group) => (
            <div className="stratos-settings-nav-group" key={group.name || "default"}>
              {group.name ? <div className="stratos-settings-nav-group-label">{group.name}</div> : null}
              {group.items.map((item) => (
                <button
                  type="button"
                  className={item.id === selectedItemId ? "is-active" : ""}
                  key={item.id}
                  onClick={() => {
                    if (!activeItemId) setInternalActiveItemId(item.id);
                    onActiveItemChange?.(item.id);
                  }}
                >
                  <span className="stratos-settings-nav-icon">{item.icon}</span>
                  <span className="stratos-settings-nav-text">
                    <span>{item.label}</span>
                    {item.description ? <small>{item.description}</small> : null}
                  </span>
                  {item.badge ? <span className="stratos-settings-nav-badge">{item.badge}</span> : null}
                  <ChevronRight className="stratos-settings-nav-chevron" size={15} aria-hidden="true" />
                </button>
              ))}
            </div>
          )) : (
            <div className="stratos-settings-empty">{emptyLabel}</div>
          )}
        </nav>

        {footer ? <div className="stratos-settings-sidebar-footer">{footer}</div> : null}
        {onLogout ? (
          <div className="stratos-settings-sidebar-footer">
            <button type="button" className="stratos-settings-logout" onClick={onLogout}>
              <LogOut size={16} aria-hidden="true" />
              {logoutLabel}
            </button>
          </div>
        ) : null}
      </aside>

      <main className="stratos-settings-main">
        <div className="stratos-settings-main-toolbar">{actions ? <div className="stratos-settings-actions">{actions}</div> : null}</div>
        <div className="stratos-settings-content">
          {activeSections.map((section) => (
            <section className="stratos-settings-section" key={section.id}>
              <div className="stratos-settings-section-heading">
                <h3>{section.title}</h3>
                {section.description ? <p>{section.description}</p> : null}
              </div>
              <div className="stratos-settings-section-body">{section.children}</div>
            </section>
          ))}
        </div>

        {onSave ? (
          <div className="stratos-settings-savebar">
            <button type="button" disabled={!dirty} onClick={onSave}>
              {dirty ? saveLabel : savedLabel}
            </button>
          </div>
        ) : null}
      </main>
    </section>
  );

  if (!shouldUseLayer) return surface;

  return (
    <div className={["stratos-settings-layer", effectiveMode ? `is-${effectiveMode}` : null].filter(Boolean).join(" ")} role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="stratos-settings-backdrop" aria-label={closeLabel} onClick={requestClose} />
      {surface}
    </div>
  );
}
