"use client";

import { useMemo, useState } from "react";
import { Download, ShieldCheck, X } from "lucide-react";
import { AccessAuditList } from "@voldzi/stratos-ui";

import { StratosSearchBox } from "@/components/stratos";
import { useLanguage, type AklLanguage } from "@/lib/i18n";
import type { AuditEvent, AuditSeverity, AuthorizationHint } from "@/lib/types";
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
    empty: "Žádné auditní události.",
    search: "Hledat",
    searchPlaceholder: "Událost, aktér, zdroj nebo korelace",
    allEvents: "Všechny události",
    allSeverities: "Všechny závažnosti",
    eventType: "Typ události",
    severityFilter: "Závažnost",
    clear: "Vymazat filtry",
    export: "Exportovat CSV",
    resultCount: "zobrazeno"
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
    empty: "No audit events.",
    search: "Search",
    searchPlaceholder: "Event, actor, resource, or correlation",
    allEvents: "All events",
    allSeverities: "All severities",
    eventType: "Event type",
    severityFilter: "Severity",
    clear: "Clear filters",
    export: "Export CSV",
    resultCount: "shown"
  }
} satisfies Record<AklLanguage, Record<string, string>>;

export function AuditViewer({ events, authorization }: AuditViewerProps) {
  const { language } = useLanguage();
  const copy = auditCopy[language];
  const [query, setQuery] = useState("");
  const [eventType, setEventType] = useState("");
  const [severity, setSeverity] = useState<AuditSeverity | "">("");
  const eventTypes = useMemo(
    () => [...new Set(events.map((event) => event.event_type))].sort((left, right) => left.localeCompare(right)),
    [events],
  );
  const filteredEvents = useMemo(() => {
    const normalizedQuery = normalizeAuditSearch(query);
    return events.filter((event) => {
      if (eventType && event.event_type !== eventType) return false;
      if (severity && event.severity !== severity) return false;
      if (!normalizedQuery) return true;
      return normalizeAuditSearch([
        event.event_type,
        event.actor_id,
        event.resource_type,
        event.resource_id,
        event.correlation_id,
        event.audit_event_id,
      ].join(" ")).includes(normalizedQuery);
    });
  }, [eventType, events, query, severity]);

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

  const auditItems = filteredEvents.map((event) =>
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
        <span className="muted">{filteredEvents.length} / {events.length} {copy.resultCount}</span>
      </div>
      <div className="panel__body stack">
        <div className="audit-toolbar">
          <StratosSearchBox
            id="audit-search"
            label={copy.search}
            value={query}
            placeholder={copy.searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label className="stratos-field" htmlFor="audit-event-type">
            <span>{copy.eventType}</span>
            <select id="audit-event-type" value={eventType} onChange={(event) => setEventType(event.target.value)}>
              <option value="">{copy.allEvents}</option>
              {eventTypes.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="stratos-field" htmlFor="audit-severity">
            <span>{copy.severityFilter}</span>
            <select
              id="audit-severity"
              value={severity}
              onChange={(event) => setSeverity(event.target.value as AuditSeverity | "")}
            >
              <option value="">{copy.allSeverities}</option>
              {(["debug", "info", "warning", "error", "critical"] as AuditSeverity[]).map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
          <div className="audit-toolbar__actions">
            {query || eventType || severity ? (
              <button
                className="button"
                type="button"
                onClick={() => {
                  setQuery("");
                  setEventType("");
                  setSeverity("");
                }}
              >
                <X size={15} aria-hidden="true" />
                {copy.clear}
              </button>
            ) : null}
            <button
              className="button"
              type="button"
              disabled={filteredEvents.length === 0}
              onClick={() => exportAuditCsv(filteredEvents)}
            >
              <Download size={15} aria-hidden="true" />
              {copy.export}
            </button>
          </div>
        </div>
        <AccessAuditList items={auditItems} emptyLabel={copy.empty} />
      </div>
    </section>
  );
}

function normalizeAuditSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function exportAuditCsv(events: AuditEvent[]) {
  const rows = [
    ["created_at", "severity", "event_type", "actor_id", "resource_type", "resource_id", "correlation_id", "audit_event_id"],
    ...events.map((event) => [
      event.created_at,
      event.severity,
      event.event_type,
      event.actor_id,
      event.resource_type,
      event.resource_id,
      event.correlation_id,
      event.audit_event_id,
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `akb-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
