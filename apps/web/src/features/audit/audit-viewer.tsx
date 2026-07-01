"use client";

import { ShieldCheck } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { StratosDataTable, type StratosDataTableColumn } from "@/components/stratos";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import type { AuditEvent, AuthorizationHint } from "@/lib/types";
import { formatDateTime } from "@/lib/format";

interface AuditViewerProps {
  events: AuditEvent[];
  authorization: AuthorizationHint;
}

const auditCopy = {
  cs: {
    hidden: "Auditní stopa není pro tuto relaci dostupná.",
    title: "Auditní události",
    event: "Událost",
    severity: "Závažnost",
    actor: "Aktér",
    resource: "Zdroj",
    correlation: "Korelace",
    created: "Vytvořeno",
    empty: "Žádné auditní události."
  },
  en: {
    hidden: "Audit trail is not available for this session.",
    title: "Audit events",
    event: "Event",
    severity: "Severity",
    actor: "Actor",
    resource: "Resource",
    correlation: "Correlation",
    created: "Created",
    empty: "No audit events."
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

  const columns: Array<StratosDataTableColumn<AuditEvent>> = [
    {
      id: "event",
      label: copy.event,
      sortable: true,
      sortAccessor: (event) => event.event_type,
      render: (event) => (
        <span className="cell-title">
          <strong>{event.event_type}</strong>
          <span>{event.audit_event_id}</span>
        </span>
      )
    },
    {
      id: "severity",
      label: copy.severity,
      width: 130,
      sortable: true,
      sortAccessor: (event) => event.severity,
      render: (event) => <StatusBadge value={event.severity} />
    },
    {
      id: "actor",
      label: copy.actor,
      sortable: true,
      sortAccessor: (event) => event.actor_id,
      render: (event) => event.actor_id
    },
    {
      id: "resource",
      label: copy.resource,
      render: (event) => `${event.resource_type} / ${event.resource_id}`
    },
    {
      id: "correlation",
      label: copy.correlation,
      render: (event) => event.correlation_id
    },
    {
      id: "created",
      label: copy.created,
      width: 170,
      sortable: true,
      sortAccessor: (event) => event.created_at,
      render: (event) => formatDateTime(event.created_at, language)
    }
  ];

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>{copy.title}</h2>
        <ShieldCheck size={18} aria-hidden="true" />
      </div>
      <StratosDataTable
        aria-label={copy.title}
        rows={events}
        columns={columns}
        getRowId={(event) => event.audit_event_id}
        emptyLabel={copy.empty}
      />
    </section>
  );
}
