# LLM Profiles

## Mock / Dev-Test Profile

Use this for unit tests and deterministic development without Ollama or a real Qdrant embedding collection.

```bash
AKL_LLM_DEFAULT_PROVIDER=mock
AKL_LLM_ENABLED_PROVIDERS=mock
AKL_LLM_MODEL_PROVIDER_MAP={}
AKL_MOCK_EMBEDDING_DIMENSIONS=8
AKL_INGESTION_EMBEDDING_CLIENT_MODE=mock
AKL_INGESTION_DEFAULT_EMBEDDING_MODEL=mock-embedding
AKL_INGESTION_INDEXER_MODE=mock
AKL_RAG_RETRIEVER_MODE=mock
AKL_RAG_LLM_CLIENT_MODE=mock
AKL_RAG_CHAT_MODEL=mock-chat
AKL_RAG_EMBEDDING_MODEL=mock-embedding
```

Mock embeddings are 8-dimensional by default. Do not index them into the real `akl_document_chunks` collection used by `bge-m3`, which is 1024-dimensional.

## Real Local RAG Profile

Required `.env` values:

```bash
AKL_LLM_DEFAULT_PROVIDER=ollama
AKL_LLM_ENABLED_PROVIDERS=ollama
AKL_LLM_MODEL_PROVIDER_MAP={"gemma4:12b-mlx":"ollama","bge-m3":"ollama","qwen3-embedding:8b":"ollama"}
AKL_LLM_DEFAULT_CHAT_MODEL=gemma4:12b-mlx
AKL_LLM_DEFAULT_EMBEDDING_MODEL=bge-m3
AKL_LLM_DEFAULT_EMBEDDING_DIMENSIONS=
AKL_LLM_DEFAULT_MAX_TOKENS=512
AKL_OLLAMA_THINK=false
AKL_OLLAMA_BASE_URLS=http://ollama:11434
AKL_INGESTION_EMBEDDING_CLIENT_MODE=http
AKL_INGESTION_DEFAULT_EMBEDDING_MODEL=bge-m3
AKL_INGESTION_DEFAULT_EMBEDDING_DIMENSIONS=
AKL_INGESTION_INDEXER_MODE=qdrant
AKL_RAG_RETRIEVER_MODE=qdrant
AKL_RAG_LLM_CLIENT_MODE=http
AKL_RAG_CHAT_MODEL=gemma4:12b-mlx
AKL_RAG_EMBEDDING_MODEL=bge-m3
AKL_RAG_EMBEDDING_DIMENSIONS=
AKL_RAG_AUTHZ_MODE=dev
AKL_RAG_REQUIRE_CITATIONS=true
AKL_RAG_ENABLE_RERANKING=true
AKL_QDRANT_COLLECTION=akl_document_chunks
AKL_QDRANT_VECTOR_SIZE=1024
AKL_QDRANT_DISTANCE=Cosine
```

Start the compose stack with the Ollama profile:

```bash
docker compose --env-file .env -f infra/docker-compose/docker-compose.dev.yml --profile ai up -d --build
```

Pull required models through the Local Model Manager API:

```bash
curl -sS http://localhost:8083/api/v1/models/pull \
  -H 'Content-Type: application/json' \
  -d '{"model":"bge-m3","kind":"embedding"}'

curl -sS http://localhost:8083/api/v1/models/pull \
  -H 'Content-Type: application/json' \
  -d '{"model":"gemma4:12b-mlx","kind":"chat"}'
```

Verify model visibility and effective config:

```bash
curl http://localhost:8083/api/v1/models
curl http://localhost:8083/api/v1/models/recommended
curl http://localhost:8083/api/v1/config/effective
```

The effective config should show:

```text
active_provider=ollama
default_chat_model=gemma4:12b-mlx
default_embedding_model=bge-m3
default_embedding_dimensions=null
default_max_tokens=512
ollama_think=false
```

## Qwen3 Enterprise Embedding Profile

`qwen3-embedding:8b` is available as a controlled enterprise retrieval candidate. Ollama returns 4096-dimensional vectors by default, but the AKB production profile constrains it to 1024 dimensions so it can be evaluated with the same Qdrant vector size as `bge-m3`.

Use a separate collection while evaluating Qwen. Never mix vectors produced by different models in one Qdrant collection.

```bash
AKL_LLM_MODEL_PROVIDER_MAP={"gemma4:12b-mlx":"ollama","bge-m3":"ollama","qwen3-embedding:8b":"ollama"}
AKL_LLM_DEFAULT_EMBEDDING_MODEL=qwen3-embedding:8b
AKL_LLM_DEFAULT_EMBEDDING_DIMENSIONS=1024
AKL_INGESTION_DEFAULT_EMBEDDING_MODEL=qwen3-embedding:8b
AKL_INGESTION_DEFAULT_EMBEDDING_DIMENSIONS=1024
AKL_RAG_EMBEDDING_MODEL=qwen3-embedding:8b
AKL_RAG_EMBEDDING_DIMENSIONS=1024
AKL_QDRANT_COLLECTION=akl_document_chunks_qwen3_8b_1024
AKL_QDRANT_VECTOR_SIZE=1024
AKL_QDRANT_DISTANCE=Cosine
```

Switch RAG traffic to the Qwen profile only after a full reindex into the Qwen collection and a cited-answer smoke pass. The stable default profile remains `bge-m3` until the Qwen collection is complete and validated.

## Host Ollama

If Ollama runs on the host instead of the compose `ai` profile, point LLM Gateway at the host:

```bash
AKL_OLLAMA_BASE_URL=http://host.docker.internal:11434
```

For a controlled failover list, set `AKL_OLLAMA_BASE_URLS` to the ordered
candidate URLs. The gateway tries those explicit endpoints and uses the first
one that responds. It does not scan LAN ranges.

```bash
AKL_OLLAMA_BASE_URL=http://host.docker.internal:11434
AKL_OLLAMA_BASE_URLS=http://host.docker.internal:11434,http://192.168.200.2:11434,http://192.168.1.176:11434
```

For local LAN stations such as `192.168.200.2` or `192.168.1.176`, Ollama must listen on an address
reachable from the AKB host, not only on `127.0.0.1`.

On macOS with a local Ollama service:

```bash
ollama pull bge-m3
ollama pull gemma4:12b-mlx
ollama list
```

For macOS helper checks:

```bash
scripts/setup_local_llm_macos.sh
```

## Qdrant Collection Bootstrap

The Ingestion Service automatically creates the Qdrant collection if it is missing:

```text
collection: akl_document_chunks
vector size: 1024
distance: Cosine
```

If the collection exists with a different vector size, ingestion fails with `QDRANT_COLLECTION_VECTOR_SIZE_MISMATCH`. Before switching embedding models in a local environment, reset the development collection:

```bash
curl -X DELETE http://localhost:6333/collections/akl_document_chunks
```

Then rerun ingestion.

## Smoke Commands

```bash
python3 scripts/phase_02_llm_gateway_smoke.py
python3 scripts/phase_02_controlled_document_smoke.py
```

The controlled document smoke test should report Qdrant points, a cited chunk, and audit events.
