# AIIP to AKB End-to-End Production Acceptance - 2026-07-11

## Scope

Environment: production (`docker.home.cz`). This acceptance covers AKB only.
The AIIP result supplied by its owner was treated as upstream evidence; no
ArchFlow, Budget, ProjectFlow, or AIIP business workflow was changed.

Production source document:

```text
document_id: doc_a6547400e2be40589215d23a0b3d0fab
document_version_id: ver_d5f6eeda6ad647649d87249f2e1f8e4d
external_system: STRATOS_AIIP
classification: internal
```

## Findings And Remediation

### Tenant mismatch

The real AIIP document had 24 chunks in both indexes, but Registry and both
index payloads used the legacy tenant `default`. The AIIP application API uses
`tenant_aiip_default`, so real duplicate search correctly returned no result.

Alembic revision `0012_aiip_tenant_reconciliation` transactionally reconciled
legacy `STRATOS_AIIP` references, document metadata, policy constraints and
extraction tenant fields. It refuses identity collisions and writes
`external_document.tenant_reconciled`. Upgrade and downgrade were verified on
a clean PostgreSQL 17 database before production use.

The source was reingested after migration. Qdrant and OpenSearch now both hold
24 chunks with `tenant_id=tenant_aiip_default`, `external_system=STRATOS_AIIP`
and the same document version.

### Retry lifecycle drift

`retry-ingestion` created a new job but the Registry external reference kept
the previous `current_ingestion_job_id`. Registry now exposes the authorized
document-level lifecycle update endpoint and Ingestion Service synchronizes
`INGESTING`, `INDEXED` and `FAILED` with an audit event for each transition.

Production retest job:

```text
ing_f0f6ea56b9014d41b2e30b7edfaa338c -> INDEXED
```

Registry references that job and `INDEXED`. Two
`external_document.current_updated` events record the `INGESTING -> INDEXED`
transition with `source=ingestion-service`.

### Build-context hygiene

Legacy macOS `._*.py` metadata in the production checkout caused Alembic to
reject a candidate image. The migration did not run during that failed
attempt. Registry now has a service-local `.dockerignore`; the metadata was
removed and the rebuilt image contains only valid migration modules.

## Production Scenarios

| Scenario | Result | Evidence |
| --- | --- | --- |
| AKB readiness | PASS | Web and Registry, ingestion, RAG, governance and evaluation dependencies `ready` |
| Registry migration | PASS | `0012_aiip_tenant_reconciliation (head)` |
| Real AIIP retry | PASS | New job completed `INDEXED`, no error code |
| Qdrant identity | PASS | 24 chunks, correct tenant/system/version |
| OpenSearch identity | PASS | 24 chunks, correct tenant/system/version |
| Real duplicate retrieval | PASS | Target document returned with score `0.393634` and 3 citations |
| Tenant isolation | PASS | Other tenant returned 0 candidates and did not expose the target |
| Harmonization | PASS | HTTP 200, audit id, one suggestion, structured response |
| Model fallback | PASS | Requested 31B, actual `gemma4:12b-mlx`, fallback declared |
| Exact idempotent replay | PASS | HTTP 200, identical body, `Idempotency-Replayed: true` |
| Reused key conflict | PASS | HTTP 409 `IDEMPOTENCY_KEY_REUSED` |
| Classification gate | PASS | HTTP 403 `CLASSIFICATION_NOT_ALLOWED`, no audit/model call |
| Missing authentication | PASS | HTTP 401 `AUTH_REQUIRED`, no audit event |
| Wrong service identity | PASS | HTTP 403 `AUTH_FORBIDDEN`, no audit event |
| Citation open | PASS | Correct document/version, viewer and canonical URLs, no internal host leak |
| Original source open | PASS | HTTP 201/200, 47,229-byte DOCX with OOXML magic and correct MIME |
| Sensitive text logging | PASS | 0 hits for synthetic request content in changed-service logs |

## Automated Validation

- Web: 145 unit/integration tests passed; typecheck and production build passed.
- Web E2E: 26 scenarios passed, including document creation, ingestion flow,
  governance, citations, source previews, chat, reports and responsive shell.
- Registry API: 66 tests passed.
- Ingestion Service: 47 tests passed; 1 environment-conditional parser test skipped.
- RAG Retrieval Service: 94 tests passed.
- LLM Gateway: 39 tests passed.
- AIIP-specific web/Registry/ingestion/RAG focused suites passed.
- Skeleton, generated OpenAPI JSON, JSON parsing and `git diff --check` passed.

## Deployment And Rollback

Validated pre-change Registry dump and source archive:

```text
/srv/akl/backups/aiip-tenant-reconciliation-20260711T191457Z
```

Final changed images:

| Service | Image |
| --- | --- |
| Registry | `sha256:4c49484e9856ca6483a0f16de070fec2b0cd6bef398047ba94619b683b79676f` |
| Ingestion | `sha256:2b69c8d1a2026a1e5b5432b3254d857788c5ff381bf8620ff0827455c0e50970` |

Both containers are healthy. Changed-service logs contain no traceback,
fatal, panic, or external lifecycle synchronization failure marker.

## Conclusion

The tested AIIP-to-AKB document, retrieval, citation, source-open, identity,
tenant isolation, idempotency and audit path is production-ready. The two
defects found during this acceptance were fixed and passed production retest.
