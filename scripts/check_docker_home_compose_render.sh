#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/infra/docker-compose/docker-compose.docker-home.yml"
ENV_FILE="${ROOT_DIR}/infra/docker-compose/docker-home.env.example"
OUTPUT_FILE="${ROOT_DIR}/.tmp/docker-home-compose.rendered.yml"
JSON_OUTPUT_FILE="${ROOT_DIR}/.tmp/docker-home-compose.rendered.json"
TAGGED_JSON_OUTPUT_FILE="${ROOT_DIR}/.tmp/docker-home-compose.tagged.json"
TEST_IMAGE_TAG="0123456789abcdef0123456789abcdef01234567"

mkdir -p "${ROOT_DIR}/.tmp"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >"$OUTPUT_FILE"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --format json >"$JSON_OUTPUT_FILE"
AKL_IMAGE_TAG="$TEST_IMAGE_TAG" \
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --format json \
  >"$TAGGED_JSON_OUTPUT_FILE"

python3 - "$JSON_OUTPUT_FILE" "$TAGGED_JSON_OUTPUT_FILE" "$TEST_IMAGE_TAG" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    compose = json.load(handle)
with open(sys.argv[2], encoding="utf-8") as handle:
    tagged_compose = json.load(handle)
test_image_tag = sys.argv[3]
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

for service_name in (
    "registry-api",
    "rag-retrieval-service",
    "llm-gateway-service",
    "governance-service",
):
    service = services[service_name]
    if service.get("read_only") is not True:
        raise SystemExit(f"{service_name} must use a read-only root filesystem.")
    if "ALL" not in service.get("cap_drop", []):
        raise SystemExit(f"{service_name} must drop all Linux capabilities.")
    if "no-new-privileges:true" not in service.get("security_opt", []):
        raise SystemExit(f"{service_name} must enable no-new-privileges.")

release_services = (
    "web",
    "chat-web",
    "registry-api",
    "ingestion-service",
    "rag-retrieval-service",
    "evaluation-service",
    "governance-service",
    "llm-gateway-service",
)
for service_name in release_services:
    image = tagged_compose["services"][service_name].get("image", "")
    if not image.endswith(f":{test_image_tag}"):
        raise SystemExit(
            f"{service_name} does not inherit the immutable AKL_IMAGE_TAG: {image}"
        )

if "qdrant" not in services:
    raise SystemExit("Production Compose must retain the shared Qdrant service.")
PY

printf 'Rendered compose config to %s\n' "$OUTPUT_FILE"
printf 'Verified shared content-security endpoint in %s\n' "$JSON_OUTPUT_FILE"
printf 'Verified immutable service tags and runtime hardening in %s\n' "$TAGGED_JSON_OUTPUT_FILE"
