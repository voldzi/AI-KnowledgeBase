#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${AKL_PROD_ENV_FILE:-/srv/akl/env/akl.prod.env}"
COMPOSE_FILE="${ROOT_DIR}/infra/docker-compose/docker-compose.docker-home.yml"

printf 'AKL docker.home.cz deploy\n'
printf 'Repo: %s\n' "${ROOT_DIR}"
printf 'Env:  %s\n' "${ENV_FILE}"

"${ROOT_DIR}/scripts/bootstrap_docker_home_checkout.sh" "${ENV_FILE}"

AKL_PROD_ENV_FILE="${ENV_FILE}" \
  "${ROOT_DIR}/scripts/docker_home_preflight.sh"

printf 'Rendering docker compose config...\n'
docker compose -f "${COMPOSE_FILE}" config >/tmp/akl-compose-rendered.yml

printf 'Building images...\n'
DOCKER_BUILDKIT=1 docker compose \
  -f "${COMPOSE_FILE}" \
  build

printf 'Starting services...\n'
docker compose -f "${COMPOSE_FILE}" up -d

printf 'Deployment finished.\n'
printf 'Rendered compose: /tmp/akl-compose-rendered.yml\n'
