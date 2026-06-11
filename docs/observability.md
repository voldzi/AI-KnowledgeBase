# AKB Observability

AKB observability covers structured logs, request/correlation propagation,
metrics, tracing strategy, health/readiness checks, and operational dashboards.

## Logging

Service logs are structured JSON where implemented and include:

- timestamp,
- level,
- service,
- message,
- request id,
- correlation id,
- environment,
- version where available.

Logs must not include full prompts, full answers, full source text, secrets,
tokens, passwords, private keys, or unnecessary personal data.

## Request And Correlation IDs

AKB propagates:

```text
X-Request-ID
X-Correlation-ID
```

If a caller does not provide them, services generate ids and return them in
response headers where implemented.

## Metrics

Important platform metrics:

- request count,
- latency,
- error rate,
- ingestion duration,
- chunks created,
- retrieval latency,
- LLM latency,
- token usage,
- no-answer rate,
- citation coverage,
- authorization denied count.

Prometheus/Grafana/Loki are included in the local deployment stack for
observability experiments and dashboards.

## Tracing

AKB currently relies on request id and correlation id propagation as the
documented tracing alternative. OpenTelemetry is a planned hardening item and
must be introduced consistently across services when adopted.

## Health And Readiness

Health indicates process liveness. Readiness indicates whether the service can
reach the dependencies required for its current mode.

Key endpoints:

```text
GET /health
GET /ready
GET /api/health
GET /api/ready
```

## Alerts

Recommended alert areas:

- service unavailable,
- readiness failure,
- rising 5xx rate,
- ingestion failures,
- Qdrant vector-size mismatch,
- retrieval latency degradation,
- LLM provider unavailable,
- high no-answer rate,
- authorization denied spike,
- source-opening failures.

Detailed references:

- `docs/OPERATIONS/07_DEPLOYMENT_MODEL.md`
- `docs/api/platform-status.md`
- `services/platform-infrastructure/README.md`
- service-local README files under `services/`
