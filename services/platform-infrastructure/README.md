# Platform Infrastructure Status Service

This service belongs to the Platform / Infrastructure thread. It is a small operational status endpoint used by Docker Compose and the reverse proxy. It does not implement AKL business logic, document data models, ingestion, RAG, or frontend screens.

## Responsibility

- expose `/health`, `/ready`, `/metrics`, and `/openapi.json`,
- propagate `X-Request-ID` and `X-Correlation-ID`,
- emit structured JSON logs without request bodies, tokens, prompts, or secrets,
- optionally check configured HTTP readiness dependencies,
- fail fast if `AKL_ENV=production` is combined with `AKL_AUTH_MODE=mock`.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Process liveness. |
| GET | `/ready` | Optional dependency readiness. |
| GET | `/metrics` | Prometheus text metrics for the status service. |
| GET | `/openapi.json` | Minimal OpenAPI contract for this status API. |

Errors follow the central shape:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Endpoint not found.",
    "details": {},
    "trace_id": "..."
  }
}
```

## Configuration

See `.env.example`.

`PLATFORM_READY_CHECKS` is a comma-separated list of `name=url` pairs. Example:

```text
qdrant=http://qdrant:6333/readyz,minio=http://minio:9000/minio/health/ready
```

Only HTTP readiness checks are supported. PostgreSQL readiness is orchestrated by Docker Compose healthchecks.

## Local Run

```bash
python -m akl_platform_status.server
```

## Tests

```bash
PYTHONPATH=services/platform-infrastructure python -m unittest discover services/platform-infrastructure/tests
```

## Limits

- This service is intentionally not an application gateway.
- It stores no state and performs no authz decisions.
- `/metrics` exposes only operational counters for this service.
- Readiness checks are shallow HTTP checks and do not validate business workflows.
