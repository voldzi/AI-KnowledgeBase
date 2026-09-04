#!/usr/bin/env bash
set +x
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MODEL_ROOT="${AKL_DOCLING_MODEL_ROOT:-/srv/akl/models}"
PROFILE="standard-cpu-v1"

usage() {
  printf 'Usage: %s --sha <full-git-sha>\n' "$0" >&2
  exit 2
}

TARGET_SHA=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sha)
      [[ $# -ge 2 ]] || usage
      TARGET_SHA="$2"
      shift 2
      ;;
    *) usage ;;
  esac
done
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || usage
[[ "$(git -C "$ROOT" rev-parse HEAD)" == "$TARGET_SHA" ]] \
  || { printf 'The Docling provisioner must run from the exact source SHA.\n' >&2; exit 2; }
[[ "$MODEL_ROOT" == /* && "$MODEL_ROOT" != *$'\n'* && "$MODEL_ROOT" != *$'\r'* ]] \
  || { printf 'The Docling model root is invalid.\n' >&2; exit 2; }

for command_name in docker git python3 sha256sum mktemp; do
  command -v "$command_name" >/dev/null \
    || { printf 'Required command is unavailable: %s\n' "$command_name" >&2; exit 2; }
done

mkdir -p "$MODEL_ROOT"
[[ -d "$MODEL_ROOT" && ! -L "$MODEL_ROOT" ]] \
  || { printf 'The Docling model root must be a real directory.\n' >&2; exit 2; }

LOCK_DIR="${MODEL_ROOT}/.provision.lock"
mkdir "$LOCK_DIR" 2>/dev/null \
  || { printf 'Another Docling model provisioning operation is active.\n' >&2; exit 2; }
STAGE_DIR=""
cleanup() {
  local status=$?
  if [[ -n "$STAGE_DIR" && -d "$STAGE_DIR" ]]; then
    rm -rf -- "$STAGE_DIR"
  fi
  rmdir "$LOCK_DIR" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT

STAGE_DIR="$(mktemp -d "${MODEL_ROOT}/.docling-standard-stage.XXXXXX")"
[[ "$STAGE_DIR" == "${MODEL_ROOT}/.docling-standard-stage."* ]] \
  || { printf 'The Docling staging directory escaped its root.\n' >&2; exit 2; }
TEMP_IMAGE="akl/ingestion-docling-provision:${TARGET_SHA}"

DOCKER_BUILDKIT=1 docker build \
  --pull=false \
  --build-arg AKL_INSTALL_DOCLING=true \
  --label "org.opencontainers.image.revision=${TARGET_SHA}" \
  --label 'cz.zeleznalady.akl.purpose=docling-model-provision' \
  --tag "$TEMP_IMAGE" \
  --file "${ROOT}/services/ingestion-service/Dockerfile" \
  "${ROOT}/services/ingestion-service"

result_json="$(
  docker run --rm \
    --pull never \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --pids-limit 256 \
    --memory 2g \
    --tmpfs /tmp:rw,noexec,nosuid,size=536870912 \
    --env HF_HUB_DISABLE_TELEMETRY=1 \
    --env DO_NOT_TRACK=1 \
    --volume "${STAGE_DIR}:/model-output" \
    "$TEMP_IMAGE" \
    python -m docling_models.provision \
      --output "/model-output/${PROFILE}"
)"

IFS='|' read -r artifacts_sha256 source_manifest_sha256 <<<"$(
  python3 - "$result_json" <<'PY'
import json
import re
import sys

value = json.loads(sys.argv[1])
if set(value) != {
    "schema",
    "status",
    "profile",
    "artifacts_sha256",
    "source_manifest_sha256",
}:
    raise SystemExit("Docling provision result is not closed")
if (
    value.get("schema") != "akb-docling-model-provision-result-1"
    or value.get("status") != "passed"
    or value.get("profile") != "standard-cpu-v1"
    or not re.fullmatch(r"sha256:[0-9a-f]{64}", value.get("artifacts_sha256", ""))
    or not re.fullmatch(r"sha256:[0-9a-f]{64}", value.get("source_manifest_sha256", ""))
):
    raise SystemExit("Docling provision result is invalid")
print(f'{value["artifacts_sha256"]}|{value["source_manifest_sha256"]}')
PY
)"

bundle_dir="${STAGE_DIR}/${PROFILE}"
digest_suffix="${artifacts_sha256#sha256:}"
final_dir="${MODEL_ROOT}/docling-standard-${digest_suffix:0:16}"
if [[ -e "$final_dir" || -L "$final_dir" ]]; then
  printf 'The immutable Docling model destination already exists; refusing replacement.\n' >&2
  exit 2
fi
mv "$bundle_dir" "$final_dir"
STAGE_DIR=""
rmdir "$(dirname "$bundle_dir")"
trap - EXIT
rmdir "$LOCK_DIR"

python3 - "$TARGET_SHA" "$final_dir" "$artifacts_sha256" "$source_manifest_sha256" <<'PY'
import json
import sys

print(json.dumps({
    "schema": "akb-docling-model-activation-candidate-1",
    "source_commit": sys.argv[1],
    "profile": "standard-cpu-v1",
    "artifacts_path": sys.argv[2],
    "artifacts_sha256": sys.argv[3],
    "source_manifest_sha256": sys.argv[4],
}, sort_keys=True, separators=(",", ":")))
PY
