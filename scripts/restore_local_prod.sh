#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: RESTORE_CONFIRM=restore-akl $0 <backup-directory>"
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

export BACKUP_ENV_FILE="${AKL_LOCAL_PROD_ENV_FILE:-$ROOT_DIR/.env.local-prod}"
export BACKUP_COMPOSE_FILE="${AKL_LOCAL_PROD_COMPOSE_FILE:-infra/docker-compose/docker-compose.dev.yml}"
export QDRANT_COLLECTIONS="${QDRANT_COLLECTIONS:-akl_document_chunks}"

exec "$ROOT_DIR/infra/backup/restore.sh" "$1"
