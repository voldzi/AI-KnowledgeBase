# Ingestion Service API

`services/ingestion-service` owns ingestion jobs, parsing, OCR fallback, chunking, embedding calls through LLM Gateway, and indexing into Qdrant.

## Scope

Implemented:

- ingestion job creation,
- job status lookup,
- ingestion report retrieval,
- job cancellation,
- explicit reindex contract.

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

GET  /health
GET  /ready
```

## Integration Notes

- Reads document and version metadata from Registry API.
- Calls LLM Gateway embeddings.
- Writes chunk payloads and vectors into Qdrant.
- Supplies ingestion status that the web layer surfaces in upload, document detail, and workflow contexts.

## Canonical Sources

```text
services/ingestion-service/README.md
services/ingestion-service/openapi.yaml
GET /openapi.json
```
