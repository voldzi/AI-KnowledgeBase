# AKB Runbook

Use this runbook for first response. Detailed environment-specific procedures
remain in `docs/deployment/` and `docs/OPERATIONS/`.

## Application Does Not Start

1. Check the active environment file exists and contains no empty required
   values.
2. Validate Compose config:

   ```bash
   docker compose --env-file .env -f infra/docker-compose/docker-compose.dev.yml config >/tmp/akb-compose.yml
   ```

3. Check container logs for the failing service.
4. Verify production mode is not using mock/disabled auth.
5. Rebuild only the affected service if the image is stale.

## API Returns 5xx

1. Capture `X-Request-ID` and `X-Correlation-ID`.
2. Check web/API bridge logs, then the downstream service logs.
3. Check `/health` and `/ready` for the downstream service.
4. Confirm database, Qdrant, object storage, and LLM provider readiness.
5. If the error follows a deploy, compare current git HEAD and image tags with
   the previous known-good release.

## Database Unavailable

1. Check PostgreSQL container or HAProxy endpoint readiness.
2. Verify connection strings are present in the active env file.
3. Run the Registry PostgreSQL smoke only against the intended environment.
4. Do not change schema manually; use Alembic migrations.

## Object Storage Unavailable

1. Check storage root or S3 endpoint reachability.
2. Verify AKB object storage env variables.
3. Confirm the affected object key exists without printing signed tokens or
   secrets.
4. Retry upload/preview only after storage readiness is restored.

## Qdrant Unavailable Or Wrong Vector Size

1. Check Qdrant health.
2. Verify collection name, vector size, and embedding model.
3. If vector size mismatches the configured embedding model, stop ingestion and
   follow the documented reindex path. Do not mix mock embeddings with the real
   `bge-m3` collection.

## LLM Provider Unavailable

1. Check LLM Gateway `/ready`.
2. Check provider-specific readiness in LLM Gateway output.
3. Pull missing Ollama models through the Model Manager endpoint.
4. Switch providers only through documented configuration.

## Ingestion Job Stuck

1. Get the job id and current status.
2. Check source file availability.
3. Check parser/OCR/embedding/Qdrant logs for the same correlation id.
4. Retry ingestion through the approved API only after the root cause is fixed.

### `EMBEDDING_REQUEST_FAILED` With Gateway HTTP 403

1. Correlate the ingestion job with LLM Gateway logs and confirm the rejected
   path is `/api/v1/embeddings`.
2. Compare only token length and a short SHA-256 fingerprint between
   ingestion `AKL_LLM_GATEWAY_TOKEN` and gateway `AKL_SERVICE_TOKEN`; never
   print either token.
3. Verify the effective non-secret contract:

   ```text
   subject=svc-ingestion
   audience=llm-gateway-service
   roles include service_ingestion
   AKL_LLM_REQUIRE_CALLER_IDENTITY=true
   ```

4. Confirm ingestion uses its gateway service token, not the caller OIDC token.
   `X-AKL-On-Behalf-Of` may contain the caller id, but `X-AKL-Subject` must
   remain `svc-ingestion`.
5. After a token or identity configuration change, recreate both ingestion and
   LLM Gateway containers so neither keeps stale environment values.
6. Verify both `/ready` endpoints, run one authenticated embedding smoke, then
   call the AKB `retry-ingestion` bridge once and poll until `INDEXED` or a
   terminal failure.

Repeated upload confirmation is not a retry mechanism. An exact replay returns
the existing version/job with HTTP 200; use `retry-ingestion` after fixing a
terminal `FAILED` job. Po retry ověřte nejen webový status, ale také Registry
`current_ingestion_job_id` a `current_ingestion_status`; ingestion je nyní
synchronizuje auditovaně ve stavech `INGESTING`, `INDEXED` a `FAILED`.

## High Latency

1. Split latency by web bridge, Registry, RAG, Qdrant, and LLM Gateway.
2. Check LLM model/provider latency and token counts.
3. Check Qdrant collection status and query latency.
4. Check if ingestion or reindex load is competing with query traffic.

## Invalid Configuration

1. Compare active env file to `.env.example`.
2. Ensure production does not use mock/disabled auth.
3. Ensure secrets are present in host secret stores, not committed files.
4. Update `.env.example` and docs when adding new required settings.

## Rollback After Failed Release

1. Record failing git HEAD, image tag, and error/correlation ids.
2. Restore previous known-good git revision or image tag.
3. Re-run health/readiness checks.
4. Run a narrow smoke for assistant chat and document source opening.
5. If database migrations were applied, follow the migration-specific rollback
   notes. Do not manually edit production data without a reviewed recovery plan.

Detailed references:

- `docs/deployment/docker-home-cz.md`
- `docs/deployment/local-production.md`
- `docs/OPERATIONS/backup-restore.md`
- `docs/maintenance/release-process.md`
