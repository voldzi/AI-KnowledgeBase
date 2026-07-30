# Governance Service API

`services/governance-service` owns compare, compliance, conflicts, KB draft generation, and validity alerts over governed document content.

## Scope

Implemented:

- compare versions,
- check compliance,
- detect conflicts,
- generate KB draft proposals,
- list validity alerts.

Out of scope:

- publishing decisions,
- authorization bypass,
- direct document mutation,
- final legal or compliance authority.

## Base Path

```text
/api/v1
```

Health/readiness stay outside the versioned prefix.

## Endpoints

```text
POST /api/v1/governance/compare-versions
POST /api/v1/governance/check-compliance
POST /api/v1/governance/detect-conflicts
POST /api/v1/governance/generate-kb-article
GET  /api/v1/governance/validity-alerts

GET  /health
GET  /ready
```

## Integration Notes

- Reads registry metadata and authorization-relevant document lists through Registry API.
- Can query RAG retrieval for control sources.
- Drives governance panels in the document detail UI through the web bridge.
- For immutable source documents and cited RAG chunks, forwards the exact
  document id, immutable version id, and `sha256:` Information Policy binding
  to Registry authorization. A proposed draft is checked before it becomes a
  valid version, so it is bound to its document and current policy hash only.
  Missing or malformed policy coordinates fail closed; a document id alone
  never establishes authorization under Access V2.

## Canonical Sources

```text
services/governance-service/README.md
services/governance-service/openapi.yaml
GET /openapi.json
```
