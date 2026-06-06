# Multi-Server Deployment

AKL Platform is designed as independently deployable services connected by contracts, not by shared code imports or shared runtime objects.

## Reference Topology

| Server | Zone | Components |
|---|---|---|
| Edge | Public / DMZ | reverse proxy, web frontend |
| Backend | Application + Data | registry-api, Keycloak, PostgreSQL |
| Document processing | Application + Data | ingestion-service, MinIO |
| Search | Application + Data | rag-retrieval-service, Qdrant |
| AI compute | AI compute | llm-gateway-service, Ollama or vLLM |
| Observability | Management | Prometheus, Grafana, Loki |

## Required Service Contracts

Every service must expose:

```text
GET /health
GET /ready
GET /metrics if enabled
```

Every service-to-service request must propagate:

```text
Authorization: Bearer <token>
X-Request-ID: <uuid>
X-Correlation-ID: <uuid>
X-Service-Name: <service>
```

## URL Configuration

Do not assume all services run on one host. Configure remote URLs through environment variables:

```text
REGISTRY_UPSTREAM=registry-api.internal.example:8080
RAG_UPSTREAM=rag.internal.example:8080
AKL_INGESTION_OBJECT_STORAGE_MODE=http
AKL_QDRANT_BASE_URL=https://qdrant.internal.example
AKL_OLLAMA_BASE_URL=http://ollama.ai.internal:11434
```

The reverse proxy can keep the same public paths while upstreams point to different servers.

## Security

- Use TLS for all traffic outside a local Docker network.
- Use Keycloak OIDC and service accounts.
- Never use `AKL_AUTH_MODE=mock` in production.
- Store secrets in a secret manager or host-level protected files, not in Git.
- Keep admin endpoints on the management network.
- Restrict PostgreSQL, Qdrant, and MinIO to data networks.

## Observability

Prometheus should scrape only approved management or service metrics endpoints. Loki ingestion is deployment-specific; prefer a controlled log shipper with explicit redaction rather than mounting broad host resources by default.

Minimum dashboards:

- platform health,
- ingestion pipeline,
- RAG quality,
- LLM performance,
- security and audit overview.

## Backup

Back up:

- PostgreSQL,
- MinIO buckets,
- Qdrant snapshots,
- Keycloak realm and clients,
- infrastructure configuration,
- evaluation datasets when introduced.

Run a restore test at least monthly.

## Limits

The compose files in this repository are a reference operational baseline. Real production deployments should additionally pin image digests, use managed secret storage, configure certificate automation, define firewall rules, and document service-level recovery objectives.
