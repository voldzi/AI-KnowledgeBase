# AKL Backup And Restore

The backup scripts cover the Platform / Infrastructure owned runtime state:

- PostgreSQL dump through `pg_dumpall`,
- MinIO bucket mirror through `minio/mc`,
- Qdrant collection snapshots,
- Keycloak realm configuration,
- reverse proxy and monitoring configuration.

Secrets are not copied by default. Set `BACKUP_INCLUDE_ENV=true` only when the target backup storage is encrypted and access controlled.

## Backup

```bash
./infra/backup/backup.sh
```

## Restore

```bash
RESTORE_CONFIRM=restore-akl ./infra/backup/restore.sh infra/backup/artifacts/akl-backup-YYYYMMDDTHHMMSSZ
```

Qdrant snapshot restore is opt-in:

```bash
RESTORE_CONFIRM=restore-akl RESTORE_QDRANT_SNAPSHOTS=true ./infra/backup/restore.sh <backup-directory>
```

## Limits

- The scripts expect Docker Compose service names from `infra/docker-compose`.
- MinIO restore overwrites objects in the configured bucket.
- Keycloak live import/export should be tested in a staging realm before production use.
- Monthly restore tests are required by the deployment model.
