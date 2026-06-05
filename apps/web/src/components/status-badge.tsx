import type { AuditSeverity, DocumentStatus, IngestionStatus, RagConfidence } from "@/lib/types";

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

export function StatusBadge({ value, label }: StatusBadgeProps) {
  const tone = toneByStatus[value] ?? "neutral";
  return <span className={`status-badge status-badge--${tone}`}>{label ?? value.replaceAll("_", " ")}</span>;
}
