#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose/docker-compose.docker-home.yml"
ENV_EXAMPLE="$ROOT_DIR/infra/docker-compose/docker-home.env.example"

grep -Fq "WEB_UPSTREAM=akl-platform-web:3000" "$ENV_EXAMPLE" \
  || {
    printf 'Docker Home production env must route the reverse proxy through the collision-free AKB web service DNS name.\n' >&2
    exit 1
  }

grep -Fq "web=http://akl-platform-web:3000/akb/health" "$ENV_EXAMPLE" \
  || {
    printf 'Docker Home production env readiness checks must use the collision-free AKB web service DNS name.\n' >&2
    exit 1
  }

awk '
  /^  web:$/ { in_web = 1; next }
  in_web && /^  [a-zA-Z0-9_-]+:$/ { exit }
  in_web { print }
' "$COMPOSE_FILE" | grep -Fq 'akl-platform-web' \
  || {
    printf 'Docker Home web service must publish the collision-free AKB network alias.\n' >&2
    exit 1
  }

if grep -Fq 'akl-web-1' "$ENV_EXAMPLE"; then
  printf 'Docker Home production env must not depend on an ephemeral container name.\n' >&2
  exit 1
fi

printf 'Docker Home service-DNS regression checks passed.\n'
