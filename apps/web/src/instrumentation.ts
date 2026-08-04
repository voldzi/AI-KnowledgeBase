import { registerOTel } from "@vercel/otel";

function telemetryEnabled(): boolean {
  return (process.env.OTEL_SDK_DISABLED ?? "true").trim().toLowerCase() === "false";
}

export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !telemetryEnabled()) {
    return;
  }

  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "akb-web",
  });
}
