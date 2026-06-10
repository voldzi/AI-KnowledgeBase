# Evaluation Service API

`services/evaluation-service` measures retrieval, citation, no-answer, and answer quality by running evaluation datasets against the RAG service.

## Scope

Implemented:

- dataset listing and creation,
- evaluation run creation,
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
POST /api/v1/evaluations/runs
GET  /api/v1/evaluations/runs/{run_id}
GET  /api/v1/evaluations/runs/{run_id}/report

GET  /health
GET  /ready
```

## Integration Notes

- Calls RAG Retrieval Service for retrieval and query execution.
- Can write aggregated audit signals into Registry API.
- Produces filesystem-backed reports in the current implementation.

## Canonical Sources

```text
services/evaluation-service/README.md
services/evaluation-service/openapi.yaml
GET /openapi.json
```
