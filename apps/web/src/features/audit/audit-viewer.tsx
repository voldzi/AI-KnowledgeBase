"use client";

import { ShieldCheck } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import type { AuditEvent, AuthorizationHint } from "@/lib/types";
import { formatDateTime } from "@/lib/format";

interface AuditViewerProps {
  events: AuditEvent[];
  authorization: AuthorizationHint;
}

const auditCopy = {
  cs: {
    hidden: "Auditní prohlížeč je skrytý, protože Registry API neudělilo audit.read.",
    title: "Auditní události",
    event: "Událost",
    severity: "Závažnost",
    actor: "Aktér",
    resource: "Zdroj",
    correlation: "Korelace",
    created: "Vytvořeno"
  },
  en: {
    hidden: "Audit viewer is hidden because Registry API did not grant audit.read.",
    title: "Audit events",
    event: "Event",
    severity: "Severity",
    actor: "Actor",
    resource: "Resource",
    correlation: "Correlation",
    created: "Created"
  }
} satisfies Record<AklLanguage, Record<string, string>>;

export function AuditViewer({ events, authorization }: AuditViewerProps) {
  const { language } = useLanguage();
  const copy = auditCopy[language];

  if (!authorization.can_read_audit) {
    return (
      <section className="panel">
        <div className="empty-state">
          <ShieldCheck size={24} aria-hidden="true" />
          {copy.hidden}
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>{copy.title}</h2>
        <ShieldCheck size={18} aria-hidden="true" />
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>{copy.event}</th>
            <th>{copy.severity}</th>
            <th>{copy.actor}</th>
            <th>{copy.resource}</th>
            <th>{copy.correlation}</th>
            <th>{copy.created}</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.audit_event_id}>
              <td>
                <span className="cell-title">
                  <strong>{event.event_type}</strong>
                  <span>{event.audit_event_id}</span>
                </span>
              </td>
              <td>
                <StatusBadge value={event.severity} />
              </td>
              <td>{event.actor_id}</td>
              <td>{event.resource_type} / {event.resource_id}</td>
              <td>{event.correlation_id}</td>
              <td>{formatDateTime(event.created_at, language)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
