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

### `REGISTRY_SERVICE_AUTH_UNAVAILABLE` Or Ingestion Registry `not_ready`

1. Confirm the token URL and non-secret client id are
   `AKL_INGESTION_REGISTRY_TOKEN_URL` and `svc-ingestion`.
2. Verify `/srv/akl/env/svc-ingestion.client-secret` exists with mode `0600` and
   is mounted read-only as `/run/secrets/svc-ingestion-client-secret`; never
   print the value.
3. Confirm Registry trusted clients include `svc-ingestion` with exactly
   `authz|audit|documents-read|ingestion-status`, while `aiip-service` remains
   exactly `aiip-upload`.
4. Compare only token expiry/audience/client-id metadata or a short SHA-256
   fingerprint. Never substitute the inbound AIIP bearer or LLM Gateway token.
5. Recreate `ingestion-service`, wait for `/ready`, then run one disposable
   dedicated-confirm ingestion and verify status-only transition to `INDEXED`.

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

On `docker.home.cz`, recovery is forward-fix only:

1. Record the failed full Git SHA, full-SHA image tags, deployment record, and
   error/correlation ids. Inspect `/srv/akl/state/applied-runtime.env` without
   editing it. `/srv/akl/current` remains the last fully verified release, but
   a hard process loss or failed quarantine can leave running containers from
   the failed release. For a handled post-start verification failure, require
   `target_services_start_may_have_started=true` and inspect the per-service
   `target_*_quarantined` / `target_*_quarantine_failed` fields. Successful
   quarantine means the exact affected target containers and restart policies
   were removed; it is not an old-image rollback.
   If `registry_stop_may_have_started=true`, independently inspect the exact
   captured Registry container before clearing a stale deployment lock; the
   writer may be stopped even when `registry_quiesced=false`.
   Inspect `old_registry_was_running`, `old_registry_was_restarting`, the
   lock-bound file under `/srv/akl/state/registry-quiescence/`,
   `writable_primary_pre_stop_checked`,
   `writable_primary_pre_quiesce_checked`, and
   `writable_primary_pre_migration_checked` in the same record. A failed first
   gate leaves the writer untouched and is pre-build. A failed pre-quiesce gate
   also leaves it untouched but is post-build. A failed post-backup gate occurs
   before migration and restores the exact captured predecessor only when it
   was originally running/restarting; a restart-gap predecessor captured as stopped must
   remain stopped.
   Also inspect `target_build_may_have_started` and
   `retry_requires_descendant_sha`. If both show the build boundary was crossed,
   inspect `/srv/akl/state/burned-shas/<failed-full-sha>`, retain all immutable
   tags, and do not retry that SHA even when a target tag is absent and
   `migration_started=false`; prepare a reviewed descendant. Never delete the
   burn marker to manufacture a retry.
   If `deploy_lock_preserved=true` or a quarantine-failure field is true, do
   not clear the lock until the recorded PID is absent, no release process is
   active, and every remaining affected container has been checked against the
   exact Compose project/service, durable configured/running image ID, release labels, and
   Compose-file identity. Remove only the proven unverified target; never start
   a predecessor after migration.
2. Do not start older code against a possibly migrated schema. Do not run an
   Alembic downgrade, in-place restore, reset, or Docker volume deletion.
3. Prepare and review a fix commit descending from the exact `applied_sha` in
   the runtime marker. Ordinary deployment and a non-descendant SHA are
   intentionally rejected while it differs from `/srv/akl/current`.
4. Run `scripts/rollback_docker_home_release.sh --failed-sha <failed-full-sha>
   --forward-fix-sha <fix-full-sha>` from `/srv/akl/current`.
   Exception: if the failure occurred during the one-time upgrade from a
   pre-contract-2 `current`, never execute the old current script. Run the
   recovery entry point from the exact hardened failed release at
   `/srv/akl/releases/<failed-full-sha>/scripts/rollback_docker_home_release.sh`.
5. The normal backup, migration, health/readiness, public fail-closed smoke, and
   atomic activation gates must all pass again.

Before classifying any Registry dump as recovery-ready, complete the isolated,
unpublished empty-database restore rehearsal and retain its checksum, exact tool
image, Alembic, critical-row-count, cleanup, and reviewer evidence as specified
in `docs/OPERATIONS/immutable-docker-home-release.md`.

One non-migration crash boundary has a narrower recovery. When the runtime
marker is `state=verified`, `phase=verified`, and names the requested SHA but
`/srv/akl/current` still names its predecessor, rerun that same SHA after the
stale-lock investigation. The workflow re-verifies exact running images and
durably completes `current`; it does not rebuild, redump, or migrate.
If `current` already names that verified target but the last record remains
`activating_current`, the same no-forward-fix retry re-verifies and records
`reconciled_verified_success` without replacing the link. Never use the
rollback wrapper or a mismatched failed SHA to force either reconciliation.
Both reconciliation paths load the original post-build image IDs from the
mode-`0600` deployment record named by the runtime marker and require the tag
and sole running Compose container to retain those IDs before and after smoke.

A SIGKILL during a writable-primary gate or Registry backup may leave a private
directory below `/srv/akl/state/postgres-credentials`. Never print its `pgpass`.
After proving the deployment lock and all related processes are dead, remove
only the exact strictly validated directory with
`scripts/cleanup_stale_release_postgres_credentials.sh --credential-dir
<absolute-directory>` from the exact hardened release that created it. Any remaining entry
blocks the next deployment.

Local development rollback remains environment-specific and must not be used
as a production recovery instruction.

Detailed references:

- `docs/deployment/docker-home-cz.md`
- `docs/deployment/local-production.md`
- `docs/OPERATIONS/backup-restore.md`
- `docs/OPERATIONS/immutable-docker-home-release.md`
- `docs/maintenance/release-process.md`
