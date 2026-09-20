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

## Cost-optimized quality routing

The production-safe default is `AKL_RAG_MODEL_ROUTING_MODE=cost_optimized`.
Routing is deterministic and runs locally before any document excerpt reaches
an external endpoint:

1. a short, bounded, single-document lookup uses `AKL_RAG_CHAT_MODEL`;
2. a complex request that cannot leave the organization uses
   `AKL_RAG_HIGH_QUALITY_CHAT_MODEL`;
3. an externally permitted complex request uses `AKL_RAG_EXTERNAL_CHAT_MODEL`;
4. a very complex request can use `AKL_RAG_EXTERNAL_PREMIUM_CHAT_MODEL`.

Complexity is raised by analytical/extractive answer modes, legal and contract
analysis signals, multiple document versions, large or truncated context, and
multi-facet questions. The chosen tier, score and non-content reason codes are
stored in the safe `llm_usage.routing` metadata. The same route applies to the
evidence verifier: an inexpensive local answer does not silently incur a
second external verification call.

```text
AKL_RAG_MODEL_ROUTING_MODE=cost_optimized
AKL_RAG_EXTERNAL_COMPLEXITY_THRESHOLD=3
AKL_RAG_EXTERNAL_PREMIUM_COMPLEXITY_THRESHOLD=8
AKL_RAG_CHAT_MODEL=gemma4:12b-mlx
AKL_RAG_HIGH_QUALITY_CHAT_MODEL=gemma4:31b-mlx
AKL_RAG_EXTERNAL_CHAT_MODEL=gpt-5.6-luna
AKL_RAG_EXTERNAL_PREMIUM_CHAT_MODEL=
```

`external_preferred` retains the former behavior for a controlled comparison:
every policy-permitted answer uses an external model. `local_only` disables
external composition without weakening document authorization or the evidence
gate. Model routing never overrides Information Policy V2; `RESTRICTED`,
`NO_EXTERNAL_AI`, `LOCAL_PROCESSING_ONLY` and classified content stay local.

## DIA and multi-model API routers

The RAG service selects logical model ids and does not depend on OpenAI host
names. An OpenAI-compatible government or enterprise router can replace the
direct endpoint through neutral aliases:

```text
AKL_EXTERNAL_AI_BASE_URL=https://router.example
AKL_EXTERNAL_AI_API_KEY_FILE=/run/secrets/akb-external-ai-api-key
AKL_LLM_ENABLED_PROVIDERS=ollama,openai
AKL_LLM_MODEL_PROVIDER_MAP={"gemma4:12b-mlx":"ollama","dia-balanced":"openai","dia-premium":"openai","bge-m3":"ollama"}
AKL_RAG_EXTERNAL_CHAT_MODEL=dia-balanced
AKL_RAG_EXTERNAL_PREMIUM_CHAT_MODEL=dia-premium
```

The existing `AKL_OPENAI_COMPAT_*` variables remain backward compatible. The
neutral aliases take precedence, allowing the future DIA router to be enabled
by runtime configuration rather than an application code change. The external
endpoint must implement `/v1/models`, `/v1/chat/completions` and compatible
usage metadata before activation.

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

For the smaller controlled Czech shadow comparison, AKB uses the versioned
profile set in
`contracts/embedding-shadow/v1/czech_embedding_shadow_profiles.json`.
It compares the same 1024-dimensional `bge-m3` baseline with
`Qwen/Qwen3-Embedding-0.6B` at 1024 dimensions and the Czech specialist
`Seznam/simcse-retromae-small-cs` at 256 dimensions. Every profile has a
separate collection; neither candidate is enabled for answers. See
`docs/evaluation/czech-embedding-shadow.md`.

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

## OpenAI API pilot

The existing `openai` provider can connect directly to OpenAI by setting
`AKL_OPENAI_COMPAT_BASE_URL=https://api.openai.com`. Keep embeddings, document
parsing, Qdrant and reranking local; route only approved chat models to the
external provider. A production key is an operator-managed mode-0600 file,
mounted at `/run/secrets/akb-openai-api-key`:

```text
AKL_LLM_DEFAULT_PROVIDER=openai
AKL_LLM_ENABLED_PROVIDERS=ollama,openai
AKL_LLM_MODEL_PROVIDER_MAP={"gpt-5.6-luna":"openai","gpt-5.4-mini":"openai","bge-m3":"ollama"}
AKL_LLM_DEFAULT_CHAT_MODEL=gpt-5.6-luna
AKL_OPENAI_COMPAT_BASE_URL=https://api.openai.com
AKL_OPENAI_COMPAT_API_KEY_FILE=/run/secrets/akb-openai-api-key
AKL_OPENAI_COMPAT_API_KEY_SOURCE_FILE=/srv/akb/env/openai-akb-api-key
```

Do not activate this profile until the OpenAI project has a spend limit and a
dedicated service-account key. The RAG composer sends the question plus the
authorized selected excerpts and citation metadata, never a whole source PDF.
External processing remains fail-closed for a missing policy binding,
`RESTRICTED`, `NO_EXTERNAL_AI`, `LOCAL_PROCESSING_ONLY`, or classified content.
The source being publicly accessible is not by itself an external-AI approval:
STRATOS must attach an explicit policy binding that reflects the sanitized
published version.

Keep `AKL_RAG_CHAT_MODEL` and `AKL_RAG_HIGH_QUALITY_CHAT_MODEL` mapped to a
local provider whenever `AKL_RAG_EXTERNAL_CHAT_MODEL` is enabled. The external
model is selected only for policy-approved `PUBLIC` or `INTERNAL` context; the
local models are the mandatory answer path for `RESTRICTED`, `NO_EXTERNAL_AI`
and `LOCAL_PROCESSING_ONLY` context. RAG rejects startup if the external model
replaces either local role, because that configuration would turn a valid
restricted-document question into an avoidable HTTP 403/502 response.

The gateway records provider-reported input, output, cached and total token
counts for every completed answer. For models in the reviewed pricing table it
also stores a USD estimate and pricing snapshot version with the assistant
message. Users can inspect this in the collapsed technical detail below an
answer; administrators receive a 30-day aggregate and the active external-AI
protection posture. Unknown models remain explicitly unpriced rather than
being assigned an inferred rate.

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
