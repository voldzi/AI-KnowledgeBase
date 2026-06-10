#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ENV_FILE="${1:-/srv/akl/env/akl.prod.env}"
REPO_ENV_FILE="${ROOT_DIR}/.env"
COMPOSE_ENV_FILE="${ROOT_DIR}/infra/docker-compose/.env"

if [[ ! -f "$TARGET_ENV_FILE" ]]; then
  printf 'ERROR: env file not found: %s\n' "$TARGET_ENV_FILE" >&2
  exit 1
fi

cp "$TARGET_ENV_FILE" "$REPO_ENV_FILE"
cp "$TARGET_ENV_FILE" "$COMPOSE_ENV_FILE"

printf 'Copied %s -> %s\n' "$TARGET_ENV_FILE" "$REPO_ENV_FILE"
printf 'Copied %s -> %s\n' "$TARGET_ENV_FILE" "$COMPOSE_ENV_FILE"
printf 'docker compose for %s will now auto-load %s\n' "${ROOT_DIR}/infra/docker-compose" "$COMPOSE_ENV_FILE"
