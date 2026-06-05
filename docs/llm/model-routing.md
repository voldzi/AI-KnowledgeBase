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
```

Tento režim nevyžaduje GPU runtime ani síťové LLM služby.

## Příklad pro Ollama MVP

```text
AKL_LLM_DEFAULT_PROVIDER=ollama
AKL_LLM_ENABLED_PROVIDERS=ollama
AKL_OLLAMA_BASE_URL=http://ollama:11434
AKL_LLM_DEFAULT_CHAT_MODEL=qwen2.5:14b
AKL_LLM_DEFAULT_EMBEDDING_MODEL=bge-m3
AKL_LLM_ALLOW_MODEL_PULL=true
AKL_LLM_MODEL_PROVIDER_MAP={
  "qwen2.5:14b": "ollama",
  "bge-m3": "ollama"
}
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
