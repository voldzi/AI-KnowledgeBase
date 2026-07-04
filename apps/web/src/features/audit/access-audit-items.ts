import type { AccessAuditListItem } from "@voldzi/stratos-ui";

import { formatDateTime } from "@/lib/format";
import type { AklLanguage } from "@/lib/i18n";
import type { AuditEvent, AuditSeverity } from "@/lib/types";

interface AuditItemOptions {
  language: AklLanguage;
  labels?: {
    actor?: string;
    resource?: string;
    correlation?: string;
    created?: string;
  };
  extraDetails?: string[];
}

export function accessAuditItemFromEvent(event: AuditEvent, options: AuditItemOptions): AccessAuditListItem {
  const labels = options.labels ?? {};
  const details = [
    labeled(labels.actor, event.actor_id),
    labeled(labels.resource, `${event.resource_type} / ${event.resource_id}`),
    labeled(labels.correlation, event.correlation_id),
    labeled(labels.created, formatDateTime(event.created_at, options.language)),
    ...(options.extraDetails ?? [])
  ].filter((detail): detail is string => Boolean(detail));

  return {
    id: event.audit_event_id,
    title: event.event_type,
    detail: details.join(" · "),
    tone: accessAuditToneForSeverity(event.severity)
  };
}

export function accessAuditToneForSeverity(severity: AuditSeverity): AccessAuditListItem["tone"] {
  if (severity === "critical" || severity === "error") {
    return "danger";
  }
  if (severity === "warning") {
    return "warning";
  }
  if (severity === "info") {
    return "good";
  }
  return "neutral";
}

function labeled(label: string | undefined, value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return label ? `${label}: ${value}` : value;
}
