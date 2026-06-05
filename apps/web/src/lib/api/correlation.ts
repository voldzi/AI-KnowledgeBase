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

export function createMockContext(overrides: Partial<ApiRequestContext> = {}): ApiRequestContext {
  return {
    subjectId: "user_123",
    requestId: createRequestId(),
    correlationId: createRequestId(),
    ...overrides
  };
}
