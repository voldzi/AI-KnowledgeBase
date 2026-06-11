# Platform Status Service API

`services/platform-infrastructure` owns the small operational status service used by Docker Compose, reverse proxy routing, and readiness orchestration.

## Scope

Implemented:

- process liveness,
- dependency readiness,
- Prometheus metrics for the status service,
- minimal OpenAPI exposure,
- correlation id propagation and structured logging.

Out of scope:

- document registry,
- ingestion,
- RAG retrieval,
- LLM calls,
- business APIs.

## Base Paths

```text
/health
/ready
/metrics
/openapi.json
```

There is no `/api/v1` business namespace here. This service is operational infrastructure only.

## Endpoints

```text
GET /health
GET /ready
GET /metrics
GET /openapi.json
```

## Integration Notes

- Reverse proxy and Docker Compose healthchecks depend on this surface.
- `PLATFORM_READY_CHECKS` can aggregate shallow readiness probes for downstream AKB services.
- This service must stay small and must not become an application gateway.

## Canonical Sources

```text
services/platform-infrastructure/README.md
```
