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

Next.js incoming-request logging suppresses the signed source content and
preview routes so their short-lived query credentials are not written to the
development terminal log.

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
- assistant conversations expired and physically deleted,
- assistant messages and sharing grants deleted,
- assistant deletion audit tombstones pruned.
- assistant history loads and messages redacted after current-access
  reauthorization.
- privacy-safe assistant response feedback grouped only by rating and bounded
  reason code.

RAG V2 retrieval responses include bounded `stage_timings_ms` for query
analysis, exact resolution, embeddings, candidate retrieval, authorization,
reranking, parent expansion and total retrieval. When the native GTE runtime
is used, `reranker_diagnostics` further separates MPS queue, inference, server
total and transport latency and identifies the pinned device and endpoint.
These diagnostics contain no query, document text, prompt, answer, token or
credential and are retained by the evaluation service with each case result.

Registry exports the assistant-retention counters through OpenTelemetry using
the `akb.assistant.*` metric namespace. Every purge cycle also writes one
content-free structured summary log containing only aggregate counts. It never
logs a conversation title, prompt, answer, citation, participant, or token.
History reauthorization exports
`akb.assistant.history.messages.redacted` and
`akb.assistant.history.loads.redacted`. Its audit event contains only the
conversation identifier and aggregate redacted-message count; it never stores
the withheld answer, citation or participant list.
Response feedback exports `akb.assistant.feedback.recorded`. The matching
`assistant.response.feedback` audit event contains only the message identifier,
rating, bounded reason code and an explicit marker that no content was retained.
Free-text feedback is not part of the API contract.

For the AIIP application API, operational logs and Registry audit metadata may
include operation, request/correlation/audit ids, canonical input hash, status,
latency, requested/actual model, fallback flag, token counts, index version,
and candidate/suggestion counts. They must not include AIIP record bodies,
prompts, model responses, citation text, vectors, bearer tokens, or credentials.

Production telemetry is centralized on `observability.home.cz`. AKB does not
run a second production Grafana, Prometheus, Tempo or Loki stack on
`docker.home.cz`.

Central dashboards:

- `AKB – výkon a dostupnost` for public health/readiness, request rate, p95
  latency, errors and telemetry ingestion.
- Central OpenSearch index health at
  `https://wazuh.home.cz/observability/d/akl-opensearch-index/akl-opensearch-index`.
  The matching Dashboards tenant is `akl` with data view
  `akl_document_chunks*`.

Central Prometheus alert rules are stored in
`infra/monitoring/central/akb-alerts.yml` and cover:

- public health and dependency-aware readiness,
- refused telemetry,
- chat HTTP 5xx responses,
- chat p95 latency.

## Tracing

AKB keeps request id and correlation id propagation in the application code.
Python services add OpenTelemetry tracing when `OTEL_SDK_DISABLED=false`.
Next.js uses the explicit `AKL_OTEL_ENABLED=true` switch and must not receive
`OTEL_SDK_DISABLED`, because the Next.js telemetry library treats any defined
value as disabled. Production services export OTLP over the private server
network directly to the central Collector. Python services use OTLP/gRPC on
port `4317`; the two Next.js services use OTLP/HTTP protobuf on port `4318`.
The endpoints are not published by the AKB reverse proxy.

Standalone web and chat images preload a small telemetry bootstrap before the
Next.js server. It invokes the compiled instrumentation hook exactly once and
does not block application startup if telemetry initialization fails.

The central Collector removes request and response bodies, authorization and
cookie headers, query-bearing URL attributes, SQL statements, user identifiers,
client addresses and generative-AI prompt/response attributes before storage.
AKB telemetry must contain operational metadata only. It must never include a
prompt, answer, document content, signed source URL, bearer token or secret.

Application services do not depend on the collector for startup. If the
observability stack is unavailable, AKB services should continue to run and keep
using health/readiness plus request/correlation ids.

The Next.js workspace and standalone chat emit server and fetch spans, including
the bounded `akb.assistant.chat` span for the complete chat request. The
following Python FastAPI services emit inbound HTTP spans and `httpx`
outbound client spans when telemetry is enabled. Registry also exports the
implemented assistant-retention counters through the same OTLP collector:

- Registry API,
- Ingestion Service,
- RAG Retrieval Service,
- LLM Gateway Service,
- Evaluation Service,
- Governance Service.

The next observability rollout steps are:

1. Additional domain metrics for ingestion duration, retrieval latency, LLM
   latency, citation coverage, source-open failures and authorization denied
   counts.
2. Logs enriched with `trace_id` and `span_id` while preserving the existing
   AKB `trace_id` error field compatibility.

Deployment, validation and rollback details are in
`docs/OPERATIONS/central-observability.md`.

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

`GET /api/health` reports only web-process liveness. `GET /api/ready` checks
the configured Registry, Ingestion, RAG and Governance service readiness in
production mode with a bounded timeout and returns `503 not_ready` when any
required dependency is unavailable. The web top-bar indicator polls this
dependency-aware endpoint every 60 seconds. It names the affected user
capability (for example AI answers) instead of showing an opaque HTTP status;
dependency degradation is a warning, while an unreadable readiness response is
critical. Root `GET /ready` remains the local web-service baseline endpoint used
for container lifecycle checks.

RAG readiness checks Registry, retrieval indexes and LLM Gateway concurrently
with a two-second bound per dependency. Governance checks Registry and RAG
concurrently with a three-second bound. A slow or unreachable downstream is
reported as `not_ready` instead of holding the readiness chain open for the
full application request timeout.

Production OpenSearch readiness is performed by Ingestion and RAG themselves,
using their role-specific Basic Auth identity and the mounted CA. The generic
platform-status probe does not bypass authentication or probe a removed local
`http://opensearch:9200` container. Alert on central alias unavailability,
replica degradation, indexing failures, search latency, rejected requests, and
unexpected count drift. Never label metrics with credentials, source text,
queries, prompts, or answers.

Director Copilot V2 rejects a live response that does not match the pinned
contract. Its integration log distinguishes this from transport failure with
`DIRECTOR_COPILOT_V2_SOURCE_CONTRACT_INVALID`. The optional
`diagnostic_code` and `diagnostic_paths` fields contain only a validator code
and bounded JSON-pointer/keyword pairs such as
`/items/0/facts/0/quality:maximum`. They never contain fact values, entity
labels, prompts, answers, credentials, or source content.

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
