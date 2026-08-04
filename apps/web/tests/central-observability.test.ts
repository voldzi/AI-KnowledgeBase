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
const assistantRoute = readFileSync(
  new URL("../src/app/api/assistant/chat/route.ts", import.meta.url),
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
    assert.match(instrumentation, /OTEL_SDK_DISABLED/);
    assert.match(instrumentation, /registerOTel/);
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
});
