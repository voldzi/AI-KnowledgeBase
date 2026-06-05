# Deployment model

Odkaz na centrální zadání: `../00_CENTRALNI_ZADANI_AKL_PLATFORM.md`

---

## 1. Cíl

AKL Platform musí jít spustit:

1. lokálně v Docker Compose,
2. na jednom serveru,
3. na více serverech,
4. později v Kubernetes nebo obdobné orchestraci.

---

## 2. Lokální dev deployment

Služby:

```text
reverse-proxy
web
registry-api
ingestion-service
rag-retrieval-service
llm-gateway-service
evaluation-service
governance-service
postgres
qdrant
minio
keycloak
ollama
prometheus
grafana
loki
```

---

## 3. Víceserverové nasazení

Příklad:

```text
Server 1 — edge
- reverse proxy
- web frontend

Server 2 — backend
- registry-api
- keycloak
- postgres

Server 3 — document processing
- ingestion-service
- minio

Server 4 — search
- rag-retrieval-service
- qdrant

Server 5 — AI compute
- llm-gateway-service
- ollama/vllm
- GPU

Server 6 — observability
- prometheus
- grafana
- loki
```

---

## 4. Síťové toky

| Zdroj | Cíl | Protokol | Poznámka |
|---|---|---|---|
| Web | Registry API | HTTPS | dokumenty, audit |
| Web | RAG Service | HTTPS | dotazy |
| Web | Ingestion Service | HTTPS | upload/job status |
| Ingestion | Registry API | HTTPS | metadata, authz, audit |
| Ingestion | MinIO | S3 API | soubory |
| Ingestion | Qdrant | HTTP/gRPC | indexace |
| Ingestion | LLM Gateway | HTTPS | embeddings |
| RAG | Registry API | HTTPS | authz, metadata, audit |
| RAG | Qdrant | HTTP/gRPC | retrieval |
| RAG | LLM Gateway | HTTPS | generování odpovědi |
| LLM Gateway | Ollama/vLLM | HTTP | lokální/AI síť |

---

## 5. Environment variables

Každá služba má namespacované proměnné.

Příklad:

```text
AKL_ENV=development

REGISTRY_DATABASE_URL=postgresql://...
REGISTRY_OIDC_ISSUER_URL=https://keycloak.local/realms/akl

INGESTION_REGISTRY_API_URL=https://registry-api.local/api/v1
INGESTION_QDRANT_URL=http://qdrant:6333
INGESTION_OBJECT_STORAGE_ENDPOINT=http://minio:9000

RAG_REGISTRY_API_URL=https://registry-api.local/api/v1
RAG_QDRANT_URL=http://qdrant:6333
RAG_LLM_GATEWAY_URL=https://llm-gateway.local/api/v1

LLM_GATEWAY_PROVIDER=ollama
LLM_GATEWAY_OLLAMA_URL=http://ollama:11434
```

---

## 6. Healthchecks

Každá služba:

```text
GET /health
GET /ready
```

Health:

- proces běží.

Ready:

- služba se dokáže připojit na své kritické závislosti.

---

## 7. Backup

Zálohovat:

- PostgreSQL,
- MinIO bucket,
- Qdrant collections,
- Keycloak konfiguraci,
- konfigurační soubory,
- eval datasety.

Minimální backup plán:

```text
denně: PostgreSQL dump
denně: MinIO sync
denně: Qdrant snapshot
týdně: full archive
měsíčně: restore test
```

---

## 8. Observability

Metriky:

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
- authz denied count.

Logy:

- JSON structured logs,
- correlation id,
- request id.

Dashboardy:

- platform health,
- ingestion pipeline,
- RAG quality,
- LLM performance,
- security/audit overview.

---

## 9. Produkční zásady

- TLS všude, kde je provoz mimo lokální docker network.
- Žádný mock auth v produkci.
- Secrets mimo repozitář.
- Služby za reverse proxy.
- Admin endpointy pouze v management síti.
- Pravidelný restore test.
- Modely a embedding profily verzovat.
