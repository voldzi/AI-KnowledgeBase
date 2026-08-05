# Central AKB Observability

## Purpose

Production AKB uses the shared observability stack on
`observability.home.cz`. It does not operate a duplicate production Grafana,
Prometheus, Tempo or Loki stack on `docker.home.cz`.

## Data Flow

```text
AKB FastAPI services -> private OTLP/gRPC endpoint :4317
AKB web and chat     -> private OTLP/HTTP endpoint :4318
  -> central OpenTelemetry Collector
  -> privacy processor
  -> Tempo, Prometheus span metrics, service graph metrics and Loki
  -> central Grafana and Alertmanager
```

Application startup and request handling do not depend on successful telemetry
delivery. Health, readiness, request ids and correlation ids remain available
if central observability is unavailable.

The standalone Next.js images preload `/app/otel-bootstrap.cjs`. The bootstrap
invokes the compiled instrumentation hook before `server.js`, because the
standalone launcher does not reliably invoke that hook itself. Registration is
idempotent and remains disabled unless `AKL_OTEL_ENABLED=true`.

## Privacy Boundary

The central Collector must delete these attribute classes before export:

- request and response bodies;
- authorization, cookie and set-cookie headers;
- `url.full`, query strings, legacy `http.url` and `http.target`;
- SQL statements and query text;
- user and end-user identifiers;
- client and peer network addresses;
- generative-AI prompts, completions and message bodies.

Route templates, service names, bounded status codes, durations and deployment
metadata are allowed. Do not add prompt, answer, citation text, document content,
tokens or signed URLs as custom span attributes.

## Versioned Assets

- Dashboard: `infra/monitoring/central/akb-overview.json`
- Alerts: `infra/monitoring/central/akb-alerts.yml`
- Production OTLP settings: `infra/docker-compose/docker-compose.docker-home.yml`

The central Grafana datasource UIDs are `obs-prometheus`, `obs-tempo` and
`obs-loki`. The LLM Gateway participates in the same immutable AKB release and
exports OTLP/gRPC as `akb-llm-gateway-service`; it must not be deployed as a
separate unversioned `docker-home` image.

Tempo retains traces for 14 days. The Collector also derives service graph
metrics from trace parent/child relationships, so the critical path can be
inspected without recording source content.

## Release Validation

1. Validate the production compose and exact web image.
2. Deploy the immutable release.
3. Verify `/akb/api/health` and `/akb/api/ready`.
4. Verify that all AKB application containers have a distinct
   tracing service name and the central private endpoint. The two Next.js
   services use `akb-web` and `akb-chat-web`; Python services retain their
   compatibility `AKL_SERVICE_NAME` values such as `registry-api` and
   `rag-retrieval-service`.
5. Run one authorized chat request without recording its text.
6. Confirm `akb.assistant.chat` and downstream service spans in central Tempo.
7. Confirm central span metrics for every exercised AKB service.
8. Confirm blackbox health and readiness probes.
9. Search central telemetry attribute keys and verify that the privacy-blocked
   classes are absent.
10. Only after these checks remove legacy local observability containers.

## Rollback

Rollback the AKB immutable release if telemetry initialization affects health,
readiness or application traffic. A central Collector outage alone is not an
AKB rollback condition. Disable Next.js export with `AKL_OTEL_ENABLED=false`;
Python services continue to use `OTEL_SDK_DISABLED=true`.
