type IntegrationLogLevel = "info" | "warn" | "error";

interface IntegrationLogEvent {
  level: IntegrationLogLevel;
  service: "registry-api" | "ingestion-service" | "rag-retrieval-service" | "governance-service" | "evaluation-service" | "director-copilot";
  operation: string;
  status?: number;
  latencyMs?: number;
  requestId?: string;
  correlationId?: string;
  errorCode?: string;
  diagnosticCode?: string;
  diagnosticPaths?: string[];
}

export function logIntegrationEvent(event: IntegrationLogEvent): void {
  const record = {
    service: event.service,
    operation: event.operation,
    status: event.status,
    latency_ms: event.latencyMs,
    request_id: event.requestId,
    correlation_id: event.correlationId,
    error_code: event.errorCode,
    diagnostic_code: event.diagnosticCode,
    diagnostic_paths: event.diagnosticPaths,
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
