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
    "docling-worker",
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
    "docling-worker",
)
for service_name in release_services:
    image = tagged_compose["services"][service_name].get("image", "")
    if not image.endswith(f":{test_image_tag}"):
        raise SystemExit(
            f"{service_name} does not inherit the immutable AKL_IMAGE_TAG: {image}"
        )

if "qdrant" not in services:
    raise SystemExit("Production Compose must retain the shared Qdrant service.")

worker = services["docling-worker"]
if worker.get("network_mode") != "none":
    raise SystemExit("Docling worker must have no Docker network.")
if worker.get("pids_limit") != 256 or worker.get("mem_limit") != "6442450944":
    raise SystemExit("Docling worker resource limits are missing or unexpected.")
if worker.get("cpus") != 4.0:
    raise SystemExit("Docling worker CPU limit is missing or unexpected.")
if worker.get("command") != ["python", "-m", "parsers.docling_service"]:
    raise SystemExit("Docling worker must expose only the Unix-socket service.")
worker_environment = worker.get("environment", {})
for key in worker_environment:
    upper = key.upper()
    if (
        upper.endswith(("_PASSWORD", "_SECRET", "_TOKEN"))
        or any(fragment in upper for fragment in (
            "DATABASE", "OIDC", "REGISTRY", "OPENSEARCH", "QDRANT",
            "S3_ACCESS", "LLM_GATEWAY",
        ))
    ):
        raise SystemExit(f"Docling worker contains forbidden environment key: {key}")
worker_volumes = {
    mount["target"]: (mount["type"], bool(mount.get("read_only")))
    for mount in worker.get("volumes", [])
}
if worker_volumes != {
    "/opt/docling-artifacts": ("bind", True),
    "/run/akb-docling": ("volume", False),
}:
    raise SystemExit("Docling worker mounts exceed the approved model/socket boundary.")
ingestion_volumes = {
    mount["target"]: bool(mount.get("read_only"))
    for mount in services["ingestion-service"].get("volumes", [])
}
if ingestion_volumes.get("/run/akb-docling") is not True:
    raise SystemExit("Ingestion must mount the Docling socket volume read-only.")
if "/opt/docling-artifacts" in ingestion_volumes:
    raise SystemExit("Ingestion must not mount the Docling model bundle.")
if services["ingestion-service"].get("depends_on", {}).get("docling-worker", {}).get("condition") != "service_healthy":
    raise SystemExit("Ingestion must wait for the isolated Docling worker health gate.")
PY

printf 'Rendered compose config to %s\n' "$OUTPUT_FILE"
printf 'Verified shared content-security endpoint in %s\n' "$JSON_OUTPUT_FILE"
printf 'Verified immutable service tags and runtime hardening in %s\n' "$TAGGED_JSON_OUTPUT_FILE"
