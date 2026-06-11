# AKB Platform Infrastructure

This directory contains the operational foundation for AKB Platform:

- Docker Compose for local development and prod-like deployments,
- Caddy reverse proxy,
- PostgreSQL,
- Qdrant,
- MinIO,
- Keycloak,
- Ollama profile,
- Prometheus, Grafana, Loki,
- backup and restore scripts.

It intentionally contains no document registry, ingestion, RAG, LLM gateway, frontend, evaluation, or governance business logic.

## Directory Map

```text
infra/docker-compose/
infra/reverse-proxy/
infra/keycloak/
infra/monitoring/prometheus/
infra/monitoring/grafana/
infra/monitoring/loki/
infra/monitoring/otel-collector/
infra/monitoring/tempo/
infra/postgres/init/
infra/backup/
```

## Service Routes

All service routes are path-prefixed through the reverse proxy:

```text
/registry/*
/ingestion/*
/rag/*
/llm-gateway/*
/evaluation/*
/governance/*
/web/*
```

Health and readiness endpoints are therefore reachable as:

```text
/registry/health
/registry/ready
/rag/health
/rag/ready
```

The platform status service owns root `/health`, `/ready`, `/metrics`, and `/openapi.json`.

## Security Notes

- No real secret is stored in the repository.
- `.env.example` contains placeholders only.
- Production-like deployments must use `AKL_AUTH_MODE=oidc`.
- The platform status service refuses `AKL_ENV=production` with `AKL_AUTH_MODE=mock`.
- Logs are structured and must not contain tokens, prompts, document text, or passwords.

## Limits

- Compose healthchecks are shallow infrastructure checks.
- The dev compose baseline starts real app services; the prod-like compose still keeps optional `app-stubs` status-only placeholders for early deployment rehearsal.
- TLS in prod-like compose uses Caddy internal certificates by default; replace this with ACME or enterprise certificates for real public deployments.
