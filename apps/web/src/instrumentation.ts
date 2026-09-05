import { OTLPHttpJsonTraceExporter, OTLPHttpProtoTraceExporter, registerOTel } from "@vercel/otel";
import { SafeTraceExporter } from "@/lib/observability/safe-trace-exporter";

const telemetryRegistrationKey = Symbol.for("akb.otel.registered");

function telemetryEnabled(): boolean {
  return (process.env.AKL_OTEL_ENABLED ?? "false").trim().toLowerCase() === "true";
}

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !telemetryEnabled() || !(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT)) {
    return;
  }

  const runtime = globalThis as unknown as Record<PropertyKey, unknown>;
  if (runtime[telemetryRegistrationKey] === true) {
    return;
  }

  runtime[telemetryRegistrationKey] = true;
  try {
    const protocol = process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ?? process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? "http/protobuf";
    if (!["http/protobuf", "http/json"].includes(protocol)) throw new Error("WEB_TELEMETRY_PROTOCOL_UNSUPPORTED");
    registerOTel({
      serviceName: process.env.OTEL_SERVICE_NAME ?? "akb-web",
      traceExporter: new SafeTraceExporter(protocol === "http/json" ? new OTLPHttpJsonTraceExporter() : new OTLPHttpProtoTraceExporter()),
      instrumentationConfig: { fetch: { ignoreUrls: [/\/api\/auth\//, /\/identity\//, /\/protocol\/openid-connect\//] } },
    });
  } catch (error) {
    delete runtime[telemetryRegistrationKey];
    throw error;
  }
}
