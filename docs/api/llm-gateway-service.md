# LLM Gateway Service API

`services/llm-gateway-service` exposes one internal LLM API over Ollama, OpenAI-compatible providers, and deterministic mock mode for local development and tests.

## Scope

Implemented:

- provider listing,
- model listing and recommendation,
- explicit model pull and test calls,
- effective config inspection,
- chat completions,
- embeddings.

Out of scope:

- RAG retrieval,
- document authorization,
- document storage,
- UI workflows.

## Base Path

```text
/api/v1
```

Health/readiness stay outside the versioned prefix.

## Endpoints

```text
GET  /api/v1/providers
GET  /api/v1/models
GET  /api/v1/models/recommended
POST /api/v1/models/pull
POST /api/v1/models/test-chat
POST /api/v1/models/test-embedding
GET  /api/v1/config/effective
POST /api/v1/chat/completions
POST /api/v1/embeddings

GET  /health
GET  /ready
```

## Integration Notes

- Ingestion uses embeddings.
- RAG Retrieval uses chat completions and embeddings.
- Web admin/settings flows can inspect providers and models without calling Ollama directly.

## Canonical Sources

```text
services/llm-gateway-service/README.md
services/llm-gateway-service/openapi.yaml
GET /openapi.json
```
