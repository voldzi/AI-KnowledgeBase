# API Documentation

This section is the current-state API map for AKB services.

Use it as the first stop when you need:

- service ownership boundaries,
- canonical base paths,
- the main endpoint families,
- links to the authoritative OpenAPI or service README source.

## Services

- `platform-status.md`
  - operational health and readiness surface for infrastructure orchestration
- `registry-api.md`
  - document registry, versions, assignments, authz, workflow tasks, audit, external document links
- `ingestion-service.md`
  - ingestion jobs, reports, cancellation, and reindex contract
- `rag-retrieval-service.md`
  - retrieval, answering, source context, citation opening, and employee assistant APIs
- `llm-gateway-service.md`
  - provider/model management, chat completions, and embeddings
- `evaluation-service.md`
  - evaluation datasets, runs, and reports
- `governance-service.md`
  - compare, compliance, conflicts, KB draft generation, and validity alerts

## Contract Sources

The API docs here are current-state summaries. The canonical service contracts remain:

- each service `openapi.yaml`, if present
- runtime `/openapi.json`
- the corresponding `services/<service>/README.md`

Cross-service data and security contracts are documented separately in:

- `../CONTRACTS/03_API_KONTRAKTY_OPENAPI.md`
- `../CONTRACTS/05_DATOVE_KONTRAKTY.md`
- `../CONTRACTS/06_SECURITY_AUTHZ_MODEL.md`
