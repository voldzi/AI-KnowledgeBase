#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${AKL_PROD_ENV_FILE:-/srv/akl/env/akl.prod.env}"
COMPOSE_FILE="${ROOT_DIR}/infra/docker-compose/docker-compose.docker-home.yml"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")

cd "${ROOT_DIR}"

printf 'AKL docker.home.cz deploy\n'
printf 'Repo: %s\n' "${ROOT_DIR}"
printf 'Env:  %s\n' "${ENV_FILE}"

"${ROOT_DIR}/scripts/bootstrap_docker_home_checkout.sh" "${ENV_FILE}"

AKL_PROD_ENV_FILE="${ENV_FILE}" \
  "${ROOT_DIR}/scripts/docker_home_preflight.sh"

printf 'Rendering docker compose config...\n'
"${COMPOSE[@]}" config >/tmp/akl-compose-rendered.yml

printf 'Building images...\n'
DOCKER_BUILDKIT=1 "${COMPOSE[@]}" build

printf 'Validating web image base path...\n'
expected_web_base_path="$(
  ENV_FILE="${ENV_FILE}" python3 - <<'PY'
import os
from pathlib import Path

value = "/akb"
for raw_line in Path(os.environ["ENV_FILE"]).read_text().splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, raw_value = line.split("=", 1)
    if key.strip() == "AKL_WEB_BASE_PATH":
        value = raw_value.strip().strip('"').strip("'")
        break

print(value.rstrip("/") or "/")
PY
)"

if [[ "${expected_web_base_path}" != "/akb" ]]; then
  printf 'ERROR: docker-home web base path must be /akb, got %s\n' "${expected_web_base_path}" >&2
  exit 1
fi

web_image_id="$("${COMPOSE[@]}" images -q web)"
if [[ -z "${web_image_id}" ]]; then
  printf 'ERROR: web image was not built.\n' >&2
  exit 1
fi

docker run --rm --entrypoint node "${web_image_id}" - "${expected_web_base_path}" <<'NODE'
const fs = require("fs");

const expectedBasePath = process.argv[2];
const requiredServerFilesPath = ".next/required-server-files.json";
const embeddedConfig = JSON.parse(fs.readFileSync(requiredServerFilesPath, "utf8")).config ?? {};
const embeddedBasePath = embeddedConfig.basePath || "";
const runtimeBasePath = process.env.NEXT_PUBLIC_AKL_BASE_PATH || "";

if (embeddedBasePath !== expectedBasePath || runtimeBasePath !== expectedBasePath) {
  console.error(
    `ERROR: web image basePath mismatch. expected=${expectedBasePath} embedded=${embeddedBasePath || "(empty)"} runtime=${runtimeBasePath || "(empty)"}`
  );
  process.exit(1);
}

console.log(`ok: web image basePath ${expectedBasePath}`);
NODE

printf 'Starting services...\n'
"${COMPOSE[@]}" up -d

printf 'Deployment finished.\n'
printf 'Rendered compose: /tmp/akl-compose-rendered.yml\n'
