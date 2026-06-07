# AI KnowledgeBase / AKL

AKL is a local AI Knowledge Library for controlled documents, ingestion, embeddings, Qdrant-backed RAG retrieval, citations, and audit events.

## Local Quickstart

Clone and enter the repository:

```bash
git clone https://github.com/voldzi/AI-KnowledgeBase.git
cd AI-KnowledgeBase
```

Create local configuration:

```bash
cp .env.example .env
```

The checked-in `.env.example` is configured for the current real local RAG profile:

```text
AKL_LLM_DEFAULT_PROVIDER=ollama
AKL_LLM_DEFAULT_CHAT_MODEL=gemma4:12b
AKL_LLM_DEFAULT_EMBEDDING_MODEL=bge-m3
AKL_OLLAMA_THINK=false
AKL_LLM_DEFAULT_MAX_TOKENS=512
AKL_INGESTION_EMBEDDING_CLIENT_MODE=http
AKL_INGESTION_DEFAULT_EMBEDDING_MODEL=bge-m3
AKL_INGESTION_INDEXER_MODE=qdrant
AKL_RAG_RETRIEVER_MODE=qdrant
AKL_RAG_LLM_CLIENT_MODE=http
AKL_RAG_CHAT_MODEL=gemma4:12b
AKL_RAG_EMBEDDING_MODEL=bge-m3
AKL_RAG_AUTHZ_MODE=dev
AKL_RAG_REQUIRE_CITATIONS=true
AKL_RAG_ENABLE_RERANKING=true
```

Start the stack with the compose Ollama profile:

```bash
docker compose --env-file .env -f infra/docker-compose/docker-compose.dev.yml --profile ai up -d --build
```

Pull models through the AKL Model Manager API:

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

Registry API schema changes should also be verified against PostgreSQL, which is the production database runtime:

```bash
python3 scripts/registry_postgres_smoke.py
```

Import AKL project documentation as the first local knowledge base:

```bash
python3 tools/import_docs_folder.py \
  --source ./docs \
  --manifest docs/import-manifest.yaml \
  --mode reindex \
  --report reports/docs_import_report.json

python3 scripts/phase_03_docs_import_smoke.py
python3 scripts/phase_03_document_viewer_smoke.py
python3 scripts/phase_03_local_production_smoke.py
python3 scripts/phase_04_employee_assistant_smoke.py
```

## Phase 04 Employee Assistant

AKL now has a dual GUI model:

- Employee Assistant: `http://localhost:3002/assistant`
- Knowledge Management/Admin GUI: `http://localhost:3002`

The Employee Assistant is a thin web client. Workstations do not run local models, Qdrant, PostgreSQL, or object storage. Central backend services handle retrieval, permissions, model calls, citations, source opening, and audit events.

Assistant API:

```text
POST /api/v1/assistant/chat
POST /api/v1/assistant/clarify
GET  /api/v1/assistant/suggestions
GET  /api/v1/assistant/conversations/{conversation_id}
GET  /api/v1/assistant/citations/{chunk_id}/open
```

## Local Production

```bash
cp .env.local-prod.example .env.local-prod
docker compose --env-file .env.local-prod \
  -f infra/docker-compose/docker-compose.dev.yml \
  -f infra/docker-compose/docker-compose.local-prod.yml \
  up -d --build
```

Backup and restore wrappers:

```bash
scripts/backup_local_prod.sh
RESTORE_CONFIRM=restore-akl scripts/restore_local_prod.sh backups/local-prod/<backup-directory>
```

Details: `docs/deployment/local-production.md`.
Enterprise architecture: `docs/ARCHITECTURE/enterprise-architecture.md`.
Security model: `docs/security/enterprise-security-model.md`.
Code health baseline: `docs/maintenance/code-health.md`.
Project status: `docs/maintenance/project-status.md`.
Release process: `docs/maintenance/release-process.md`.
Document Workbench QA: `docs/qa/document-workbench-product-qa.md`.

## Document Viewer

RAG citations in Knowledge Chat are clickable. Opening a citation calls `GET /api/v1/citations/{chunk_id}/open` and shows the exact indexed chunk, source URI, viewer mode, section path, page if known, and source metadata.

## Profiles

The real local RAG profile uses `bge-m3` embeddings with Qdrant collection `akl_document_chunks`, vector size `1024`, and distance `Cosine`. Ingestion creates the collection if it is missing and fails clearly if an existing collection has a different vector size.

The mock/dev-test profile is documented in `docs/deployment/llm-profiles.md`. Mock embeddings are 8-dimensional by default and must not be used with the real `bge-m3` Qdrant collection.

## Useful URLs

- Web: `http://localhost:3002`
- Registry API: `http://localhost:8001`
- RAG Retrieval Service: `http://localhost:8082`
- LLM Gateway: `http://localhost:8083`
- Qdrant: `http://localhost:6333`
