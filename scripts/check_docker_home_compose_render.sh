#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/docker-compose/docker-compose.docker-home.yml"
ENV_FILE="${ROOT_DIR}/infra/docker-compose/docker-home.env.example"
OUTPUT_FILE="${ROOT_DIR}/.tmp/docker-home-compose.rendered.yml"

mkdir -p "${ROOT_DIR}/.tmp"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >"$OUTPUT_FILE"

printf 'Rendered compose config to %s\n' "$OUTPUT_FILE"
