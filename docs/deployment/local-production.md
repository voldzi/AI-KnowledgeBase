# Local Production Profile

Local production is the repeatable single-machine AKL profile for real local RAG with host Ollama, Qdrant, Registry API, Ingestion Service, RAG Retrieval Service, LLM Gateway, and Web UI.

## Configuration

Create a local env file:

```bash
cp .env.local-prod.example .env.local-prod
```

Review local passwords and ports in `.env.local-prod`. The file must stay local and must not be committed.

The required real local RAG settings are:

```env
AKL_LLM_DEFAULT_PROVIDER=ollama
AKL_LLM_ENABLED_PROVIDERS=mock,ollama
AKL_LLM_DEFAULT_CHAT_MODEL=gemma4:12b-mlx
AKL_LLM_DEFAULT_EMBEDDING_MODEL=bge-m3
AKL_OLLAMA_THINK=false
AKL_LLM_DEFAULT_MAX_TOKENS=512
AKL_OLLAMA_BASE_URL=http://host.docker.internal:11434
AKL_OLLAMA_BASE_URLS=http://host.docker.internal:11434

AKL_INGESTION_EMBEDDING_CLIENT_MODE=http
AKL_INGESTION_DEFAULT_EMBEDDING_MODEL=bge-m3
AKL_INGESTION_INDEXER_MODE=qdrant,opensearch

AKL_RAG_RETRIEVER_MODE=qdrant
AKL_RAG_FULLTEXT_MODE=opensearch
AKL_RAG_LLM_CLIENT_MODE=http
AKL_RAG_CHAT_MODEL=gemma4:12b-mlx
AKL_RAG_HIGH_QUALITY_CHAT_MODEL=gemma4:31b-mlx
AKL_RAG_HIGH_QUALITY_MIN_CONTEXT_CHUNKS=6
AKL_RAG_EMBEDDING_MODEL=bge-m3
AKL_RAG_ANSWER_MAX_TOKENS=512
AKL_RAG_SOURCE_CONTEXT_WINDOW=1
AKL_RAG_AUTHZ_MODE=dev
AKL_RAG_REQUIRE_CITATIONS=true
AKL_RAG_ENABLE_RERANKING=true

AKL_QDRANT_COLLECTION=akl_document_chunks
AKL_QDRANT_VECTOR_SIZE=1024
AKL_QDRANT_DISTANCE=Cosine
AKL_OPENSEARCH_INDEX=akl_document_chunks
```

## Start

Start Ollama on the host and pull models through AKL:

```bash
ollama serve

docker compose --env-file .env.local-prod \
  -f infra/docker-compose/docker-compose.dev.yml \
  -f infra/docker-compose/docker-compose.local-prod.yml \
  up -d --build

curl -sS http://localhost:8083/api/v1/models/pull \
  -H 'Content-Type: application/json' \
  -d '{"model":"bge-m3","kind":"embedding"}'

curl -sS http://localhost:8083/api/v1/models/pull \
  -H 'Content-Type: application/json' \
  -d '{"model":"gemma4:12b-mlx","kind":"chat"}'
```

Validate compose config:

```bash
docker compose --env-file .env.local-prod \
  -f infra/docker-compose/docker-compose.dev.yml \
  -f infra/docker-compose/docker-compose.local-prod.yml \
  config
```

## Import Docs

Do not run host-side importer or mutating smoke scripts against this
production/OIDC-shaped profile. Their guards fail before mutation. Import
documents through the governed AKB application UI/API so the current person,
Registry-issued exact-version proof, `svc-akb-web-ingestion` transport, and
attempt CAS are all enforced. Host importer mutation is retired in every
environment; `--dry-run` remains available for inventory only.

## Smoke Tests

```bash
python3 scripts/phase_02_llm_gateway_smoke.py
python3 scripts/phase_03_local_production_smoke.py
```

`phase_01_smoke.py`, `phase_02_controlled_document_smoke.py`, and any smoke that
invokes the host importer are retired mutation tools; no environment or bearer
enables them. Use authenticated application smoke through the web surface for
create/retry/cancel flows.

## Backup And Restore

Backup:

```bash
scripts/backup_local_prod.sh
```

Restore:

```bash
RESTORE_CONFIRM=restore-akl scripts/restore_local_prod.sh backups/local-prod/<backup-directory>
```

The backup includes PostgreSQL dump, MinIO bucket data, Qdrant snapshots for `akl_document_chunks`, OpenSearch index data through the persistent Docker volume, import reports/config metadata where available, and infrastructure configuration. Ollama models are not backed up; pull them again through AKL Model Manager.

## Common Issues

- `QDRANT_COLLECTION_VECTOR_SIZE_MISMATCH`: the collection was created for a different embedding dimension. Recreate it or use the matching embedding profile.
- OpenSearch has no results after enabling it: re-run the document import or reindex flow so ingestion writes existing chunks into `AKL_OPENSEARCH_INDEX`.
- `SOURCE_FILE_URI_MISSING` in viewer: the chunk was indexed before source metadata support. Reindex the document.
- Slow local answers: keep `AKL_RAG_ANSWER_MAX_TOKENS=512` and reduce `max_chunks` for very small local models.
