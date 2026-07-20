#!/usr/bin/env bash
set +x
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/immutable_release_common.sh
source "${SCRIPT_DIR}/lib/immutable_release_common.sh"

usage() {
  printf 'Usage: %s <full-git-sha> <release-dir> <comma-separated-services>\n' "$0" >&2
  exit 2
}

[[ $# -eq 3 ]] || usage
TARGET_SHA="$1"
RELEASE_DIR="$2"
SERVICE_CSV="$3"
akl_validate_full_sha "$TARGET_SHA"

RELEASE_ROOT="${AKL_RELEASE_ROOT:-/srv/akl}"
ENV_FILE="${AKL_PROD_ENV_FILE:-${RELEASE_ROOT}/env/akl.prod.env}"
COMPOSE_FILE="${RELEASE_DIR}/infra/docker-compose/docker-compose.docker-home.yml"
RETRY_ATTEMPTS="${AKL_RELEASE_VERIFY_ATTEMPTS:-12}"
RETRY_DELAY="${AKL_RELEASE_VERIFY_DELAY_SECONDS:-5}"
VERIFY_CHAT_PUBLIC="${AKL_RELEASE_VERIFY_CHAT_PUBLIC:-true}"

akl_require_private_env_file "$ENV_FILE"
akl_assert_expected_env_snapshot "$ENV_FILE"
[[ "$RELEASE_DIR" == "${RELEASE_ROOT}/releases/${TARGET_SHA}" ]] \
  || akl_fail "Verification release directory does not match the target SHA"
[[ -d "$RELEASE_DIR" && ! -L "$RELEASE_DIR" ]] \
  || akl_fail "Verification release must be a real directory"
PROJECT_NAME="$(akl_env_value "$ENV_FILE" AKL_RELEASE_COMPOSE_PROJECT akl)"
PUBLIC_BASE_URL="$(akl_env_value "$ENV_FILE" AKL_WEB_PUBLIC_BASE_URL)"
CHAT_PUBLIC_BASE_URL="$(akl_env_value "$ENV_FILE" AKL_CHAT_WEB_PUBLIC_BASE_URL)"
PROXY_PORT="$(akl_env_value "$ENV_FILE" AKL_PROXY_HTTP_PORT 8080)"
CHAT_WEB_PORT="$(akl_env_value "$ENV_FILE" AKL_CHAT_WEB_HTTP_PORT 3221)"
akl_validate_project_name "$PROJECT_NAME"
akl_require_file "$COMPOSE_FILE"
akl_require_command curl
akl_require_command docker
akl_require_command python3
akl_assert_no_ambient_env_file_overrides "$ENV_FILE"
akl_assert_local_docker_daemon_environment
akl_assert_no_ambient_compose_overrides \
  "$COMPOSE_FILE" \
  AKL_SERVICE_VERSION \
  AKL_RELEASE_COMPOSE_PROJECT \
  REGISTRY_API_IMAGE \
  INGESTION_SERVICE_IMAGE \
  RAG_RETRIEVAL_SERVICE_IMAGE \
  WEB_IMAGE \
  CHAT_WEB_IMAGE
[[ "$PUBLIC_BASE_URL" == https://* ]] \
  || akl_fail "Public verification URL must use HTTPS"
[[ "$CHAT_PUBLIC_BASE_URL" == https://* ]] \
  || akl_fail "Chat public verification URL must use HTTPS"
[[ "$RETRY_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || akl_fail "Invalid verification attempt count"
[[ "$RETRY_DELAY" =~ ^[0-9]+$ ]] || akl_fail "Invalid verification retry delay"
[[ "$VERIFY_CHAT_PUBLIC" == "true" || "$VERIFY_CHAT_PUBLIC" == "false" ]] \
  || akl_fail "AKL_RELEASE_VERIFY_CHAT_PUBLIC must be true or false"

export AKL_SERVICE_VERSION="$TARGET_SHA"
export AKL_RELEASE_COMPOSE_PROJECT="$PROJECT_NAME"
export REGISTRY_API_IMAGE="akl/registry-api:${TARGET_SHA}"
export INGESTION_SERVICE_IMAGE="akl/ingestion-service:${TARGET_SHA}"
export RAG_RETRIEVAL_SERVICE_IMAGE="akl/rag-retrieval-service:${TARGET_SHA}"
export WEB_IMAGE="akl/web:${TARGET_SHA}"
export CHAT_WEB_IMAGE="akl/chat-web:${TARGET_SHA}"
COMPOSE=(
  docker compose
  --project-name "$PROJECT_NAME"
  --env-file "$ENV_FILE"
  -f "$COMPOSE_FILE"
)

IFS=',' read -r -a services <<<"$SERVICE_CSV"
[[ ${#services[@]} -gt 0 ]] || akl_fail "At least one service must be verified"
WEB_AFFECTED="false"
CHAT_WEB_AFFECTED="false"
INGESTION_AFFECTED="false"
for service in "${services[@]}"; do
  case "$service" in
    registry-api|ingestion-service|rag-retrieval-service|web|chat-web) ;;
    *) akl_fail "Unsupported verification service: $service" ;;
  esac
  [[ "$service" != "web" ]] || WEB_AFFECTED="true"
  [[ "$service" != "chat-web" ]] || CHAT_WEB_AFFECTED="true"
  [[ "$service" != "ingestion-service" ]] || INGESTION_AFFECTED="true"
done

expected_image_for_service() {
  case "$1" in
    registry-api) printf '%s\n' "$REGISTRY_API_IMAGE" ;;
    ingestion-service) printf '%s\n' "$INGESTION_SERVICE_IMAGE" ;;
    rag-retrieval-service) printf '%s\n' "$RAG_RETRIEVAL_SERVICE_IMAGE" ;;
    web) printf '%s\n' "$WEB_IMAGE" ;;
    chat-web) printf '%s\n' "$CHAT_WEB_IMAGE" ;;
    *) akl_fail "Unsupported image identity service: $1" ;;
  esac
}

expected_image_id_for_service() {
  case "$1" in
    registry-api) printf '%s\n' "${AKL_RELEASE_EXPECTED_REGISTRY_IMAGE_ID:-}" ;;
    ingestion-service) printf '%s\n' "${AKL_RELEASE_EXPECTED_INGESTION_IMAGE_ID:-}" ;;
    rag-retrieval-service) printf '%s\n' "${AKL_RELEASE_EXPECTED_RAG_IMAGE_ID:-}" ;;
    web) printf '%s\n' "${AKL_RELEASE_EXPECTED_WEB_IMAGE_ID:-}" ;;
    chat-web) printf '%s\n' "${AKL_RELEASE_EXPECTED_CHAT_WEB_IMAGE_ID:-}" ;;
    *) akl_fail "Unsupported durable image identity service: $1" ;;
  esac
}

