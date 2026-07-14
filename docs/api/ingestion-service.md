# Ingestion Service API

`services/ingestion-service` owns ingestion jobs, parsing, OCR fallback, chunking, embedding calls through LLM Gateway, and indexing into Qdrant.

## Scope

Implemented:

- ingestion job creation,
- job status lookup,
- ingestion report retrieval,
- job cancellation,
- explicit reindex contract,
- read-only entity facet aggregation for Intelligence Workbench,
- authorized entity/fulltext evidence search over OpenSearch chunk payloads,
- authorized analyst search over OpenSearch chunk payloads with smart, boolean,
  phrase, proximity and fielded query modes,
- authorized evidence-backed entity relationship graph from OpenSearch chunk payloads.

Out of scope:

- document registry ownership,
- publishing/version validity workflow,
- RAG answering,
- direct UI ownership.

## Base Path

```text
/api/v1
```

Health/readiness stay outside the versioned prefix.

## Endpoints

```text
POST /api/v1/ingestion/jobs
GET  /api/v1/ingestion/jobs/{job_id}
GET  /api/v1/ingestion/jobs/{job_id}/report
POST /api/v1/ingestion/jobs/{job_id}/cancel
POST /api/v1/ingestion/reindex
GET  /api/v1/intelligence/entities/facets
POST /api/v1/intelligence/analyst/search
POST /api/v1/intelligence/entities/search
POST /api/v1/intelligence/entities/relationships

GET  /health
GET  /ready
```

## Integration Notes

- Reads document and version metadata from Registry API.
- Uses a dedicated short-lived `svc-ingestion` client-credentials bearer for
  Registry readiness, authorization, metadata reads, status sync, and audit.
  The inbound AIIP/user bearer is never forwarded; its subject is retained only
  in delegated authorization and audit payloads.
- Calls LLM Gateway embeddings.
- Writes chunk payloads and vectors into Qdrant.
- Optionally writes chunk payloads into OpenSearch and exposes entity facets from
  `entity_pairs` without returning document text.
- Provides OpenSearch-backed entity evidence search with chunk snippets, document
  version identifiers and entity pairs. Callers must pass `allowed_document_ids`;
  the web bridge derives those IDs from Registry API authorization before calling
  the ingestion service.
- Provides OpenSearch-backed analyst search with smart/fuzzy, boolean,
  phrase, proximity and fielded query modes. Supported field aliases include
  `title:`, `body:`, `section:`, `entity:`, `source:`, `type:` and `class:`.
  The same `allowed_document_ids` authorization boundary is required.
- Provides a deterministic relationship graph from entity co-occurrence in
  authorized chunks. Returned edges include source/target entity endpoints,
  confidence, evidence counts and cited chunk evidence.
- Supplies ingestion status that the web layer surfaces in upload, document detail, and workflow contexts.
- Synchronizes AIIP ingestion status only for the immutable version already
  selected by the dedicated confirm route; it cannot establish/change current
  lineage, file metadata, or source URI.

## Canonical Sources

```text
services/ingestion-service/README.md
services/ingestion-service/openapi.yaml
GET /openapi.json
```
