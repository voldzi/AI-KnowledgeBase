# AIIP ingestion identity and idempotency acceptance

Date: 2026-07-10

Environment: production (`docker.home.cz`)

Document: `doc_a6547400e2be40589215d23a0b3d0fab`

## Incident

Two ingestion jobs failed at the embedding stage:

- `ing_beb8fec7e7da475f8386ff1e0f497e19`
- `ing_c31a67c918094f64ac3a31b049a32682`

The ingestion service called `POST /api/v1/embeddings` and LLM Gateway
returned HTTP 403. The configured ingestion gateway token and LLM Gateway
service token had matching length and SHA-256 fingerprint. No token value was
printed or stored in QA evidence.

The failure was caused by request construction: ingestion preferred the
original AIIP OIDC bearer token over its own LLM Gateway service token. The
gateway therefore evaluated a token outside the intended service-to-service
identity contract.

## Remediation

LLM Gateway calls now use this production contract:

```text
Authorization: Bearer <gateway service token>
X-AKL-Subject: svc-ingestion | svc-rag
X-AKL-Audience: llm-gateway-service
X-AKL-Roles: service_ingestion | service_rag
X-AKL-On-Behalf-Of: <original caller id, when available>
```

LLM Gateway requires the configured audience and at least one allowed service
role in production. The original caller token is no longer forwarded as the
gateway credential.

Upload confirmation now resolves the external identity and deterministic
version key before creating lifecycle records. An exact replay returns HTTP
200 and the existing version/job. A reused version label with a different
SHA-256 returns `UPLOAD_VERSION_HASH_CONFLICT`; an external identity mismatch
returns `UPLOAD_EXTERNAL_IDENTITY_CONFLICT`.

The document Processing tab also exposes an authorized `Run again` action for
users with `can_ingest`. It disables itself while the request is active and
shows the resulting job id and lifecycle status.

## Automated validation

- ingestion service: 47 passed, 1 skipped
- LLM Gateway: 36 passed
- RAG retrieval: 88 passed
- Registry API: 62 passed
- web: 137 passed
- web TypeScript check: passed
- local and production web builds: passed
- repository OpenAPI generation/check: passed
- repository skeleton validation: passed

The web idempotency tests cover exact label/hash replay, hash conflict, new
version creation, newest-job selection, and external tenant/system/reference
binding.

## Production evidence

Deployment completed with all affected containers healthy:

- `ingestion-service`
- `llm-gateway-service`
- `rag-retrieval-service`
- `registry-api`
- `web`

Authenticated service smokes from ingestion and RAG both returned one
1024-dimensional `bge-m3` vector through the enforced identity contract.

The authorized retry created job
`ing_558909ee985c40189b6b8e133c44d815` for existing version
`ver_d5f6eeda6ad647649d87249f2e1f8e4d`. It completed with 24 chunks. LLM
Gateway logged HTTP 200 for `/api/v1/embeddings`.

Post-ingestion index checks:

| Index | Matching document/version chunks |
| --- | ---: |
| Qdrant `akl_document_chunks` | 24 |
| OpenSearch `akl_document_chunks` | 24 |

The production AIIP integration smoke then repeated the same source using its
`stratos-akb-service` client and deterministic version label. It returned the
same document/version with `INDEXED`.

| Lifecycle count | Before replay | After replay |
| --- | ---: | ---: |
| Registry versions | 2 | 2 |
| Ingestion jobs | 3 | 3 |

This confirms that the replay created neither a duplicate version nor a new
job. The latest job remained
`ing_558909ee985c40189b6b8e133c44d815` with status `completed`.

## Rollback

Pre-deployment images are tagged with
`rollback-aiip-20260710-180421`. The web image before the retry control is
tagged `rollback-aiip-pre-retry-ui-20260710-182119`.

Source backups:

- `/srv/akl/backups/aiip-ingestion-20260710-180421.tar.gz`
- `/srv/akl/backups/aiip-retry-ui-20260710-182119.tar.gz`

AIIP's temporary 409 lifecycle reconciliation remains compatible during the
transition window, but exact replays no longer depend on that fallback.
