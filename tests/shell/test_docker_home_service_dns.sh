#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose/docker-compose.docker-home.yml"

grep -Fq "WEB_UPSTREAM: \${WEB_UPSTREAM:-web:3000}" "$COMPOSE_FILE" \
  || {
    printf 'Docker Home reverse proxy must use the stable Compose web service DNS name.\n' >&2
    exit 1
  }

grep -Fq "web=http://web:3000\${AKL_WEB_BASE_PATH:-/akb}/health" "$COMPOSE_FILE" \
  || {
    printf 'Docker Home readiness checks must use the stable Compose web service DNS name.\n' >&2
    exit 1
  }

if grep -Fq 'akl-web-1' "$COMPOSE_FILE"; then
  printf 'Docker Home runtime configuration must not depend on an ephemeral container name.\n' >&2
  exit 1
fi

printf 'Docker Home service-DNS regression checks passed.\n'
