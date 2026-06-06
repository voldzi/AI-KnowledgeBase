import type { ApiErrorBody, ApiRequestContext } from "@/lib/types";
import { ApiClientError } from "@/lib/types";

import { logIntegrationEvent } from "./logger";
import { withCorrelationDefaults } from "./correlation";

export type AklFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface JsonRequestOptions {
  service: "registry-api" | "ingestion-service" | "rag-retrieval-service";
  operation: string;
  baseUrl: string;
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  context: ApiRequestContext;
  fetcher?: AklFetch;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ApiErrorBody).error?.code === "string"
  );
}

export async function requestJson<T>(options: JsonRequestOptions): Promise<T> {
  const context = withCorrelationDefaults(options.context);
  const url = `${options.baseUrl}${options.path}`;
  const startedAt = performance.now();

  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Request-ID": context.requestId,
    "X-Correlation-ID": context.correlationId
  });

  headers.set("X-AKL-Subject", context.subjectId);
  if (context.roles?.length) {
    headers.set("X-AKL-Roles", context.roles.join(","));
  }
  if (context.groups?.length) {
    headers.set("X-AKL-Groups", context.groups.join(","));
  }

  if (context.accessToken) {
    headers.set("Authorization", `Bearer ${context.accessToken}`);
  }

  const response = await (options.fetcher ?? fetch)(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store"
  });

  const latencyMs = Math.round(performance.now() - startedAt);
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : undefined;

  if (!response.ok) {
    const code = isApiErrorBody(payload) ? payload.error.code : "UPSTREAM_ERROR";
    const message = isApiErrorBody(payload) ? payload.error.message : "Upstream request failed";
    const traceId = isApiErrorBody(payload) ? payload.error.trace_id : context.correlationId;
    logIntegrationEvent({
      level: "error",
      service: options.service,
      operation: options.operation,
      status: response.status,
      latencyMs,
      requestId: context.requestId,
      correlationId: context.correlationId,
      errorCode: code
    });
    throw new ApiClientError(message, response.status, code, traceId);
  }

  logIntegrationEvent({
    level: "info",
    service: options.service,
    operation: options.operation,
    status: response.status,
    latencyMs,
    requestId: context.requestId,
    correlationId: context.correlationId
  });

  return payload as T;
}
