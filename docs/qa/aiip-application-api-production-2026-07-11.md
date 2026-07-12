# AIIP Application API Production Evidence - 2026-07-11

## Scope

Deployed the AKB-owned AIIP application boundary:

- `POST /akb/api/integrations/aiip/v1/harmonize`
- `POST /akb/api/integrations/aiip/v1/duplicates/search`
- `aiip-service` public caller identity and `akb-rag-service` internal Registry identity
- durable Registry idempotency and audit metadata
- tenant/source-aware Qdrant and OpenSearch retrieval
- versioned OpenAPI fragment and synthetic fixtures

## Pre-Deployment And Rollback

Production was healthy before deployment. Rollback material is stored under:

```text
/srv/akl/backups/aiip-application-20260711T072617Z
```

It contains a repository archive and a PostgreSQL 18 Registry dump. No secret
was included in the repository archive or documentation.

## Database

Applied transactional Alembic revisions:

```text
0010_integration_idempotency
0011_aiip_service_access
```

Final production state: `0011_aiip_service_access (head)`. Automatic production
schema creation remained disabled.

## Identity

Verified real client-credentials tokens without printing tokens or secrets:

| Client | Audience | Application role |
| --- | --- | --- |
| `aiip-service` | `akb-api` | `service_aiip` |
| `akb-rag-service` | `akl-api` | `service_rag` |

Both secret files have mode `0600`. RAG mounts only the internal Registry
secret read-only. Public AKB validation uses Keycloak RS256 JWKS because the
browser SSO client `akl-web` remains correctly public.

## Contract Smoke

The synthetic production contract smoke returned:

- harmonize: HTTP 200, one advisory suggestion, audit id present, 412 total
  tokens;
- model routing: requested `gemma4:31b-mlx`, actual `gemma4:12b-mlx`, fallback
  true;
- exact replay: HTTP 200, identical body, `Idempotency-Replayed: true`;
- same key/different body: HTTP 409 `IDEMPOTENCY_KEY_REUSED`;
- restricted input: HTTP 403 `CLASSIFICATION_NOT_ALLOWED`, no audit event;
- synthetic tenant duplicate search: HTTP 200 with index version and audit id.

After tenant/source metadata backfill, a duplicate query for the existing AIIP
requirement card returned HTTP 200, one target candidate and three citations.

## Existing Corpus Backfill

Production contained one AIIP requirement card with 24 indexed chunks. The
backfill wrote and verified the same `tenant_id`, `external_system`, and
`external_ref` on all 24 Qdrant payloads and all 24 OpenSearch documents. The
document is a draft; AIIP duplicate detection intentionally includes drafts.

## Validation

- web tests: 145 passed;
- web typecheck and production build: passed;
- RAG AIIP/config/auth/filter tests: 27 passed in the main run; focused final
  behavior run: 17 passed;
- Registry external-document and idempotency tests: 16 passed;
- ingestion focused regression: 28 passed, 1 conditional skip;
- Registry idempotency tests: 4 passed;
- skeleton, JSON/OpenAPI generation check, shell syntax, Python compile, and
  `git diff --check`: passed.

## Final Production State

| Service | Image | State |
| --- | --- | --- |
| web | `sha256:2db4c95db8f5e96dbd527ca7db5e86964eac3ba5d8e0c4ecc98c251135792e8f` | healthy |
| Registry | `sha256:f6c5c9b4768b816d8e3aed35cfff6be122f11003635d810f39b090fbdcb39f96` | healthy |
| ingestion | `sha256:d738c764b536aeb51381c96ef8ef2899a101c33f0cbb683f2dc41b74f1b8db05` | healthy |
| RAG | `sha256:8d53d79dd059517fe604db881e4dba5a7434f4b012145190b1328b155645dfcc` | healthy |

Public `/akb/api/health` and `/akb/api/ready` returned HTTP 200; Registry,
ingestion, RAG, governance and evaluation all reported `ready`. No
traceback/fatal/panic marker was present in the four changed service logs, and
the synthetic input text was absent from RAG logs.
