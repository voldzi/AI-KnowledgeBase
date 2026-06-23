# RAG Retrieval Service API

`services/rag-retrieval-service` owns retrieval, answer composition, source-context opening, citation opening, and the employee chat API.

## Scope

Implemented:

- retrieval,
- cited answer generation,
- source context lookup,
- citation opening,
- employee chat, clarification, suggestions, and conversation lookup.
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

`/api/v1/assistant/chat` and `/api/v1/assistant/clarify` return the standard
assistant answer contract. For report, table, overview, Excel, PDF, or export
requests, the response may include `report_artifacts`. These artifacts are
bounded table specifications with row-level citations. The AKB web BFF exports
them as `.xlsx` or `.pdf` via `POST /api/assistant/reports/export`.
The web BFF may enrich valid artifacts to `artifact_contract_version:
"report.v2"` with artifact kind, provenance, quality, and row `source_refs`.
Content artifacts require row-level citations before they are shown or exported.

Inventory-style document questions are handled by the AKB web BFF before RAG
when the question can be answered from Registry API metadata, for example
counts, lists, or type breakdowns. Those responses include metadata breakdowns
by topic, document type, classification, owner/steward, and status. They use
the same assistant response and `report_artifacts` shape, but carry
`answer_source: "registry_metadata_summary"` when backed by `GET
/api/v1/documents/metadata-summary`, use `artifact_kind:
"registry_metadata_table"`, and carry no chunk citations.

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
- Provides the source-context and citation-open contract consumed by Employee Chat Portal.
- Persists STRATOS extraction proposals and feedback through Registry API; the
  source app receives only metadata and cited proposals, never binary content,
  extracted full text, chunks, embeddings, or prompts.

## Canonical Sources

```text
services/rag-retrieval-service/README.md
services/rag-retrieval-service/openapi.yaml
GET /openapi.json
```
