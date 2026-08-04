#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/docker-compose/docker-compose.docker-home.yml"
ENV_FILE="${ROOT_DIR}/infra/docker-compose/docker-home.env.example"
OUTPUT_FILE="${ROOT_DIR}/.tmp/docker-home-compose.rendered.yml"
JSON_OUTPUT_FILE="${ROOT_DIR}/.tmp/docker-home-compose.rendered.json"

mkdir -p "${ROOT_DIR}/.tmp"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >"$OUTPUT_FILE"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --format json >"$JSON_OUTPUT_FILE"

python3 - "$JSON_OUTPUT_FILE" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    compose = json.load(handle)

services = compose.get("services", {})
volumes = compose.get("volumes", {})
if "clamav" in services:
    raise SystemExit("Production Compose must not define a local clamav service.")
if any("clamav" in name.lower() for name in volumes):
    raise SystemExit("Production Compose must not define a ClamAV data volume.")

expected_endpoint = "tcp://scan.home.cz:3310"
for service_name in ("web", "registry-api", "ingestion-service"):
    environment = services[service_name].get("environment", {})
    if environment.get("STRATOS_CONTENT_SECURITY_REQUIRED") != "true":
        raise SystemExit(f"{service_name} must require content-security attestation.")
    if environment.get("STRATOS_CONTENT_SECURITY_ENDPOINT") != expected_endpoint:
        raise SystemExit(f"{service_name} must use the shared scanner endpoint.")

for service in services.values():
    depends_on = service.get("depends_on", {})
    if "clamav" in depends_on:
        raise SystemExit("Production Compose must not depend on a local clamav service.")
PY

printf 'Rendered compose config to %s\n' "$OUTPUT_FILE"
printf 'Verified shared content-security endpoint in %s\n' "$JSON_OUTPUT_FILE"
