"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search, X } from "lucide-react";

export type CommandCenterItemType =
  | "action"
  | "dashboard"
  | "folder"
  | "person"
  | "project"
  | "report"
  | "space"
  | "task"
  | "team";

export type CommandCenterTone = "default" | "amber" | "blue" | "green" | "purple" | "red";

export type CommandCenterAction = {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
  closeOnSelect?: boolean;
  onSelect: () => void;
};

export type CommandCenterItem = {
  id: string;
  type: CommandCenterItemType;
  title: string;
  subtitle?: string;
  detail?: string;
  section?: string;
  keywords?: string[];
  icon?: ReactNode;
  tone?: CommandCenterTone;
  primaryAction?: CommandCenterAction;
  actions?: CommandCenterAction[];
};

export type CommandCenterLabels = {
  title: string;
  placeholder: string;
  noResults: string;
  open: string;
  close: string;
  actions: string;
  preview: string;
};

interface CommandCenterProps {
  open: boolean;
  query: string;
  items: CommandCenterItem[];
  labels: CommandCenterLabels;
  onQueryChange: (value: string) => void;
  onClose: () => void;
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function itemSearchText(item: CommandCenterItem) {
  return normalize([item.title, item.subtitle, item.detail, item.section, item.type, ...(item.keywords ?? [])].filter(Boolean).join(" "));
}

export function CommandCenter({ open, query, items, labels, onClose, onQueryChange }: CommandCenterProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filteredItems = useMemo(() => {
    const needle = normalize(query.trim());
    if (!needle) {
      return items.slice(0, 16);
    }
    return items.filter((item) => itemSearchText(item).includes(needle)).slice(0, 30);
  }, [items, query]);

  const selectedItem = filteredItems.find((item) => item.id === selectedId) ?? filteredItems[0] ?? null;

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedId(null);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (!filteredItems.length) {
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const currentIndex = Math.max(0, filteredItems.findIndex((item) => item.id === selectedItem?.id));
        const nextIndex =
          event.key === "ArrowDown"
            ? Math.min(filteredItems.length - 1, currentIndex + 1)
            : Math.max(0, currentIndex - 1);
        setSelectedId(filteredItems[nextIndex]?.id ?? null);
      }

      if (event.key === "Enter" && selectedItem) {
        event.preventDefault();
        const action = selectedItem.primaryAction ?? selectedItem.actions?.find((candidate) => !candidate.disabled);
        if (!action || action.disabled) {
          return;
        }
        action.onSelect();
        if (action.closeOnSelect !== false) {
          onClose();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [filteredItems, onClose, open, selectedItem]);

  if (!open) {
    return null;
  }

  const groupedItems = filteredItems.reduce<Array<{ section: string; items: CommandCenterItem[] }>>((groups, item) => {
    const section = item.section ?? item.type;
    const existing = groups.find((group) => group.section === section);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.push({ section, items: [item] });
    }
    return groups;
  }, []);

  const executeAction = (action: CommandCenterAction) => {
    if (action.disabled) {
      return;
    }
    action.onSelect();
    if (action.closeOnSelect !== false) {
      onClose();
    }
  };

  return createPortal(
    <div className="stratos-command-center-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="stratos-command-center"
        role="dialog"
        aria-modal="true"
        aria-label={labels.title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="stratos-command-center-header">
          <div>
            <h2>{labels.title}</h2>
            <p>{labels.preview}</p>
          </div>
          <button type="button" aria-label={labels.close} onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <label className="stratos-command-center-search">
          <Search size={19} aria-hidden="true" />
          <input ref={inputRef} value={query} placeholder={labels.placeholder} onChange={(event) => onQueryChange(event.target.value)} />
        </label>

        <div className="stratos-command-center-body">
          <div className="stratos-command-center-results" role="listbox" aria-label={labels.title}>
            {groupedItems.length ? (
              groupedItems.map((group) => (
                <section key={group.section}>
                  <h3>{group.section}</h3>
                  {group.items.map((item) => {
                    const selected = selectedItem?.id === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`stratos-command-center-row tone-${item.tone ?? "default"} ${selected ? "is-selected" : ""}`}
                        aria-selected={selected}
                        role="option"
                        onMouseEnter={() => setSelectedId(item.id)}
                        onClick={() => {
                          const action = item.primaryAction ?? item.actions?.find((candidate) => !candidate.disabled);
                          if (action) {
                            executeAction(action);
                          }
                        }}
                      >
                        <span className="stratos-command-center-icon">{item.icon}</span>
                        <span>
                          <strong>{item.title}</strong>
                          {item.subtitle ? <small>{item.subtitle}</small> : null}
                        </span>
                        {selected ? <Check size={16} aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                </section>
              ))
            ) : (
              <p className="stratos-command-center-empty">{labels.noResults}</p>
            )}
          </div>

          <aside className="stratos-command-center-preview">
            {selectedItem ? (
              <>
                <div className={`stratos-command-center-preview-icon tone-${selectedItem.tone ?? "default"}`}>{selectedItem.icon}</div>
                <h3>{selectedItem.title}</h3>
                {selectedItem.subtitle ? <p>{selectedItem.subtitle}</p> : null}
                {selectedItem.detail ? <small>{selectedItem.detail}</small> : null}
                <div className="stratos-command-center-actions" aria-label={labels.actions}>
                  {(selectedItem.actions?.length ? selectedItem.actions : selectedItem.primaryAction ? [selectedItem.primaryAction] : []).map((action) => (
                    <button key={action.id} type="button" disabled={action.disabled} onClick={() => executeAction(action)}>
                      {action.icon}
                      <span>{action.label}</span>
                      {action.hint ? <kbd>{action.hint}</kbd> : null}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </aside>
        </div>
      </section>
    </div>,
    document.body
  );
}
