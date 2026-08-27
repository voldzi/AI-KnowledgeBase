import type { Configuration, OTLPHttpProtoTraceExporter } from "@vercel/otel";

type Exporter = Exclude<Configuration["traceExporter"], string | undefined>;
type ReadableSpan = Parameters<OTLPHttpProtoTraceExporter["export"]>[0][number];
type Attributes = ReadableSpan["attributes"];

const SENSITIVE_ATTRIBUTE = /authorization|cookie|token|secret|password|credential|header|body|prompt|answer|content|exception|db\.statement|db\.query|db\.operation\.parameter/i;
const IDENTITY_ROUTE = /\/api\/auth(?:\/|\b)|\/internal\/web-sessions(?:\/|\b)|\/identity(?:\/|\b)|\/protocol\/openid-connect(?:\/|\b)|[?&](?:code|state|ticket|id_token|access_token)=/i;

export function safeTraceAttributes(attributes: Attributes): Attributes {
  const result: Record<string, Attributes[string]> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (SENSITIVE_ATTRIBUTE.test(key)) continue;
    if (/url|target|path|route/i.test(key) && typeof value === "string") {
      result[key] = value.split(/[?#]/, 1)[0];
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function sanitizeTraceSpan(span: ReadableSpan): ReadableSpan | null {
  const routing = [span.name, ...Object.entries(span.attributes)
    .filter(([key]) => /url|target|path|route/i.test(key)).map(([, value]) => String(value))];
  if (routing.some((value) => IDENTITY_ROUTE.test(value))) return null;
  return {
    ...span,
    spanContext: () => span.spanContext(),
    name: span.name.split(/[?#]/, 1)[0]!,
    attributes: safeTraceAttributes(span.attributes),
    status: { code: span.status.code },
    events: span.events.filter((event) => event.name !== "exception")
      .map((event) => ({ ...event, attributes: safeTraceAttributes(event.attributes ?? {}) })),
    links: span.links.map((link) => ({ ...link, attributes: safeTraceAttributes(link.attributes ?? {}) })),
  };
}

export class SafeTraceExporter implements Exporter {
  constructor(private readonly delegate: Exporter) {}

  export(spans: ReadableSpan[], callback: Parameters<Exporter["export"]>[1]): void {
    const safe = spans.map(sanitizeTraceSpan).filter((span): span is ReadableSpan => span !== null);
    if (!safe.length) { callback({ code: 0 }); return; }
    this.delegate.export(safe, callback);
  }

  shutdown(): Promise<void> { return this.delegate.shutdown(); }
  forceFlush(): Promise<void> { return this.delegate.forceFlush?.() ?? Promise.resolve(); }
}
