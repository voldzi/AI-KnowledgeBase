import { registerOTel } from "@vercel/otel";

function telemetryEnabled(): boolean {
  return (process.env.AKL_OTEL_ENABLED ?? "false").trim().toLowerCase() === "true";
}

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !telemetryEnabled()) {
    return;
  }

  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "akb-web",
  });
}
