# Local Development Deployment

This document describes the Platform / Infrastructure owned local environment for AKL Platform.

## Prerequisites

- Docker with Docker Compose v2.
- A local `.env` created from `.env.example`.
- Host ports from `.env.example` available, or adjusted before startup.

## Real Local RAG Start

```bash
cp .env.example .env
docker compose --env-file .env -f infra/docker-compose/docker-compose.dev.yml --profile ai up -d --build
```

The default `.env.example` values are the current real local RAG profile: Ollama provider, `gemma4:12b` chat, `bge-m3` embeddings, Qdrant retriever/indexer, and `AKL_RAG_AUTHZ_MODE=dev`.

Pull required models through the AKL Model Manager API:

```bash
curl -sS http://localhost:8083/api/v1/models/pull \
  -H 'Content-Type: application/json' \
  -d '{"model":"bge-m3","kind":"embedding"}'

curl -sS http://localhost:8083/api/v1/models/pull \
  -H 'Content-Type: application/json' \
  -d '{"model":"gemma4:12b","kind":"chat"}'
```

Run the baseline smoke tests:

```bash
python3 scripts/phase_02_llm_gateway_smoke.py
python3 scripts/phase_02_controlled_document_smoke.py
```

For host-level Ollama or mock/dev-test overrides, follow `docs/deployment/llm-profiles.md`.

Optional placeholder health endpoints for not-yet-implemented app services:

```bash
docker compose --env-file .env -f infra/docker-compose/docker-compose.dev.yml --profile app-stubs up --build
```

## URLs

| Component | Local URL |
|---|---|
| Reverse proxy | `http://localhost:8080` |
| Platform health | `http://localhost:8080/health` |
| Platform readiness | `http://localhost:8080/ready` |
| Platform OpenAPI | `http://localhost:8080/openapi.json` |
| Registry route | `http://localhost:8080/registry/api/v1` |
| Ingestion route | `http://localhost:8080/ingestion/api/v1` |
| RAG route | `http://localhost:8080/rag/api/v1` |
| LLM Gateway route | `http://localhost:8080/llm-gateway/api/v1` |
| Keycloak | `http://localhost:8081` |
| MinIO API | `http://localhost:9000` |
| MinIO Console | `http://localhost:9001` |
| Prometheus | `http://localhost:9090` |
| Grafana | `http://localhost:3000` or `http://localhost:8080/grafana/` |
| Loki | `http://localhost:3100` |

## Network Zones

| Zone | Purpose |
|---|---|
| `public_zone` | Reverse proxy ingress. |
| `app_zone` | AKL application service communication. |
| `data_zone` | PostgreSQL, Qdrant, MinIO. |
| `ai_compute_zone` | Ollama or later vLLM runtime. |
| `management_zone` | Prometheus, Grafana, Loki, management metrics. |

## Healthchecks

The platform status service exposes:

```text
GET /health
GET /ready
GET /metrics
```

Through the reverse proxy, service health endpoints use the service prefix:

```text
GET /registry/health
GET /ingestion/ready
GET /rag/health
```

Until each service thread implements its own service, use `--profile app-stubs` to get placeholder health endpoints. These placeholders are not production implementations.

## Configuration Rules

- Use namespaced variables from `.env.example`.
- Do not add secrets to the repository.
- `AKL_AUTH_MODE=mock` is allowed only for local development.
- Other service threads should override upstreams such as `REGISTRY_UPSTREAM` or run containers with the expected Compose service names.

## Stop

```bash
docker compose --env-file .env -f infra/docker-compose/docker-compose.dev.yml down
```

To remove volumes:

```bash
docker compose --env-file .env -f infra/docker-compose/docker-compose.dev.yml down -v
```
