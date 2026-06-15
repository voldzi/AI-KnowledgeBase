# RAG Retrieval Service API

`services/rag-retrieval-service` owns retrieval, answer composition, source-context opening, citation opening, and the employee assistant API.

## Scope

Implemented:

- retrieval,
- cited answer generation,
- source context lookup,
- citation opening,
- employee assistant chat, clarification, suggestions, and conversation lookup.
- STRATOS contract extraction proposal API for `contract_financial_v1`.

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

GET  /api/v1/stratos/extractions/profiles
POST /api/v1/stratos/extractions/contracts/propose
GET  /api/v1/stratos/extractions/{extraction_id}
POST /api/v1/stratos/extractions/{extraction_id}/feedback

GET  /health
GET  /ready
```

## STRATOS Contract Extractions

`POST /api/v1/stratos/extractions/contracts/propose` extracts cited proposed
contract parameters for Budget & Contract. The first supported profile is
`contract_financial_v1`. It is intentionally conservative:

- it retrieves only authorized chunks through Registry API authz,
- it returns only `proposed` field values,
- every field proposal includes a citation with `document_id`,
  `document_version_id`, `chunk_id`, page/section where available,
  `quoted_text`, and `viewer_url`,
- when evidence is insufficient, the response is `PARTIAL` with
  `missing_information`/`warnings`, not invented values,
- persistence and feedback are stored through Registry API
  `document_extractions` and `document_extraction_feedback`.

Budget remains the source of truth for structured contract entities. AKB never
writes Budget tables directly; Budget accepts, edits, or rejects proposals after
authorized human confirmation and sends feedback through
`POST /api/v1/stratos/extractions/{extraction_id}/feedback`.

## Integration Notes

- Filters candidate documents through Registry API authorization.
- Calls LLM Gateway for answer generation and embeddings.
- Reads chunks from Qdrant-compatible retrieval backends.
- Provides the source-context and citation-open contract consumed by Knowledge Chat and Employee Assistant.
- Persists STRATOS extraction proposals and feedback through Registry API; the
  source app receives only metadata and cited proposals, never binary content,
  extracted full text, chunks, embeddings, or prompts.

## Canonical Sources

```text
services/rag-retrieval-service/README.md
services/rag-retrieval-service/openapi.yaml
GET /openapi.json
```
