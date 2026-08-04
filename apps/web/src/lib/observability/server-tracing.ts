import "server-only";

import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";

type SafeSpanAttributes = Record<string, boolean | number | string>;

export async function withServerSpan<T>(
  name: string,
  attributes: SafeSpanAttributes,
  operation: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer("akb-web");

  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await operation(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error("Unknown server error"));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
