import { ShieldCheck } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import type { AuditEvent, AuthorizationHint } from "@/lib/types";
import { formatDateTime } from "@/lib/format";

interface AuditViewerProps {
  events: AuditEvent[];
  authorization: AuthorizationHint;
}

export function AuditViewer({ events, authorization }: AuditViewerProps) {
  if (!authorization.can_read_audit) {
    return (
      <section className="panel">
        <div className="empty-state">
          <ShieldCheck size={24} aria-hidden="true" />
          Audit viewer is hidden because Registry API did not grant audit.read.
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Audit events</h2>
        <ShieldCheck size={18} aria-hidden="true" />
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Event</th>
            <th>Severity</th>
            <th>Actor</th>
            <th>Resource</th>
            <th>Correlation</th>
            <th>Created</th>
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
              <td>{formatDateTime(event.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
