# AKL LLM Gateway Service

FastAPI service that exposes one LLM API over:

- Ollama
- vLLM or any OpenAI-compatible `/v1` endpoint
- deterministic mock provider for tests and local development

The service does not implement RAG retrieval, document authorization, citation logic, document storage, or UI concerns.

## API

Base path for service APIs is `/api/v1`.

```text
GET  /health
GET  /ready
GET  /api/v1/providers
GET  /api/v1/models
GET  /api/v1/models/recommended
POST /api/v1/models/pull
POST /api/v1/models/test-chat
POST /api/v1/models/test-embedding
GET  /api/v1/config/effective
POST /api/v1/chat/completions
POST /api/v1/embeddings
```

`POST /api/v1/chat/completions` returns JSON by default. When request field `stream=true`, it returns `text/event-stream` with JSON chunks and a final `data: [DONE]` frame.

The canonical OpenAPI file is `openapi.yaml`.

## Local Run

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Mock mode works without external LLM runtime:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/api/v1/models
```

For the Phase 02B non-mock local profile backed by Ollama, see `../../docs/deployment/llm-profiles.md`.

Local Model Manager endpoints let the Web Frontend later build `Settings -> Local AI Models` without calling Ollama directly.

## Provider Routing

Routing is controlled by environment variables:

```text
AKL_LLM_DEFAULT_PROVIDER=mock
AKL_LLM_ENABLED_PROVIDERS=mock,ollama,openai
AKL_LLM_MODEL_PROVIDER_MAP={"gemma4:12b":"ollama","bge-m3":"ollama","meta-llama/Llama-3.1-8B-Instruct":"openai"}
```

If a requested model is present in `AKL_LLM_MODEL_PROVIDER_MAP`, that provider is used. Otherwise the service uses `AKL_LLM_DEFAULT_PROVIDER`.

Provider names:

- `mock`
- `ollama`
- `openai` for vLLM/OpenAI-compatible endpoints

## Configuration

Copy `.env.example` and set service-specific values through environment variables.

Important settings:

| Variable | Purpose |
|---|---|
| `AKL_ENV` | `development`, `test`, or `production`. |
| `AKL_AUTH_MODE` | `disabled`, `mock`, `bearer`, or `oidc`; production rejects `disabled` and `mock`. |
| `AKL_SERVICE_TOKEN` | Expected bearer token when `AKL_AUTH_MODE=bearer`. |
| `AKL_LLM_DEFAULT_PROVIDER` | Fallback provider for models without explicit route. |
| `AKL_LLM_ENABLED_PROVIDERS` | Comma-separated provider allowlist. |
| `AKL_LLM_MODEL_PROVIDER_MAP` | JSON object mapping model id to provider. |
| `AKL_LLM_DEFAULT_CHAT_MODEL` | Active/default chat model for Local Model Manager test calls. |
| `AKL_LLM_DEFAULT_EMBEDDING_MODEL` | Active/default embedding model for Local Model Manager test calls. |
| `AKL_LLM_DEFAULT_MAX_TOKENS` | Default chat generation limit used when request `max_tokens` is omitted. |
| `AKL_LLM_ALLOW_MODEL_PULL` | Enables explicit model pull through providers that support it. |
| `AKL_LLM_ALLOW_MODEL_DELETE` | Reserved safety switch for future delete support. |
| `AKL_LLM_MODEL_PULL_TIMEOUT_SECONDS` | Timeout for explicit model pull operations. |
| `AKL_LLM_REQUEST_TIMEOUT_SECONDS` | HTTP timeout for external provider calls. |
| `AKL_LLM_RETRY_ATTEMPTS` | Retries after the first failed provider attempt. |
| `AKL_RATE_LIMIT_ENABLED` | Enables the in-process placeholder rate limiter. |
| `AKL_OLLAMA_BASE_URL` | Ollama base URL. |
| `AKL_OLLAMA_THINK` | Default Ollama `think` value; default `false` prevents thinking-only empty responses. |
| `AKL_OPENAI_COMPAT_BASE_URL` | vLLM/OpenAI-compatible base URL. |
| `AKL_OPENAI_COMPAT_API_KEY` | Optional API key for OpenAI-compatible endpoint. |

## Security and Logging

Production startup is rejected unless:

- `AKL_AUTH_MODE` is `bearer` or `oidc`
- `AKL_SERVICE_TOKEN` is set when `AKL_AUTH_MODE=bearer`
- mock provider is not enabled

In `AKL_AUTH_MODE=oidc`, the gateway requires an inbound bearer token but does not validate OIDC claims locally. It relies on upstream services to perform document authorization before calling the gateway.

Application logs include request id, correlation id, provider, model id, counts, status, latency, and usage metadata. Logs do not include full prompts, full responses, bearer tokens, API keys, or embedding input text.

The service propagates:

```text
X-Request-ID
X-Correlation-ID
X-Service-Name
```

It does not forward inbound service bearer tokens to LLM runtimes. OpenAI-compatible authentication uses only `AKL_OPENAI_COMPAT_API_KEY`.

## Limits

- The rate limiter is a single-process placeholder and is disabled by default.
- Model pull is disabled by default and is never triggered on service startup.
- Streaming retries only happen before a stream successfully starts.
- Ollama capability discovery is inferred from model names because Ollama `/api/tags` does not expose a stable capability contract.
- Ollama `max_tokens` maps to `options.num_predict`; omitted request values use `AKL_LLM_DEFAULT_MAX_TOKENS`.
- For thinking-capable Ollama models such as Gemma, the gateway sends `think:false` by default. If Ollama returns only `message.thinking` with empty `message.content`, the gateway returns `EMPTY_CONTENT_THINKING_ONLY`.
- The gateway does not verify document permissions. RAG Retrieval Service must filter context before calling this service.

## Tests

```bash
pytest
```

The test suite uses the mock provider and does not require Ollama, vLLM, or network access.

## Docker

```bash
docker build -t akl/llm-gateway-service .
docker run --rm -p 8080:8080 --env-file .env akl/llm-gateway-service
```
