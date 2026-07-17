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
POST /api/v1/intelligence/entities/facets/query
POST /api/v1/intelligence/analyst/search
POST /api/v1/intelligence/entities/search
POST /api/v1/intelligence/entities/relationships
GET  /api/v1/integrations/web-ingestion/readiness

GET  /health
GET  /ready
```

## Integration Notes

- Reads document and version metadata from Registry API.
- Accepts interactive job create/read/cancel only through the exact
  `svc-akb-web-ingestion` transport. Every operation also requires a
  short-lived Registry proof bound to its actor, action, immutable
  document/version, correlation id, and idempotency key. The inbound AIIP/user
  bearer is never forwarded.
- Uses a separate short-lived `svc-ingestion` client-credentials bearer for
  Registry proof confirmation, readiness, metadata reads, authoritative
  attempt compare-and-swap, terminal outbox synchronization, and audit. A
  subject header is audit context only after Registry confirms the proof.
- Calls LLM Gateway embeddings.
- Writes chunk payloads and vectors into Qdrant.
- Optionally writes chunk payloads into OpenSearch and exposes entity facets from
  `entity_pairs` without returning document text.
- Provides OpenSearch-backed entity evidence search with chunk snippets,
  document version identifiers and entity pairs. In production, callers pass a
  Registry-issued Intelligence proof plus the exact sorted
  document/version/policy-hash coordinates; Ingestion confirms them before it
  binds the OpenSearch filters. Caller-provided `allowed_document_ids` alone are
  not authority.
- Provides OpenSearch-backed analyst search with smart/fuzzy, boolean,
  phrase, proximity and fielded query modes. Supported field aliases include
  `title:`, `body:`, `section:`, `entity:`, `source:`, `type:` and `class:`.
  The same confirmed Registry proof and exact document/version/policy-hash
  boundary is required; any `allowed_document_ids` field is bound to, and may
  only narrow, the confirmed coordinates.
- Provides a deterministic relationship graph from entity co-occurrence in
  authorized chunks. Returned edges include source/target entity endpoints,
  confidence, evidence counts and cited chunk evidence.
- Supplies ingestion status that the web layer surfaces in upload, document detail, and workflow contexts.
- After a controlled version is published, the web orchestration starts one
  deterministic successor ingestion attempt for that exact immutable version.
  This refreshes rebuildable Qdrant/OpenSearch payloads with the authoritative
  `valid` status; PostgreSQL Registry data remains the source of truth.
- Synchronizes AIIP ingestion status only for the immutable version already
  selected by the dedicated confirm route; it cannot establish/change current
  lineage, file metadata, or source URI.
- Persists deterministic jobs with confirmed authorization lineage, obtains the
  authoritative Registry claim before any source read or indexing, and writes
  terminal report plus pending Registry outbox atomically. Recovery executes
  only fully verified jobs and reconciles unknown claim/terminal outcomes.
- Production global job list, unscoped facet GET, and bulk reindex fail closed;
  static JWT roles do not create document authority.

## Canonical Sources

```text
services/ingestion-service/README.md
services/ingestion-service/openapi.yaml
GET /openapi.json
```
