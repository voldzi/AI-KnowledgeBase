# LLM Model Routing

LLM Gateway routuje request podle model id a konfigurace environment variables.

## Základní pravidlo

1. Pokud `model` existuje v `AKL_LLM_MODEL_PROVIDER_MAP`, použije se explicitně mapovaný provider.
2. Jinak se použije `AKL_LLM_DEFAULT_PROVIDER`.
3. Provider musí být uvedený v `AKL_LLM_ENABLED_PROVIDERS`.

Provider names:

```text
mock
ollama
openai
```

`openai` znamená vLLM nebo jiný OpenAI-compatible `/v1` endpoint.

## Příklad pro lokální vývoj

```text
AKL_LLM_DEFAULT_PROVIDER=mock
AKL_LLM_ENABLED_PROVIDERS=mock
AKL_LLM_MODEL_PROVIDER_MAP={}
AKL_INGESTION_EMBEDDING_CLIENT_MODE=mock
AKL_INGESTION_DEFAULT_EMBEDDING_MODEL=mock-embedding
AKL_INGESTION_INDEXER_MODE=mock
AKL_RAG_RETRIEVER_MODE=mock
AKL_RAG_LLM_CLIENT_MODE=mock
AKL_RAG_CHAT_MODEL=mock-chat
AKL_RAG_EMBEDDING_MODEL=mock-embedding
```

Tento režim nevyžaduje GPU runtime ani síťové LLM služby. Mock embeddings mají výchozí dimenzi 8 a nesmí se používat s real Qdrant kolekcí pro `bge-m3`.

## Real Local RAG Profile

```text
AKL_LLM_DEFAULT_PROVIDER=ollama
AKL_LLM_ENABLED_PROVIDERS=ollama
AKL_OLLAMA_BASE_URL=http://ollama:11434
AKL_OLLAMA_BASE_URLS=http://ollama:11434
AKL_LLM_DEFAULT_CHAT_MODEL=gemma4:12b-mlx
AKL_LLM_CHAT_MODEL_FALLBACKS={"gemma4:31b-mlx":["gemma4:12b-mlx"]}
AKL_LLM_DEFAULT_EMBEDDING_MODEL=bge-m3
AKL_LLM_DEFAULT_MAX_TOKENS=512
AKL_LLM_ALLOW_MODEL_PULL=true
AKL_OLLAMA_THINK=false
AKL_LLM_MODEL_PROVIDER_MAP={
  "gemma4:12b-mlx": "ollama",
  "gemma4:31b-mlx": "ollama",
  "bge-m3": "ollama",
  "qwen3-embedding:8b": "ollama"
}
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
AKL_RAG_AUTHZ_MODE=dev
AKL_RAG_REQUIRE_CITATIONS=true
AKL_RAG_ENABLE_RERANKING=true
AKL_QDRANT_COLLECTION=akl_document_chunks
AKL_QDRANT_VECTOR_SIZE=1024
AKL_QDRANT_DISTANCE=Cosine
AKL_OPENSEARCH_INDEX=akl_document_chunks
```

## High-Quality Chat Routing

`AKL_RAG_CHAT_MODEL` zustava rychly standardni chat model pro bezne
zamestnanecke dotazy. `AKL_RAG_HIGH_QUALITY_CHAT_MODEL` je volitelny profil
pro slozitejsi citovane odpovedi nad dokumentaci. Answer composer ho pouzije
pro extrakce, checklisty, FAQ, manažerské/auditní odpovědi, porovnání,
konflikty, velky kontext nebo kontext zkraceny limitem.

```text
AKL_RAG_CHAT_MODEL=gemma4:12b-mlx
AKL_RAG_HIGH_QUALITY_CHAT_MODEL=gemma4:31b-mlx
AKL_RAG_HIGH_QUALITY_MIN_CONTEXT_CHUNKS=6
```

Model uvedeny v `AKL_RAG_HIGH_QUALITY_CHAT_MODEL` musi byt zaroven v
`AKL_LLM_MODEL_PROVIDER_MAP`, jinak LLM Gateway request odmítne.

## Qwen3 Enterprise Embedding Profile

`qwen3-embedding:8b` is supported as an enterprise retrieval candidate. It
must be enabled as a controlled profile, not by mixing vectors into the
existing `bge-m3` collection.

Recommended 1024-dimensional pilot profile:

```text
AKL_LLM_MODEL_PROVIDER_MAP={
  "gemma4:12b-mlx": "ollama",
  "gemma4:31b-mlx": "ollama",
  "bge-m3": "ollama",
  "qwen3-embedding:8b": "ollama"
}
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

Before switching RAG traffic to this profile, reindex the current document
versions into the target Qdrant collection and run retrieval/citation quality
checks. The current production baseline remains:

```text
AKL_LLM_DEFAULT_EMBEDDING_MODEL=bge-m3
AKL_INGESTION_DEFAULT_EMBEDDING_MODEL=bge-m3
AKL_RAG_EMBEDDING_MODEL=bge-m3
AKL_QDRANT_COLLECTION=akl_document_chunks
AKL_QDRANT_VECTOR_SIZE=1024
```

Použité endpointy:

```text
GET  /api/tags
POST /api/chat
POST /api/embed
POST /api/pull
```

## Příklad pro vLLM

```text
AKL_LLM_DEFAULT_PROVIDER=openai
AKL_LLM_ENABLED_PROVIDERS=openai
AKL_OPENAI_COMPAT_BASE_URL=http://vllm:8000
AKL_OPENAI_COMPAT_API_KEY=
```

Použité endpointy:

```text
GET  /v1/models
POST /v1/chat/completions
POST /v1/embeddings
```

## Smíšené routování

```text
AKL_LLM_DEFAULT_PROVIDER=openai
AKL_LLM_ENABLED_PROVIDERS=ollama,openai
AKL_OPENAI_COMPAT_BASE_URL=http://vllm:8000
AKL_OLLAMA_BASE_URL=http://ollama:11434
AKL_OLLAMA_BASE_URLS=http://ollama:11434,http://192.168.200.3:11434,http://192.168.200.2:11434,http://192.168.1.176:11434
AKL_LLM_MODEL_PROVIDER_MAP={
  "bge-m3": "ollama",
  "nomic-embed-text": "ollama",
  "meta-llama/Llama-3.1-8B-Instruct": "openai"
}
```

Tento režim umožňuje používat Ollama pro embeddings a vLLM pro chat completion.

## Readiness

`GET /ready` vrací `200`, pokud je připravený default provider. Stav ostatních enabled providerů je uvedený v poli `providers`, ale nedostupnost providerů mimo default sama o sobě readiness neshodí.

## Produkční omezení

V produkci nesmí být enabled `mock` provider. Produkční konfigurace musí mít:

```text
AKL_ENV=production
AKL_AUTH_MODE=bearer
AKL_SERVICE_TOKEN=<secret managed outside git>
```
