#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: RESTORE_CONFIRM=restore-akl $0 <backup-directory>"
  exit 2
fi

if [[ "${RESTORE_CONFIRM:-}" != "restore-akl" ]]; then
  echo "Refusing to restore without RESTORE_CONFIRM=restore-akl"
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_SOURCE="$1"

if [[ "$BACKUP_SOURCE" != /* ]]; then
  BACKUP_SOURCE="$ROOT_DIR/$BACKUP_SOURCE"
fi

if [[ ! -d "$BACKUP_SOURCE" ]]; then
  echo "Backup directory not found: $BACKUP_SOURCE"
  exit 2
fi

ENV_FILE="${BACKUP_ENV_FILE:-$ROOT_DIR/.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

COMPOSE_FILE="${BACKUP_COMPOSE_FILE:-infra/docker-compose/docker-compose.dev.yml}"
if [[ "$COMPOSE_FILE" != /* ]]; then
  COMPOSE_FILE="$ROOT_DIR/$COMPOSE_FILE"
fi

compose() {
  if [[ -f "$ENV_FILE" ]]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}

if [[ -f "$BACKUP_SOURCE/postgres/pg_dumpall.sql" ]]; then
  echo "Restoring PostgreSQL from pg_dumpall.sql"
  compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-akl_platform}" -d postgres \
    < "$BACKUP_SOURCE/postgres/pg_dumpall.sql"
fi

if [[ -d "$BACKUP_SOURCE/minio/${MINIO_DEFAULT_BUCKET:-akl-documents}" ]]; then
  echo "Restoring MinIO bucket ${MINIO_DEFAULT_BUCKET:-akl-documents}"
  DATA_NETWORK="${COMPOSE_PROJECT_NAME:-akl}_data_zone"
  docker run --rm \
    --network "$DATA_NETWORK" \
    -e "MC_HOST_${MINIO_BACKUP_ALIAS:-akl}=http://${MINIO_ROOT_USER:?MINIO_ROOT_USER must be set}:${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD must be set}@minio:9000" \
    -v "$BACKUP_SOURCE/minio:/backup:ro" \
    minio/mc mirror --overwrite "/backup/${MINIO_DEFAULT_BUCKET:-akl-documents}" "${MINIO_BACKUP_ALIAS:-akl}/${MINIO_DEFAULT_BUCKET:-akl-documents}"
fi

if [[ "${RESTORE_QDRANT_SNAPSHOTS:-false}" == "true" && -d "$BACKUP_SOURCE/qdrant" ]]; then
  echo "Restoring Qdrant snapshots"
  QDRANT_ENDPOINT="${QDRANT_BACKUP_URL:-http://localhost:6333}"
  find "$BACKUP_SOURCE/qdrant" -type f ! -name '*.json' -print0 | while IFS= read -r -d '' snapshot; do
    filename="$(basename "$snapshot")"
    collection="${filename%%-*}"
    curl -fsS -X POST "$QDRANT_ENDPOINT/collections/$collection/snapshots/upload?priority=snapshot" \
      -F "snapshot=@$snapshot" >/dev/null
  done
fi

echo "Restore completed from $BACKUP_SOURCE"
echo "Keycloak realm files are in $BACKUP_SOURCE/keycloak. Import them through Keycloak admin tooling for controlled environments."
