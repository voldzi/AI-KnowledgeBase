import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const compose = readFileSync(
  new URL("../../../infra/docker-compose/docker-compose.docker-home.yml", import.meta.url),
  "utf8",
);
const instrumentation = readFileSync(
  new URL("../src/instrumentation.ts", import.meta.url),
  "utf8",
);
const telemetryBootstrap = readFileSync(
  new URL("../otel-bootstrap.cjs", import.meta.url),
  "utf8",
);
const dockerfile = readFileSync(
  new URL("../Dockerfile", import.meta.url),
  "utf8",
);
const assistantRoute = readFileSync(
  new URL("../src/app/api/assistant/chat/route.ts", import.meta.url),
  "utf8",
);
const centralDashboard = readFileSync(
  new URL("../../../infra/monitoring/central/akb-overview.json", import.meta.url),
  "utf8",
);

describe("central production observability", () => {
  it("uses the transport supported by each runtime", () => {
    assert.match(
      compose,
      /OTEL_EXPORTER_OTLP_ENDPOINT: \$\{OTEL_EXPORTER_OTLP_ENDPOINT:-http:\/\/192\.168\.10\.156:4317\}/,
    );
    assert.match(
      compose,
      /OTEL_EXPORTER_OTLP_PROTOCOL: \$\{OTEL_EXPORTER_OTLP_PROTOCOL:-grpc\}/,
    );
    assert.equal(
      compose.match(/OTEL_WEB_EXPORTER_OTLP_ENDPOINT:-http:\/\/192\.168\.10\.156:4318/g)?.length,
      2,
    );
    assert.equal(
      compose.match(/OTEL_WEB_EXPORTER_OTLP_PROTOCOL:-http\/protobuf/g)?.length,
      2,
    );
  });

  it("registers tracing only in an explicitly enabled Node runtime", () => {
    assert.match(instrumentation, /process\.env\.NEXT_RUNTIME !== "nodejs"/);
    assert.match(instrumentation, /AKL_OTEL_ENABLED/);
    assert.match(instrumentation, /registerOTel/);
    assert.match(instrumentation, /Symbol\.for\("akb\.otel\.registered"\)/);
  });

  it("preloads the compiled instrumentation hook in the standalone image", () => {
    assert.match(telemetryBootstrap, /AKL_OTEL_ENABLED/);
    assert.match(
      telemetryBootstrap,
      /require\("\.\/\.next\/server\/instrumentation\.js"\)/,
    );
    assert.match(telemetryBootstrap, /instrumentation\.register\(\)/);
    assert.match(
      dockerfile,
      /CMD \["node", "--require", "\/app\/otel-bootstrap\.cjs", "server\.js"\]/,
    );
  });

  it("does not pass OTEL_SDK_DISABLED to the Next.js runtime", () => {
    const webEnvironment = compose.match(
      /\n  web:\n[\s\S]*?(?=\n  chat-web:)/,
    )?.[0] ?? "";
    const chatEnvironment = compose.match(
      /\n  chat-web:\n[\s\S]*?(?=\n  registry-api:)/,
    )?.[0] ?? "";

    for (const environment of [webEnvironment, chatEnvironment]) {
      assert.match(environment, /AKL_OTEL_ENABLED: \$\{AKL_OTEL_ENABLED:-true\}/);
      assert.doesNotMatch(environment, /OTEL_SDK_DISABLED:/);
    }

    assert.match(
      compose.match(/\n  registry-api:\n[\s\S]*/)?.[0] ?? "",
      /OTEL_SDK_DISABLED: \$\{OTEL_SDK_DISABLED:-false\}/,
    );
  });

  it("records a bounded assistant span without prompt or answer attributes", () => {
    assert.match(assistantRoute, /withServerSpan\(\s*"akb\.assistant\.chat"/);
    assert.match(assistantRoute, /"akb\.operation": "assistant_chat"/);
    assert.match(
      assistantRoute,
      /"akb\.channel": process\.env\.AKL_WEB_PROFILE === "chat" \? "chat" : "workspace"/,
    );
    assert.doesNotMatch(assistantRoute, /setAttribute\([^\n]*(prompt|answer|message|document|token)/i);
  });

  it("keeps compatibility-named Python services in the central dashboard", () => {
    for (const serviceName of [
      "registry-api",
      "ingestion-service",
      "rag-retrieval-service",
      "evaluation-service",
      "governance-service",
    ]) {
      assert.match(centralDashboard, new RegExp(serviceName));
    }
  });
});
