# LLM Profiles

## Mock Profile

Use this for CI and deterministic local smoke tests.

```bash
AKL_LLM_DEFAULT_PROVIDER=mock
AKL_LLM_ENABLED_PROVIDERS=mock
AKL_MOCK_EMBEDDING_DIMENSIONS=8
AKL_INGESTION_EMBEDDING_CLIENT_MODE=http
AKL_INGESTION_DEFAULT_EMBEDDING_MODEL=mock-embedding
AKL_RAG_LLM_CLIENT_MODE=http
AKL_RAG_EMBEDDING_MODEL=mock-embedding
AKL_RAG_CHAT_MODEL=mock-chat
```

The Phase 02 smoke test was validated with this profile through LLM Gateway HTTP. It still performs real ingestion and real Qdrant indexing/retrieval.

## Local Ollama Profile

Start the AI profile:

```bash
docker compose -f infra/docker-compose/docker-compose.dev.yml --profile ai up -d --build ollama llm-gateway-service
```

Pull suggested models:

```bash
docker exec akl-ollama-1 ollama pull bge-m3
docker exec akl-ollama-1 ollama pull qwen2.5:14b
```

Run the app stack with Ollama selected:

```bash
AKL_LLM_DEFAULT_PROVIDER=ollama \
AKL_LLM_ENABLED_PROVIDERS=ollama \
AKL_LLM_MODEL_PROVIDER_MAP='{"qwen2.5:14b":"ollama","bge-m3":"ollama"}' \
AKL_LLM_DEFAULT_CHAT_MODEL=qwen2.5:14b \
AKL_LLM_DEFAULT_EMBEDDING_MODEL=bge-m3 \
AKL_LLM_DEFAULT_MAX_TOKENS=512 \
AKL_LLM_ALLOW_MODEL_PULL=true \
AKL_OLLAMA_THINK=false \
AKL_INGESTION_EMBEDDING_CLIENT_MODE=http \
AKL_INGESTION_DEFAULT_EMBEDDING_MODEL=bge-m3 \
AKL_RAG_LLM_CLIENT_MODE=http \
AKL_RAG_EMBEDDING_MODEL=bge-m3 \
AKL_RAG_CHAT_MODEL=qwen2.5:14b \
AKL_INGESTION_INDEXER_MODE=qdrant \
AKL_RAG_RETRIEVER_MODE=qdrant \
docker compose -f infra/docker-compose/docker-compose.dev.yml --profile ai up -d --build
```

Verify model visibility:

```bash
curl http://localhost:8083/api/v1/models
```

Expected response includes Ollama models with provider `ollama`.

Verify Local Model Manager API:

```bash
curl http://localhost:8083/api/v1/providers
curl http://localhost:8083/api/v1/models/recommended
curl http://localhost:8083/api/v1/config/effective
```

Explicit model pull through LLM Gateway, if `AKL_LLM_ALLOW_MODEL_PULL=true`:

```bash
curl -sS http://localhost:8083/api/v1/models/pull \
  -H 'Content-Type: application/json' \
  -d '{"model":"bge-m3","kind":"embedding"}'
```

Thinking-capable Ollama model smoke:

```bash
curl -X POST http://localhost:8083/api/v1/models/test-chat \
  -H "Content-Type: application/json" \
  -d '{"model":"gemma4:12b","prompt":"Odpověz česky jednou větou: k čemu slouží řízená dokumentace?","think":false,"max_tokens":256}'
```

## Host Ollama

If Ollama runs on the host instead of the compose profile, point LLM Gateway at the host:

```bash
AKL_LLM_DEFAULT_PROVIDER=ollama
AKL_LLM_ENABLED_PROVIDERS=ollama
AKL_OLLAMA_BASE_URL=http://host.docker.internal:11434
```

On macOS with a local service:

```bash
ollama pull bge-m3
ollama pull qwen2.5:14b
ollama list
```

For macOS helper checks:

```bash
scripts/setup_local_llm_macos.sh
```

## Qdrant Dimension Reset

Mock embeddings and Ollama embeddings have different vector dimensions. Before switching from mock to Ollama in a local environment, delete the development collection:

```bash
curl -X DELETE http://localhost:6333/collections/akl_document_chunks
```

Then rerun ingestion.

## Smoke Commands

Mock LLM Gateway over HTTP:

```bash
python3 scripts/phase_02_controlled_document_smoke.py
```

Ollama smoke after model pull and collection reset:

```bash
AKL_SMOKE_QDRANT_URL=http://localhost:6333 \
python3 scripts/phase_02_controlled_document_smoke.py
```

The smoke test should report:

```text
OK qdrant_points= ...
OK cited_chunk_id= ...
OK rag_audit_event_id= ...
```

If it fails with a Qdrant vector-size error, the collection was created with a different embedding model and must be reset.
