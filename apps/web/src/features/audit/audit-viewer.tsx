"use client";

import { ShieldCheck } from "lucide-react";
import { AccessAuditList } from "@voldzi/stratos-ui";

import { useLanguage, type AklLanguage } from "@/lib/i18n";
import type { AuditEvent, AuthorizationHint } from "@/lib/types";
import { accessAuditItemFromEvent } from "./access-audit-items";

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

  const auditItems = events.map((event) =>
    accessAuditItemFromEvent(event, {
      language,
      labels: {
        actor: copy.actor,
        resource: copy.resource,
        correlation: copy.correlation,
        created: copy.created
      },
      extraDetails: [`${copy.severity}: ${event.severity}`, `${copy.event}: ${event.audit_event_id}`]
    })
  );

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>{copy.title}</h2>
        <ShieldCheck size={18} aria-hidden="true" />
      </div>
      <div className="panel__body">
        <AccessAuditList items={auditItems} emptyLabel={copy.empty} />
      </div>
    </section>
  );
}
