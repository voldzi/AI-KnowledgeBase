#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

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

BACKUP_ROOT="${BACKUP_DIR:-infra/backup/artifacts}"
if [[ "$BACKUP_ROOT" != /* ]]; then
  BACKUP_ROOT="$ROOT_DIR/$BACKUP_ROOT"
fi

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET_DIR="$BACKUP_ROOT/akl-backup-$TIMESTAMP"
mkdir -p "$TARGET_DIR"/{postgres,minio,qdrant,keycloak,config}

compose() {
  if [[ -f "$ENV_FILE" ]]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}

echo "Writing backup to $TARGET_DIR"

echo "Backing up PostgreSQL"
compose exec -T postgres pg_dumpall -U "${POSTGRES_USER:-akl_platform}" > "$TARGET_DIR/postgres/pg_dumpall.sql"

echo "Backing up MinIO bucket ${MINIO_DEFAULT_BUCKET:-akl-documents}"
DATA_NETWORK="${COMPOSE_PROJECT_NAME:-akl}_data_zone"
docker run --rm \
  --network "$DATA_NETWORK" \
  -e "MC_HOST_${MINIO_BACKUP_ALIAS:-akl}=http://${MINIO_ROOT_USER:?MINIO_ROOT_USER must be set}:${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD must be set}@minio:9000" \
  -v "$TARGET_DIR/minio:/backup" \
  minio/mc mirror --overwrite "${MINIO_BACKUP_ALIAS:-akl}/${MINIO_DEFAULT_BUCKET:-akl-documents}" "/backup/${MINIO_DEFAULT_BUCKET:-akl-documents}"

echo "Backing up Qdrant snapshots"
QDRANT_ENDPOINT="${QDRANT_BACKUP_URL:-http://localhost:6333}"
IFS=',' read -ra collections <<< "${QDRANT_COLLECTIONS:-akl_chunks}"
for collection in "${collections[@]}"; do
  collection="$(echo "$collection" | xargs)"
  [[ -z "$collection" ]] && continue
  response="$(curl -fsS -X POST "$QDRANT_ENDPOINT/collections/$collection/snapshots")"
  printf '%s\n' "$response" > "$TARGET_DIR/qdrant/$collection.snapshot-response.json"
  snapshot_name="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("result", {}).get("name", ""))' <<< "$response")"
  if [[ -n "$snapshot_name" ]]; then
    curl -fsS "$QDRANT_ENDPOINT/collections/$collection/snapshots/$snapshot_name" \
      -o "$TARGET_DIR/qdrant/$collection-$snapshot_name"
  fi
done

echo "Backing up Keycloak realm configuration"
cp "$ROOT_DIR/infra/keycloak/realm-akl.json" "$TARGET_DIR/keycloak/realm-akl.json"
if compose ps keycloak >/dev/null 2>&1; then
  if compose exec -T keycloak /opt/keycloak/bin/kc.sh export --realm "${KEYCLOAK_REALM:-akl}" --file /tmp/akl-realm-export.json --users realm_file >/dev/null 2>&1; then
    compose exec -T keycloak cat /tmp/akl-realm-export.json > "$TARGET_DIR/keycloak/realm-live-export.json" || true
  fi
fi

echo "Backing up infrastructure configuration"
cp "$COMPOSE_FILE" "$TARGET_DIR/config/$(basename "$COMPOSE_FILE")"
cp -R "$ROOT_DIR/infra/reverse-proxy" "$TARGET_DIR/config/reverse-proxy"
cp -R "$ROOT_DIR/infra/monitoring" "$TARGET_DIR/config/monitoring"
cp "$ROOT_DIR/.env.example" "$TARGET_DIR/config/.env.example"
if [[ "${BACKUP_INCLUDE_ENV:-false}" == "true" && -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "$TARGET_DIR/config/.env"
  chmod 600 "$TARGET_DIR/config/.env"
else
  printf '%s\n' "Runtime .env was not copied. Set BACKUP_INCLUDE_ENV=true only for encrypted backup storage." \
    > "$TARGET_DIR/config/ENV_NOT_INCLUDED.txt"
fi

echo "Creating archive"
tar -czf "$TARGET_DIR.tar.gz" -C "$BACKUP_ROOT" "$(basename "$TARGET_DIR")"

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
find "$BACKUP_ROOT" -maxdepth 1 -type d -name 'akl-backup-*' -mtime +"$RETENTION_DAYS" -prune -exec rm -rf {} +
find "$BACKUP_ROOT" -maxdepth 1 -type f -name 'akl-backup-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

echo "Backup completed: $TARGET_DIR.tar.gz"
