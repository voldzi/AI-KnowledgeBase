export type AuditSeverity = "debug" | "info" | "warning" | "error" | "critical";

export interface AuditEvent {
  audit_event_id: string;
  actor_id: string;
  event_type: string;
  resource_type: string;
  resource_id: string;
  severity: AuditSeverity;
  correlation_id: string;
  metadata: Record<string, string | number | boolean | null>;
  created_at: string;
}

export interface CreateAuditEventRequest {
  actor_id: string;
  event_type: string;
  resource_type: string;
  resource_id: string;
  severity: AuditSeverity;
  metadata: Record<string, string | number | boolean | null>;
}

export interface AuditEventListOptions {
  actorId?: string;
  eventType?: string;
  resourceType?: string;
  resourceId?: string;
  limit?: number;
  offset?: number;
}
