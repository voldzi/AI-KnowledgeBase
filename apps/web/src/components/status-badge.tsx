"use client";

import type { AuditSeverity, DocumentStatus, IngestionStatus, RagConfidence } from "@/lib/types";
import { useLanguage, type AklLanguage } from "@/lib/i18n";

type StatusValue = DocumentStatus | IngestionStatus | RagConfidence | AuditSeverity | "online" | "offline";

interface StatusBadgeProps {
  value: StatusValue;
  label?: string;
}

const toneByStatus: Record<string, string> = {
  valid: "success",
  completed: "success",
  high: "success",
  online: "success",
  info: "success",
  review: "attention",
  approved: "success",
  queued: "attention",
  running: "attention",
  completed_with_warnings: "attention",
  warning: "attention",
  medium: "attention",
  draft: "neutral",
  low: "neutral",
  debug: "neutral",
  archived: "muted",
  superseded: "muted",
  cancelled: "muted",
  insufficient_source: "danger",
  conflicting_sources: "danger",
  failed: "danger",
  error: "danger",
  critical: "danger",
  offline: "danger"
};

const localizedStatus: Record<AklLanguage, Record<string, string>> = {
  cs: {
    valid: "platné",
    completed: "dokončeno",
    high: "vysoká",
    online: "online",
    info: "info",
    review: "revize",
    approved: "schváleno",
    queued: "ve frontě",
    running: "běží",
    completed_with_warnings: "dokončeno s varováním",
    warning: "varování",
    medium: "střední",
    draft: "koncept",
    low: "nízká",
    debug: "debug",
    archived: "archivováno",
    superseded: "nahrazeno",
    cancelled: "zrušeno",
    insufficient_source: "nedostatečný zdroj",
    conflicting_sources: "konfliktní zdroje",
    failed: "selhalo",
    error: "chyba",
    critical: "kritické",
    offline: "offline"
  },
  en: {}
};

export function StatusBadge({ value, label }: StatusBadgeProps) {
  const { language } = useLanguage();
  const tone = toneByStatus[value] ?? "neutral";
  return (
    <span className={`status-badge status-badge--${tone}`}>
      {label ?? localizedStatus[language][value] ?? value.replaceAll("_", " ")}
    </span>
  );
}
