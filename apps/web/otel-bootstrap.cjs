"use strict";

function telemetryEnabled() {
  return (process.env.AKL_OTEL_ENABLED || "false").trim().toLowerCase() === "true";
}

if (telemetryEnabled()) {
  const previousRuntime = process.env.NEXT_RUNTIME;

  try {
    process.env.NEXT_RUNTIME = "nodejs";
    const instrumentation = require("./.next/server/instrumentation.js");
    if (typeof instrumentation.register !== "function") {
      throw new Error("compiled instrumentation register hook is unavailable");
    }
    instrumentation.register();
  } catch {
    console.error("AKB telemetry bootstrap failed; the application will continue without tracing.");
  } finally {
    if (previousRuntime === undefined) {
      delete process.env.NEXT_RUNTIME;
    } else {
      process.env.NEXT_RUNTIME = previousRuntime;
    }
  }
}
