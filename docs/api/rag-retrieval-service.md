# RAG Retrieval Service API

`services/rag-retrieval-service` owns retrieval, answer composition, source-context opening, citation opening, and the employee assistant API.

## Scope

Implemented:

- retrieval,
- cited answer generation,
- source context lookup,
- citation opening,
- employee assistant chat, clarification, suggestions, and conversation lookup.

Contract stubs still present:

- compare documents,
- compliance check.

Out of scope:

- ingestion,
- document registry persistence,
- embedding creation during ingestion,
- governance decision authority.

## Base Path

```text
/api/v1
```

Health/readiness stay outside the versioned prefix.

## Endpoints

```text
POST /api/v1/rag/retrieve
POST /api/v1/rag/query
POST /api/v1/rag/answer
POST /api/v1/rag/compare-documents
POST /api/v1/rag/check-compliance

GET  /api/v1/chunks/{chunk_id}/source-context
GET  /api/v1/citations/{chunk_id}/open

POST /api/v1/assistant/chat
POST /api/v1/assistant/clarify
GET  /api/v1/assistant/suggestions
GET  /api/v1/assistant/conversations/{conversation_id}
GET  /api/v1/assistant/citations/{chunk_id}/open

GET  /health
GET  /ready
```

## Integration Notes

- Filters candidate documents through Registry API authorization.
- Calls LLM Gateway for answer generation and embeddings.
- Reads chunks from Qdrant-compatible retrieval backends.
- Provides the source-context and citation-open contract consumed by Knowledge Chat and Employee Assistant.

## Canonical Sources

```text
services/rag-retrieval-service/README.md
services/rag-retrieval-service/openapi.yaml
GET /openapi.json
```
