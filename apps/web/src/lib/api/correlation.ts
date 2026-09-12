import type { ApiRequestContext } from "@/lib/types";

export function createRequestId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function withCorrelationDefaults(context: ApiRequestContext): Required<Pick<ApiRequestContext, "requestId" | "correlationId">> &
  ApiRequestContext {
  const requestId = context.requestId ?? createRequestId();
  return {
    ...context,
    requestId,
    correlationId: context.correlationId ?? requestId
  };
}

const TRANSPORT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

type RequestHeaderReader = Pick<Headers, "get">;

/**
 * Bind observability identifiers to the current HTTP request after its bearer
 * identity has been authorized. Access projection contexts can be cached by
 * token, so request-specific identifiers must never be stored in that cache.
 */
export function withRequestCorrelation(
  context: ApiRequestContext,
  headers: RequestHeaderReader,
): Required<Pick<ApiRequestContext, "requestId" | "correlationId">> & ApiRequestContext {
  const suppliedRequestId = validTransportId(headers.get("X-Request-ID"));
  const suppliedCorrelationId = validTransportId(headers.get("X-Correlation-ID"));
  const requestId = suppliedRequestId ?? createRequestId();
  return {
    ...context,
    requestId,
    correlationId: suppliedCorrelationId ?? requestId,
  };
}

function validTransportId(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return TRANSPORT_ID_PATTERN.test(normalized) ? normalized : null;
}

export function createMockContext(overrides: Partial<ApiRequestContext> = {}): ApiRequestContext {
  return {
    subjectId: "user_123",
    requestId: createRequestId(),
    correlationId: createRequestId(),
    ...overrides
  };
}