inspect_label() {
  local object_id="$1"
  local label_name="$2"
  docker inspect --format "{{index .Config.Labels \"${label_name}\"}}" "$object_id"
}

verify_runtime_identity() {
  local service="$1"
  local target_image expected_image_id tag_image_id image_revision image_project image_service repo_tags_json
  local container_id container_running container_image_ref container_image_id
  local compose_project compose_service compose_oneoff compose_config_files compose_config_hash
  local container_revision container_project container_service_label container_ps_output
  local -a container_ids=()

  akl_assert_expected_env_snapshot "$ENV_FILE"

  target_image="$(expected_image_for_service "$service")"
  expected_image_id="$(expected_image_id_for_service "$service")"
  [[ "$expected_image_id" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || akl_fail "Durable expected image ID is missing or invalid: $service"
  tag_image_id="$(docker image inspect --format '{{.Id}}' "$target_image")"
  [[ "$tag_image_id" == "$expected_image_id" ]] \
    || akl_fail "Target image tag no longer resolves to the durable image ID: $service"
  repo_tags_json="$(docker image inspect --format '{{json .RepoTags}}' "$target_image")"
  python3 - "$repo_tags_json" "$target_image" <<'PY'
import json
import sys

tags = json.loads(sys.argv[1])
if not isinstance(tags, list) or sys.argv[2] not in tags:
    raise SystemExit("target image does not retain the exact immutable tag")
PY
  image_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$target_image")"
  image_project="$(docker image inspect --format '{{index .Config.Labels "cz.zeleznalady.akl.compose-project"}}' "$target_image")"
  image_service="$(docker image inspect --format '{{index .Config.Labels "cz.zeleznalady.akl.service"}}' "$target_image")"
  [[ "$image_revision" == "$TARGET_SHA" ]] \
    || akl_fail "Target image revision label does not match the release SHA: $target_image"
  [[ "$image_project" == "$PROJECT_NAME" ]] \
    || akl_fail "Target image project label does not match the Compose project: $target_image"
  [[ "$image_service" == "$service" ]] \
    || akl_fail "Target image service label does not match the release service: $target_image"

  container_ps_output="$("${COMPOSE[@]}" ps -q "$service")" \
    || akl_fail "Could not enumerate the release service container: $service"
  if [[ -n "$container_ps_output" ]]; then
    mapfile -t container_ids <<<"$container_ps_output"
  fi
  [[ ${#container_ids[@]} -eq 1 && -n "${container_ids[0]}" ]] \
    || akl_fail "Release service must resolve to exactly one project container: $service"
  container_id="${container_ids[0]}"
  container_running="$(docker inspect --format '{{.State.Running}}' "$container_id")"
  container_image_ref="$(docker inspect --format '{{.Config.Image}}' "$container_id")"
  container_image_id="$(docker inspect --format '{{.Image}}' "$container_id")"
  [[ "$container_running" == "true" ]] \
    || akl_fail "Release container is not running: $service"
  [[ "$container_image_ref" == "$expected_image_id" ]] \
    || akl_fail "Release container was not started through the durable image ID: $service"
  [[ "$container_image_id" == "$expected_image_id" ]] \
    || akl_fail "Release container image ID does not match the target image: $service"

  compose_project="$(inspect_label "$container_id" com.docker.compose.project)"
  compose_service="$(inspect_label "$container_id" com.docker.compose.service)"
  compose_oneoff="$(inspect_label "$container_id" com.docker.compose.oneoff)"
  compose_config_files="$(inspect_label "$container_id" com.docker.compose.project.config_files)"
  compose_config_hash="$(inspect_label "$container_id" com.docker.compose.config-hash)"
  container_revision="$(inspect_label "$container_id" org.opencontainers.image.revision)"
  container_project="$(inspect_label "$container_id" cz.zeleznalady.akl.compose-project)"
  container_service_label="$(inspect_label "$container_id" cz.zeleznalady.akl.service)"
  [[ "$compose_project" == "$PROJECT_NAME" ]] \
    || akl_fail "Container Compose project label mismatch: $service"
  [[ "$compose_service" == "$service" ]] \
    || akl_fail "Container Compose service label mismatch: $service"
  [[ "${compose_oneoff,,}" == "false" ]] \
    || akl_fail "Release container must not be a one-off container: $service"
  [[ "$compose_config_files" == "$COMPOSE_FILE" ]] \
    || akl_fail "Container Compose config-files label mismatch: $service"
  [[ "$container_revision" == "$TARGET_SHA" ]] \
    || akl_fail "Container revision label does not match the release SHA: $service"
  [[ "$container_project" == "$PROJECT_NAME" ]] \
    || akl_fail "Container immutable-release project label mismatch: $service"
  [[ "$container_service_label" == "$service" ]] \
    || akl_fail "Container immutable-release service label mismatch: $service"
  [[ "$compose_config_hash" =~ ^[0-9a-f]{64}$ ]] \
    || akl_fail "Container lacks a valid Compose config hash: $service"
}

verify_all_runtime_identities() {
  local running_services service
  akl_assert_expected_env_snapshot "$ENV_FILE"
  running_services="$("${COMPOSE[@]}" ps --status running --services)"
  for service in "${services[@]}"; do
    grep -Fxq "$service" <<<"$running_services" \
      || akl_fail "Release service is not running: $service"
    verify_runtime_identity "$service"
  done
}

verify_all_runtime_identities

verify_ingestion_readiness() {
  local container_ps_output container_id
  local -a container_ids=()
  akl_assert_expected_env_snapshot "$ENV_FILE"
  container_ps_output="$("${COMPOSE[@]}" ps -q ingestion-service)" \
    || akl_fail "Could not enumerate ingestion-service for authenticated readiness"
  if [[ -n "$container_ps_output" ]]; then
    mapfile -t container_ids <<<"$container_ps_output"
  fi
  [[ ${#container_ids[@]} -eq 1 && -n "${container_ids[0]}" ]] \
    || akl_fail "Authenticated ingestion readiness requires exactly one container"
  container_id="${container_ids[0]}"
  docker exec "$container_id" python -m app.readiness_probe \
    || akl_fail "Ingestion authenticated readiness probe failed"
}

verify_web_ingestion_transport_readiness() {
  local container_ps_output container_id
  local -a container_ids=()
  akl_assert_expected_env_snapshot "$ENV_FILE"
  container_ps_output="$("${COMPOSE[@]}" ps -q web)" \
    || akl_fail "Could not enumerate web for ingestion transport readiness"
  if [[ -n "$container_ps_output" ]]; then
    mapfile -t container_ids <<<"$container_ps_output"
  fi
  [[ ${#container_ids[@]} -eq 1 && -n "${container_ids[0]}" ]] \
    || akl_fail "Web ingestion transport readiness requires exactly one web container"
  container_id="${container_ids[0]}"
  docker exec --user nextjs -i "$container_id" node - <<'JS' \
    || akl_fail "Web ingestion transport readiness probe failed"
const fs = require("node:fs");

(async () => {
  const tokenUrl = process.env.AKL_WEB_INGESTION_TOKEN_URL || "";
  const clientId = process.env.AKL_WEB_INGESTION_CLIENT_ID || "";
  const secretFile = process.env.AKL_WEB_INGESTION_CLIENT_SECRET_FILE || "";
  const ingestionBaseUrl = process.env.AKL_INGESTION_API_BASE_URL || "";
  if (
    !tokenUrl.startsWith("https://")
    || clientId !== "svc-akb-web-ingestion"
    || !secretFile.startsWith("/")
    || !ingestionBaseUrl
  ) {
    throw new Error("web_ingestion_transport_configuration_invalid");
  }
  const clientSecret = fs.readFileSync(secretFile, "utf8").trim();
  if (!clientSecret) {
    throw new Error("web_ingestion_transport_secret_unavailable");
  }
  const tokenResponse = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!tokenResponse.ok) {
    throw new Error("web_ingestion_transport_token_exchange_failed");
  }
  const tokenPayload = await tokenResponse.json();
  const accessToken = tokenPayload && typeof tokenPayload.access_token === "string"
    ? tokenPayload.access_token
    : "";
  if (!accessToken) {
    throw new Error("web_ingestion_transport_token_missing");
  }
  const probeUrl = `${ingestionBaseUrl.replace(/\/$/, "")}/integrations/web-ingestion/readiness`;
  const requestId = `release-${Date.now().toString(36)}`;
  const probeResponse = await fetch(probeUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Request-ID": requestId,
      "X-Correlation-ID": requestId,
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!probeResponse.ok) {
    throw new Error("web_ingestion_transport_probe_denied");
  }
  const probe = await probeResponse.json();
  if (
    !probe
    || probe.status !== "ready"
    || probe.service !== "ingestion-service"
    || probe.client_id !== "svc-akb-web-ingestion"
    || probe.role !== "service_akb_web_ingestion"
  ) {
    throw new Error("web_ingestion_transport_probe_conflict");
  }
})().catch((error) => {
  const code = error instanceof Error ? error.message : "web_ingestion_transport_probe_failed";
  process.stderr.write(`${code}\n`);
  process.exit(1);
});
JS
}

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/akl-release-verify.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

curl_json() {
  local url="$1"
  local output_file="$2"
  curl --disable --noproxy '*' --fail --silent --show-error \
    --retry "$RETRY_ATTEMPTS" \
    --retry-delay "$RETRY_DELAY" \
    --retry-all-errors \
    --output "$output_file" \
    "$url"
}

curl_json_with_host() {
  local url="$1"
  local output_file="$2"
  local host="$3"
  curl --disable --noproxy '*' --fail --silent --show-error \
    --retry "$RETRY_ATTEMPTS" \
    --retry-delay "$RETRY_DELAY" \
    --retry-all-errors \
    --header "Host: ${host}" \
    --header "X-Forwarded-Proto: https" \
    --header "X-Forwarded-Host: ${host}" \
    --output "$output_file" \
    "$url"
}

validate_health() {
  local path="$1"
  python3 - "$path" "$TARGET_SHA" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    body = json.load(handle)
if body.get("status") != "ok" or body.get("version") != sys.argv[2]:
    raise SystemExit("health response does not identify the target release")
PY
}

validate_health_status() {
  local path="$1"
  python3 - "$path" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    body = json.load(handle)
if body.get("status") != "ok" or not body.get("version"):
    raise SystemExit("health response is not healthy or lacks a release version")
PY
}

validate_ready() {
  local path="$1"
  python3 - "$path" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    body = json.load(handle)
if body.get("status") != "ready":
    raise SystemExit("readiness response is not ready")
PY
}

local_base="http://127.0.0.1:${PROXY_PORT}"
for service in "${services[@]}"; do
  case "$service" in
    registry-api)
      health_url="${local_base}/registry/health"
      ready_url="${local_base}/registry/ready"
      ;;
    ingestion-service)
      health_url="${local_base}/ingestion/health"
      ready_url=""
      ;;
    rag-retrieval-service)
      health_url="${local_base}/rag/health"
      ready_url="${local_base}/rag/ready"
      ;;
    web)
      health_url="${local_base}/akb/api/health"
      ready_url="${local_base}/akb/api/ready"
      ;;
    chat-web)
      health_url="http://127.0.0.1:${CHAT_WEB_PORT}/api/health"
      ready_url="http://127.0.0.1:${CHAT_WEB_PORT}/api/ready"
      ;;
  esac
  if [[ "$service" == "chat-web" ]]; then
    chat_public_host="${CHAT_PUBLIC_BASE_URL#https://}"
    chat_public_host="${chat_public_host%%/*}"
    curl_json_with_host "$health_url" "${tmp_dir}/${service}-health.json" "$chat_public_host"
  else
    curl_json "$health_url" "${tmp_dir}/${service}-health.json"
  fi
  validate_health "${tmp_dir}/${service}-health.json"
  if [[ "$service" == "ingestion-service" ]]; then
    verify_ingestion_readiness
  elif [[ "$service" == "chat-web" ]]; then
    curl_json_with_host "$ready_url" "${tmp_dir}/${service}-ready.json" "$chat_public_host"
    validate_ready "${tmp_dir}/${service}-ready.json"
  else
    curl_json "$ready_url" "${tmp_dir}/${service}-ready.json"
    validate_ready "${tmp_dir}/${service}-ready.json"
  fi
done

if [[ "$WEB_AFFECTED" == "true" || "$INGESTION_AFFECTED" == "true" ]]; then
  verify_web_ingestion_transport_readiness
fi

curl_json "${PUBLIC_BASE_URL%/}/api/health" "${tmp_dir}/public-health.json"
if [[ "$WEB_AFFECTED" == "true" ]]; then
  validate_health "${tmp_dir}/public-health.json"
else
  validate_health_status "${tmp_dir}/public-health.json"
fi
curl_json "${PUBLIC_BASE_URL%/}/api/ready" "${tmp_dir}/public-ready.json"
validate_ready "${tmp_dir}/public-ready.json"

if [[ "$CHAT_WEB_AFFECTED" == "true" && "$VERIFY_CHAT_PUBLIC" == "true" ]]; then
  curl_json "${CHAT_PUBLIC_BASE_URL%/}/api/health" "${tmp_dir}/chat-public-health.json"
  validate_health "${tmp_dir}/chat-public-health.json"
  curl_json "${CHAT_PUBLIC_BASE_URL%/}/manifest.webmanifest" "${tmp_dir}/chat-manifest.json"
  python3 - "${tmp_dir}/chat-manifest.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    body = json.load(handle)
if body.get("name") != "AKB Chat" or body.get("scope") != "/" or body.get("start_url") != "/":
    raise SystemExit("chat PWA manifest is invalid")
PY
  blocked_status="$(
    curl --disable --noproxy '*' --silent --show-error \
      --output "${tmp_dir}/chat-blocked.json" \
      --write-out '%{http_code}' \
      "${CHAT_PUBLIC_BASE_URL%/}/api/documents"
  )"
  [[ "$blocked_status" == "403" ]] \
    || akl_fail "Chat-only API route guard returned HTTP ${blocked_status}, expected 403"
elif [[ "$CHAT_WEB_AFFECTED" == "true" ]]; then
  printf 'WARNING: standalone chat public verification was explicitly skipped; local health and readiness remain mandatory.\n' >&2
fi

smoke_slug="akl-release-smoke-${TARGET_SHA:0:12}"
smoke_status="$(
  curl --disable --noproxy '*' --silent --show-error \
    --retry "$RETRY_ATTEMPTS" \
    --retry-delay "$RETRY_DELAY" \
    --retry-all-errors \
    --dump-header "${tmp_dir}/public-missing.headers" \
    --output "${tmp_dir}/public-missing.json" \
    --write-out '%{http_code}' \
    "${PUBLIC_BASE_URL%/}/api/public/documents/${smoke_slug}"
)"
[[ "$smoke_status" == "404" ]] \
  || akl_fail "Public document fail-closed smoke returned HTTP ${smoke_status}, expected 404"
python3 - "${tmp_dir}/public-missing.headers" "${tmp_dir}/public-missing.json" <<'PY'
import json
import sys

headers = open(sys.argv[1], encoding="iso-8859-1").read().lower().splitlines()
with open(sys.argv[2], encoding="utf-8") as handle:
    body = json.load(handle)
if not any(line.startswith("content-type:") and "application/json" in line for line in headers):
    raise SystemExit("public fail-closed smoke did not return JSON")
if not any(line.startswith("cache-control:") and "no-store" in line for line in headers):
    raise SystemExit("public fail-closed smoke did not return Cache-Control: no-store")
if body != {
    "error": {
        "code": "PUBLIC_DOCUMENT_UNAVAILABLE",
        "message": "The public document is unavailable.",
    }
}:
    raise SystemExit("public fail-closed smoke returned an unexpected problem body")
PY

verify_all_runtime_identities
printf 'Release verification passed for %s (%s).\n' "$TARGET_SHA" "$SERVICE_CSV"
