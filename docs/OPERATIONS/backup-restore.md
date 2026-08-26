# Local Development Backup And Restore Operations

This document describes the repository-provided backup helpers for the local
development Compose stack. It is not the production SeaweedFS/S3, PostgreSQL HA
or full disaster-recovery procedure.

For production recovery design, ownership, restore order and acceptance use
`docs/OPERATIONS/disaster-recovery.md`. For the current central object-storage
contract use `docs/OPERATIONS/central-s3-object-storage.md`. Immutable releases
also create and validate their own Registry database migration backup as
documented in `docs/OPERATIONS/immutable-docker-home-release.md`.

## Scope

The default local helper covers:

- PostgreSQL databases,
- the local MinIO development bucket,
- Qdrant collections,
- OpenSearch alias/mapping/count inventory and the evidence needed to rebuild
  the derived central index,
- Keycloak realm configuration,
- reverse proxy and local monitoring configuration.

It does not back up the current production SeaweedFS S3 bucket, central
PostgreSQL service, central OpenSearch cluster, production Keycloak or the
site's secret manager. It also does not prove document Registry, ingestion,
RAG, governance or ACL recovery. Those checks require an isolated restore
rehearsal.

## Local Backup Command

```bash
./infra/backup/backup.sh
```

The script writes timestamped backups under `infra/backup/artifacts` by default.

## Local Restore Command

```bash
RESTORE_CONFIRM=restore-akl ./infra/backup/restore.sh infra/backup/artifacts/akl-backup-YYYYMMDDTHHMMSSZ
```

Qdrant snapshot restore is opt-in:

```bash
RESTORE_CONFIRM=restore-akl RESTORE_QDRANT_SNAPSHOTS=true ./infra/backup/restore.sh <backup-directory>
```

The production OpenSearch index is centrally operated and rebuildable. Never
copy its Docker volume or Lucene data as an AKB backup. A production recovery
record must preserve the active alias, mapping revision,
chunk/document/version/entity counts and matching Qdrant/Registry release.
Restore canonical stores first, then rebuild the central alias using
`docs/OPERATIONS/central-opensearch.md`. Central snapshots and replica recovery
remain the responsibility of the central OpenSearch operator.

## Secrets

`.env` is not copied by default because it may contain passwords or client secrets. Use:

```bash
BACKUP_INCLUDE_ENV=true ./infra/backup/backup.sh
```

only when the backup target is encrypted and access controlled.

## Example Local Schedule

| Frequency | Action |
|---|---|
| Daily | Local PostgreSQL dump, local MinIO mirror, Qdrant snapshot. |
| Weekly | Full archive review and off-host copy. |
| Monthly | Local restore test in an isolated environment. |

This table is a development recommendation, not evidence of an active
production schedule. Each production site must approve and monitor its own
schedule, retention, encryption, off-site copy, RTO and RPO.

## Local Restore Test Checklist

- Start clean infrastructure.
- Restore PostgreSQL.
- Restore MinIO bucket.
- Restore or verify Qdrant snapshots.
- Rebuild the OpenSearch alias and compare all recorded counts and policy-field
  completeness.
- Import or verify Keycloak realm configuration.
- Confirm `/health` and `/ready` through reverse proxy.
- Confirm Prometheus target health.
- Record restore duration and failures.

A production restore additionally requires the canonical S3 inventory,
Registry/object hash reconciliation, identity/policy recovery, exact release
images, negative ACL tests, citation checks, monitoring recovery and a signed
restore report. See `docs/OPERATIONS/disaster-recovery.md`.

## Known Limits

- The helper assumes the development Compose service names and local MinIO
  semantics. Do not point it at production.
- MinIO restore overwrites objects in the selected local target bucket.
- Qdrant snapshot upload requires compatible Qdrant versions.
- OpenSearch Lucene data must never be copied between major/minor image
  generations; use the documented logical reindex.
- Keycloak production realm imports should be reviewed before applying to a live realm.
- Backups must be encrypted outside the local developer workstation.
- No successful production restore is implied by this repository helper.
