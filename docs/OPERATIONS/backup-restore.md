# Backup And Restore Operations

This document operationalizes `docs/OPERATIONS/07_DEPLOYMENT_MODEL.md` for the Platform / Infrastructure thread.

## Scope

Backups cover:

- PostgreSQL databases,
- MinIO document bucket,
- Qdrant collections,
- OpenSearch alias/mapping/count inventory and the evidence needed to rebuild
  the derived central index,
- Keycloak realm configuration,
- reverse proxy and monitoring configuration.

Backups do not validate document registry, ingestion, RAG, or governance business workflows. Those checks belong to the owning service threads.

## Backup Command

```bash
./infra/backup/backup.sh
```

The script writes timestamped backups under `infra/backup/artifacts` by default.

## Restore Command

```bash
RESTORE_CONFIRM=restore-akl ./infra/backup/restore.sh infra/backup/artifacts/akl-backup-YYYYMMDDTHHMMSSZ
```

Qdrant snapshot restore is opt-in:

```bash
RESTORE_CONFIRM=restore-akl RESTORE_QDRANT_SNAPSHOTS=true ./infra/backup/restore.sh <backup-directory>
```

The production OpenSearch index is centrally operated and rebuildable. AKB
backup does not copy its Docker volume or Lucene data. Record the active alias,
mapping revision, chunk/document/version/entity counts, and the matching
Qdrant/Registry release. Restore canonical stores first, then rebuild the
central alias from Qdrant with
`docs/OPERATIONS/central-opensearch.md`. Central cluster snapshots and replica
recovery remain the responsibility of the central OpenSearch operator.

## Secrets

`.env` is not copied by default because it may contain passwords or client secrets. Use:

```bash
BACKUP_INCLUDE_ENV=true ./infra/backup/backup.sh
```

only when the backup target is encrypted and access controlled.

## Schedule

| Frequency | Action |
|---|---|
| Daily | PostgreSQL dump, MinIO mirror, Qdrant snapshot. |
| Weekly | Full archive review and off-host copy. |
| Monthly | Restore test in isolated environment. |

## Restore Test Checklist

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

## Known Limits

- MinIO restore overwrites objects in the target bucket.
- Qdrant snapshot upload requires compatible Qdrant versions.
- OpenSearch Lucene data must never be copied between major/minor image
  generations; use the documented logical reindex.
- Keycloak production realm imports should be reviewed before applying to a live realm.
- Backups must be encrypted outside the local developer workstation.
