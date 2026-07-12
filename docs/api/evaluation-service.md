# Evaluation Service API

`services/evaluation-service` measures retrieval, citation, no-answer, and answer quality by running evaluation datasets against the RAG service.

## Scope

Implemented:

- dataset listing and creation,
- private/shared dataset ownership and dataset detail,
- evaluation run creation,
- run history, regression comparison and quality overview,
- evaluation run lookup,
- JSON/CSV/HTML report retrieval.

Out of scope:

- document mutation,
- production answering,
- ingestion,
- permission changes,
- LLM-as-a-judge decisions in this iteration.

## Base Path

```text
/api/v1
```

Health/readiness stay outside the versioned prefix.

## Endpoints

```text
GET  /api/v1/evaluations/datasets
POST /api/v1/evaluations/datasets
GET  /api/v1/evaluations/datasets/{dataset_id}
GET  /api/v1/evaluations/runs
POST /api/v1/evaluations/runs
GET  /api/v1/evaluations/runs/{run_id}
GET  /api/v1/evaluations/runs/{run_id}/report
GET  /api/v1/evaluations/quality/overview

GET  /health
GET  /ready
```

## Integration Notes

- Calls RAG Retrieval Service for retrieval and query execution.
- Can write aggregated audit signals into Registry API.
- Produces atomically written, volume-backed datasets and reports.
- Production OIDC identity is forwarded to RAG so evaluation uses the caller's Registry permissions.
- The AKB web BFF exposes bootstrap/run actions under `/api/intelligence/quality/...`.

## Canonical Sources

```text
services/evaluation-service/README.md
services/evaluation-service/openapi.yaml
GET /openapi.json
```
