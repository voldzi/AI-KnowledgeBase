type IntegrationLogLevel = "info" | "warn" | "error";

interface IntegrationLogEvent {
  level: IntegrationLogLevel;
  service: "registry-api" | "ingestion-service" | "rag-retrieval-service" | "governance-service" | "evaluation-service";
  operation: string;
  status?: number;
  latencyMs?: number;
  requestId?: string;
  correlationId?: string;
  errorCode?: string;
}

export function logIntegrationEvent(event: IntegrationLogEvent): void {
  const record = {
    service: event.service,
    operation: event.operation,
    status: event.status,
    latency_ms: event.latencyMs,
    request_id: event.requestId,
    correlation_id: event.correlationId,
    error_code: event.errorCode
  };

  if (event.level === "error") {
    console.error(JSON.stringify(record));
    return;
  }

  if (event.level === "warn") {
    console.warn(JSON.stringify(record));
    return;
  }

  console.info(JSON.stringify(record));
}
