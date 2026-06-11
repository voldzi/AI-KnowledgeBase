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

Provisioned dashboards:

- `AKB Platform Health` for target health and platform status request rate.
- `AKB Observability` for target health, OpenTelemetry accepted spans, trace
  exporter throughput, span errors, and platform status request rate.

Provisioned Prometheus alert rules are stored in
`infra/monitoring/prometheus/rules/akb-alerts.yml` and cover:

- down monitoring targets,
- platform status 5xx responses,
- refused spans,
- failed span export,
- trace exporter queue backlog.

## Tracing

AKB keeps request id and correlation id propagation in the application code and
adds OpenTelemetry tracing when `OTEL_SDK_DISABLED=false`. The docker-home
deployment has an optional OpenTelemetry foundation:

- `otel-collector` receives OTLP traces, metrics and logs inside Docker networks,
- `tempo` stores traces,
- `prometheus` scrapes platform metrics and the collector metrics exporter,
- `grafana` is provisioned with Prometheus, Loki and Tempo datasources,
- `loki` is available for controlled log ingestion.

The optional production override is:

```bash
docker compose \
  -f infra/docker-compose/docker-compose.docker-home.yml \
  -f infra/docker-compose/docker-compose.docker-home-observability.yml \
  up -d
```

The collector is intentionally not exposed through the public reverse proxy.
Grafana is reachable through the AKB Caddy `/akb/grafana/` route when the
observability override is enabled and `GRAFANA_ADMIN_PASSWORD` is set outside
Git. Do not route public STRATOS application traffic directly to Prometheus,
Tempo or Loki.

Application services do not depend on the collector for startup. If the
observability stack is unavailable, AKB services should continue to run and keep
using health/readiness plus request/correlation ids.

The following Python FastAPI services emit inbound HTTP spans and `httpx`
outbound client spans when tracing is enabled:

- Registry API,
- Ingestion Service,
- RAG Retrieval Service,
- LLM Gateway Service,
- Evaluation Service,
- Governance Service.

The next observability rollout steps are:

1. Next.js web bridge spans for `/akb/api/*`, especially STRATOS upload,
   source open, viewer, citation and RAG flows.
2. Domain metrics for ingestion duration, retrieval latency, LLM latency,
   citation coverage, source-open failures and authorization denied counts.
3. Logs enriched with `trace_id` and `span_id` while preserving the existing
   AKB `trace_id` error field compatibility.

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
