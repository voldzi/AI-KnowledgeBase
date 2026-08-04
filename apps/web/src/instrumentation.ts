import { registerOTel } from "@vercel/otel";

const telemetryRegistrationKey = Symbol.for("akb.otel.registered");

function telemetryEnabled(): boolean {
  return (process.env.AKL_OTEL_ENABLED ?? "false").trim().toLowerCase() === "true";
}

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !telemetryEnabled()) {
    return;
  }

  const runtime = globalThis as unknown as Record<PropertyKey, unknown>;
  if (runtime[telemetryRegistrationKey] === true) {
    return;
  }

  runtime[telemetryRegistrationKey] = true;
  try {
    registerOTel({
      serviceName: process.env.OTEL_SERVICE_NAME ?? "akb-web",
    });
  } catch (error) {
    delete runtime[telemetryRegistrationKey];
    throw error;
  }
}
