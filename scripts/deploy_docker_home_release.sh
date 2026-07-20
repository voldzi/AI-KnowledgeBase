#!/usr/bin/env bash
set +x
set -Eeuo pipefail
AKL_IMMUTABLE_ORCHESTRATOR_CONTRACT=2

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/immutable_release_common.sh
source "${SCRIPT_DIR}/lib/immutable_release_common.sh"

usage() {
  printf 'Usage: %s --sha <full-git-sha> [--transition-existing-current]\n' "$0" >&2
  exit 2
}

TARGET_SHA=""
TRANSITION_EXISTING_CURRENT="false"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sha)
      [[ $# -ge 2 ]] || usage
      TARGET_SHA="$2"
      shift 2
      ;;
    --transition-existing-current)
      TRANSITION_EXISTING_CURRENT="true"
      shift
      ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done
[[ -n "$TARGET_SHA" ]] || usage
akl_validate_full_sha "$TARGET_SHA"

RELEASE_ROOT="${AKL_RELEASE_ROOT:-/srv/akl}"
ENV_SOURCE_FILE="${AKL_PROD_ENV_FILE:-${RELEASE_ROOT}/env/akl.prod.env}"
ENV_FILE="$ENV_SOURCE_FILE"
DEPLOYMENTS_DIR="${RELEASE_ROOT}/deployments"
GIT_DIR="${AKL_RELEASE_GIT_DIR:-${RELEASE_ROOT}/git/AI-KnowledgeBase.git}"
TARGET_RELEASE="${RELEASE_ROOT}/releases/${TARGET_SHA}"
MIGRATION_STARTED="false"
CURRENT_ADVANCED="false"
RUNTIME_MARKED="false"
RUNTIME_PHASE="not-applied"
RUNTIME_MARKER_SHA="none"
RUNTIME_MARKER_STATE="none"
RUNTIME_MARKER_DEPLOYMENT_ID="none"
RECOVERY_REQUIRED="false"
REGISTRY_QUIESCED="false"
REGISTRY_STOP_MAY_HAVE_STARTED="false"
SAFE_TO_RESTORE_REGISTRY="false"
OLD_REGISTRY_CONTAINER_ID=""
OLD_REGISTRY_IMAGE_ID=""
OLD_REGISTRY_IMAGE_REF=""
OLD_REGISTRY_CONFIG_HASH=""
OLD_REGISTRY_CONFIG_FILES=""
OLD_REGISTRY_LABELS_VERIFIED="false"
OLD_REGISTRY_WAS_RUNNING="false"
OLD_REGISTRY_WAS_RESTARTING="false"
BACKUP_DIR="none"
SERVICE_CSV=""
CURRENT_SHA_AT_START="none"
POSTGRES_TOOL_IMAGE_REF="not-required"
POSTGRES_TOOL_IMAGE_ID="not-required"
POSTGRES_TOOL_PSQL_VERSION="not-required"
POSTGRES_TOOL_PG_DUMP_VERSION="not-required"
POSTGRES_TOOL_PG_RESTORE_VERSION="not-required"
WRITABLE_PRIMARY_PRE_STOP_CHECKED="false"
WRITABLE_PRIMARY_PRE_QUIESCE_CHECKED="false"
WRITABLE_PRIMARY_PRE_MIGRATION_CHECKED="false"
TARGET_BUILD_MAY_HAVE_STARTED="false"
RETRY_REQUIRES_DESCENDANT_SHA="false"
TARGET_REGISTRY_IMAGE_ID="not-affected"
TARGET_INGESTION_IMAGE_ID="not-affected"
TARGET_RAG_IMAGE_ID="not-affected"
TARGET_WEB_IMAGE_ID="not-affected"
TARGET_CHAT_WEB_IMAGE_ID="not-affected"
TARGET_SERVICES_START_MAY_HAVE_STARTED="false"
TARGET_REGISTRY_QUARANTINED="false"
TARGET_REGISTRY_QUARANTINE_FAILED="false"
TARGET_INGESTION_QUARANTINED="false"
TARGET_INGESTION_QUARANTINE_FAILED="false"
TARGET_RAG_QUARANTINED="false"
TARGET_RAG_QUARANTINE_FAILED="false"
TARGET_WEB_QUARANTINED="false"
TARGET_WEB_QUARANTINE_FAILED="false"
TARGET_CHAT_WEB_QUARANTINED="false"
TARGET_CHAT_WEB_QUARANTINE_FAILED="false"
PRESERVE_DEPLOY_LOCK="false"
ENV_SNAPSHOT_DIR=""
ENV_SNAPSHOT_PATH=""
ENV_SNAPSHOT_ROOT="${RELEASE_ROOT}/env"
ENV_SNAPSHOT_ROOT_DEVICE=""
ENV_SNAPSHOT_ROOT_INODE=""
ENV_SNAPSHOT_DIR_DEVICE=""
ENV_SNAPSHOT_DIR_INODE=""
ENV_SNAPSHOT_DEVICE=""
ENV_SNAPSHOT_INODE=""
ENV_SNAPSHOT_SIZE=""
ENV_SNAPSHOT_SHA256=""

akl_require_private_env_file "$ENV_SOURCE_FILE"
for command_name in docker git python3 curl id mktemp sha256sum tar; do
  akl_require_command "$command_name"
done
akl_assert_hermetic_git_environment
akl_assert_local_docker_daemon_environment
if grep -E 'replace-with|<user>|<password>|long-random|prod-password' "$ENV_SOURCE_FILE" >/dev/null; then
  akl_fail "Production env file still contains placeholder values"
fi
akl_assert_no_ambient_env_file_overrides "$ENV_SOURCE_FILE"
if [[ "$TRANSITION_EXISTING_CURRENT" == "true" ]]; then
  [[ "$AKL_IMMUTABLE_ORCHESTRATOR_CONTRACT" == "2" ]] \
    || akl_fail "Existing-current transition requires hardened orchestrator contract 2"
  [[ "$SCRIPT_DIR" == "${TARGET_RELEASE}/scripts" ]] \
    || akl_fail "Existing-current transition deploy must run from the exact target release"
  transition_preflight_mode="$(
    akl_assert_existing_current_transition_state \
      "$RELEASE_ROOT" \
      "$ENV_SOURCE_FILE" \
      "$ENV_SOURCE_FILE" \
      "$GIT_DIR" \
      "$TARGET_SHA" \
      preflight
  )"
  printf 'Target orchestrator transition preflight passed (%s).\n' \
    "$transition_preflight_mode" >&2
fi
DEPLOYMENT_ID="$(date -u +%Y%m%dT%H%M%SZ)-${TARGET_SHA}-$$"
DEPLOYMENT_RECORD="${DEPLOYMENTS_DIR}/${DEPLOYMENT_ID}.txt"

cleanup_env_snapshot() {
  local cleanup_status=0
  if [[ -n "$ENV_SNAPSHOT_PATH" && -n "${AKL_RELEASE_ENV_SNAPSHOT_PATH:-}" ]]; then
    if ! akl_cleanup_expected_env_snapshot "$ENV_SNAPSHOT_PATH"; then
      printf 'CRITICAL: Env snapshot identity changed or cleanup failed; preserving remaining state for operator review.\n' >&2
      return 1
    fi
    ENV_SNAPSHOT_PATH=""
    ENV_SNAPSHOT_DIR=""
  elif [[ -n "$ENV_SNAPSHOT_DIR" && ( -e "$ENV_SNAPSHOT_DIR" || -L "$ENV_SNAPSHOT_DIR" ) ]]; then
    if ! akl_cleanup_stale_private_env_snapshot "$ENV_SNAPSHOT_ROOT" "$ENV_SNAPSHOT_DIR"; then
      printf 'CRITICAL: Incomplete env snapshot directory could not be safely removed.\n' >&2
      cleanup_status=1
    else
      ENV_SNAPSHOT_DIR=""
      ENV_SNAPSHOT_PATH=""
    fi
  fi
  return "$cleanup_status"
}

early_setup_exit() {
  local status=$?
  trap - EXIT
  if ! cleanup_env_snapshot; then
    printf 'CRITICAL: Could not securely remove the private env snapshot during setup.\n' >&2
    status=1
  fi
  exit "$status"
}
trap early_setup_exit EXIT

umask 077
akl_assert_private_env_snapshot_root "$ENV_SNAPSHOT_ROOT"
akl_assert_no_stale_private_env_snapshots "$ENV_SNAPSHOT_ROOT"
ENV_SNAPSHOT_DIR="$(mktemp -d "${ENV_SNAPSHOT_ROOT}/.akl-release-env.${TARGET_SHA}.XXXXXX")"
ENV_SNAPSHOT_PATH="${ENV_SNAPSHOT_DIR}/akl.prod.env"
akl_create_private_env_snapshot "$ENV_SOURCE_FILE" "$ENV_SNAPSHOT_PATH"
IFS=':' read -r \
  ENV_SNAPSHOT_ROOT_DEVICE \
  ENV_SNAPSHOT_ROOT_INODE \
  ENV_SNAPSHOT_DIR_DEVICE \
  ENV_SNAPSHOT_DIR_INODE \
  ENV_SNAPSHOT_DEVICE \
  ENV_SNAPSHOT_INODE \
  ENV_SNAPSHOT_SIZE \
  ENV_SNAPSHOT_SHA256 \
  <<<"$(akl_env_snapshot_identity "$ENV_SNAPSHOT_PATH")"
export AKL_RELEASE_ENV_SNAPSHOT_ROOT="$ENV_SNAPSHOT_ROOT"
export AKL_RELEASE_ENV_SNAPSHOT_ROOT_DEVICE="$ENV_SNAPSHOT_ROOT_DEVICE"
export AKL_RELEASE_ENV_SNAPSHOT_ROOT_INODE="$ENV_SNAPSHOT_ROOT_INODE"
export AKL_RELEASE_ENV_SNAPSHOT_DIR="$ENV_SNAPSHOT_DIR"
export AKL_RELEASE_ENV_SNAPSHOT_DIR_DEVICE="$ENV_SNAPSHOT_DIR_DEVICE"
export AKL_RELEASE_ENV_SNAPSHOT_DIR_INODE="$ENV_SNAPSHOT_DIR_INODE"
export AKL_RELEASE_ENV_SNAPSHOT_PATH="$ENV_SNAPSHOT_PATH"
export AKL_RELEASE_ENV_SNAPSHOT_DEVICE="$ENV_SNAPSHOT_DEVICE"
export AKL_RELEASE_ENV_SNAPSHOT_INODE="$ENV_SNAPSHOT_INODE"
export AKL_RELEASE_ENV_SNAPSHOT_SIZE="$ENV_SNAPSHOT_SIZE"
export AKL_RELEASE_ENV_SNAPSHOT_SHA256="$ENV_SNAPSHOT_SHA256"
ENV_FILE="$ENV_SNAPSHOT_PATH"
export AKL_PROD_ENV_FILE="$ENV_FILE"
akl_require_private_env_file "$ENV_FILE"
akl_assert_expected_env_snapshot "$ENV_FILE"
if grep -E 'replace-with|<user>|<password>|long-random|prod-password' "$ENV_FILE" >/dev/null; then
  akl_fail "Private production env snapshot contains placeholder values"
fi
akl_assert_no_ambient_env_file_overrides "$ENV_FILE"
PROJECT_NAME="$(akl_env_value "$ENV_FILE" AKL_RELEASE_COMPOSE_PROJECT akl)"
TRUSTED_REF="$(akl_env_value "$ENV_FILE" AKL_RELEASE_TRUSTED_REF refs/remotes/origin/main)"
REGISTRY_STOP_TIMEOUT="$(akl_env_value "$ENV_FILE" AKL_RELEASE_REGISTRY_STOP_TIMEOUT_SECONDS 30)"
INGESTION_AUTHORIZATION_SECRET_FILE="$(
  akl_env_value \
    "$ENV_FILE" \
    AKL_INGESTION_AUTHORIZATION_SECRET_FILE \
    "${RELEASE_ROOT}/env/ingestion-authorization.secret"
)"
INGESTION_REGISTRY_CLIENT_SECRET_FILE="$(
  akl_env_value \
    "$ENV_FILE" \
    AKL_INGESTION_REGISTRY_CLIENT_SECRET_FILE \
    "${RELEASE_ROOT}/env/svc-ingestion.client-secret"
)"
RAG_REGISTRY_CLIENT_SECRET_FILE="$(
  akl_env_value \
    "$ENV_FILE" \
    AKL_RAG_REGISTRY_CLIENT_SECRET_FILE \
    "${RELEASE_ROOT}/env/akb-rag-service.client-secret"
)"
WEB_INGESTION_CLIENT_SECRET_FILE="$(
  akl_env_value \
    "$ENV_FILE" \
    AKL_WEB_INGESTION_CLIENT_SECRET_FILE \
    "${RELEASE_ROOT}/env/svc-akb-web-ingestion.client-secret"
)"
akl_validate_project_name "$PROJECT_NAME"
[[ "$TRUSTED_REF" == refs/remotes/origin/* ]] \
  || akl_fail "Trusted release ref must be an origin remote-tracking ref"
git --no-replace-objects check-ref-format "$TRUSTED_REF" >/dev/null 2>&1 \
  || akl_fail "Trusted release ref is not a valid Git ref"
[[ "$REGISTRY_STOP_TIMEOUT" =~ ^[1-9][0-9]*$ && "$REGISTRY_STOP_TIMEOUT" -le 300 ]] \
  || akl_fail "AKL_RELEASE_REGISTRY_STOP_TIMEOUT_SECONDS must be between 1 and 300"

if [[ "$TRANSITION_EXISTING_CURRENT" == "true" ]]; then
  for transition_directory in \
    "$RELEASE_ROOT" \
    "${RELEASE_ROOT}/env" \
    "${RELEASE_ROOT}/backups" \
    "${RELEASE_ROOT}/releases" \
    "$DEPLOYMENTS_DIR"; do
    [[ -d "$transition_directory" && ! -L "$transition_directory" ]] \
      || akl_fail "Existing-current transition requires a real pre-existing directory: $transition_directory"
  done
else
  mkdir -p "$RELEASE_ROOT" "${RELEASE_ROOT}/env" "${RELEASE_ROOT}/backups" \
    "${RELEASE_ROOT}/releases" "$DEPLOYMENTS_DIR"
fi
akl_fsync_directory "$RELEASE_ROOT"
akl_acquire_deploy_lock "$RELEASE_ROOT"

write_deployment_record() {
  local status="$1"
  local record_tmp
  record_tmp="$(mktemp "${DEPLOYMENT_RECORD}.tmp.XXXXXX")"
  {
    printf 'deployment_id=%s\n' "$DEPLOYMENT_ID"
    printf 'status=%s\n' "$status"
    printf 'target_sha=%s\n' "$TARGET_SHA"
    printf 'services=%s\n' "${SERVICE_CSV:-undetermined}"
    printf 'backup_dir=%s\n' "$BACKUP_DIR"
    printf 'migration_started=%s\n' "$MIGRATION_STARTED"
    printf 'runtime_marker_sha=%s\n' "$RUNTIME_MARKER_SHA"
    printf 'runtime_marker_state=%s\n' "$RUNTIME_MARKER_STATE"
    printf 'runtime_phase=%s\n' "$RUNTIME_PHASE"
    printf 'recovery_required=%s\n' "$RECOVERY_REQUIRED"
    printf 'current_sha_at_start=%s\n' "$CURRENT_SHA_AT_START"
    printf 'current_advanced=%s\n' "$CURRENT_ADVANCED"
    printf 'registry_stop_may_have_started=%s\n' "$REGISTRY_STOP_MAY_HAVE_STARTED"
    printf 'registry_quiesced=%s\n' "$REGISTRY_QUIESCED"
    printf 'old_registry_container_id=%s\n' "${OLD_REGISTRY_CONTAINER_ID:-none}"
    printf 'old_registry_image_id=%s\n' "${OLD_REGISTRY_IMAGE_ID:-none}"
    printf 'old_registry_image_ref=%s\n' "${OLD_REGISTRY_IMAGE_REF:-none}"
    printf 'old_registry_config_hash=%s\n' "${OLD_REGISTRY_CONFIG_HASH:-none}"
    printf 'old_registry_config_files=%s\n' "${OLD_REGISTRY_CONFIG_FILES:-none}"
    printf 'old_registry_labels_verified=%s\n' "$OLD_REGISTRY_LABELS_VERIFIED"
    printf 'old_registry_was_running=%s\n' "$OLD_REGISTRY_WAS_RUNNING"
    printf 'old_registry_was_restarting=%s\n' "$OLD_REGISTRY_WAS_RESTARTING"
    printf 'postgres_tool_image_ref=%s\n' "$POSTGRES_TOOL_IMAGE_REF"
    printf 'postgres_tool_image_id=%s\n' "$POSTGRES_TOOL_IMAGE_ID"
    printf 'postgres_tool_psql_version=%s\n' "$POSTGRES_TOOL_PSQL_VERSION"
    printf 'postgres_tool_pg_dump_version=%s\n' "$POSTGRES_TOOL_PG_DUMP_VERSION"
    printf 'postgres_tool_pg_restore_version=%s\n' "$POSTGRES_TOOL_PG_RESTORE_VERSION"
    printf 'writable_primary_pre_stop_checked=%s\n' "$WRITABLE_PRIMARY_PRE_STOP_CHECKED"
    printf 'writable_primary_pre_quiesce_checked=%s\n' "$WRITABLE_PRIMARY_PRE_QUIESCE_CHECKED"
    printf 'writable_primary_pre_migration_checked=%s\n' "$WRITABLE_PRIMARY_PRE_MIGRATION_CHECKED"
    printf 'target_build_may_have_started=%s\n' "$TARGET_BUILD_MAY_HAVE_STARTED"
    printf 'target_registry_image_id=%s\n' "$TARGET_REGISTRY_IMAGE_ID"
    printf 'target_ingestion_image_id=%s\n' "$TARGET_INGESTION_IMAGE_ID"
    printf 'target_rag_image_id=%s\n' "$TARGET_RAG_IMAGE_ID"
    printf 'target_web_image_id=%s\n' "$TARGET_WEB_IMAGE_ID"
    printf 'target_chat_web_image_id=%s\n' "$TARGET_CHAT_WEB_IMAGE_ID"
    printf 'target_services_start_may_have_started=%s\n' "$TARGET_SERVICES_START_MAY_HAVE_STARTED"
    printf 'target_registry_quarantined=%s\n' "$TARGET_REGISTRY_QUARANTINED"
    printf 'target_registry_quarantine_failed=%s\n' "$TARGET_REGISTRY_QUARANTINE_FAILED"
    printf 'target_ingestion_quarantined=%s\n' "$TARGET_INGESTION_QUARANTINED"
    printf 'target_ingestion_quarantine_failed=%s\n' "$TARGET_INGESTION_QUARANTINE_FAILED"
    printf 'target_rag_quarantined=%s\n' "$TARGET_RAG_QUARANTINED"
    printf 'target_rag_quarantine_failed=%s\n' "$TARGET_RAG_QUARANTINE_FAILED"
    printf 'target_web_quarantined=%s\n' "$TARGET_WEB_QUARANTINED"
    printf 'target_web_quarantine_failed=%s\n' "$TARGET_WEB_QUARANTINE_FAILED"
    printf 'target_chat_web_quarantined=%s\n' "$TARGET_CHAT_WEB_QUARANTINED"
    printf 'target_chat_web_quarantine_failed=%s\n' "$TARGET_CHAT_WEB_QUARANTINE_FAILED"
    printf 'deploy_lock_preserved=%s\n' "$PRESERVE_DEPLOY_LOCK"
    printf 'retry_requires_descendant_sha=%s\n' "$RETRY_REQUIRES_DESCENDANT_SHA"
    printf 'recorded_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >"$record_tmp"
  akl_publish_durable_file "$record_tmp" "$DEPLOYMENT_RECORD" 0600
}

load_reconciliation_image_ids() {
  local marker_deployment_id="$1"
  local marker_services="$2"
  local record_path="${DEPLOYMENTS_DIR}/${marker_deployment_id}.txt"
  python3 - \
    "$DEPLOYMENTS_DIR" \
    "$record_path" \
    "$marker_deployment_id" \
    "$TARGET_SHA" \
    "$marker_services" <<'PY'
import re
import stat
import sys
from pathlib import Path

deployments_dir = Path(sys.argv[1])
record = Path(sys.argv[2])
deployment_id = sys.argv[3]
target_sha = sys.argv[4]
services = sys.argv[5]
if not re.fullmatch(
    rf"[0-9]{{8}}T[0-9]{{6}}Z-{re.escape(target_sha)}-[0-9]+",
    deployment_id,
):
    raise SystemExit("verified runtime marker deployment id is invalid")
directory_stat = deployments_dir.lstat()
if deployments_dir.is_symlink() or not stat.S_ISDIR(directory_stat.st_mode):
    raise SystemExit("deployment record directory must be a real directory")
if stat.S_IMODE(directory_stat.st_mode) & 0o077:
    raise SystemExit("deployment record directory must be private")
record_stat = record.lstat()
if record.is_symlink() or not stat.S_ISREG(record_stat.st_mode) or record_stat.st_nlink != 1:
    raise SystemExit("verified deployment record must be a single-link regular file")
if stat.S_IMODE(record_stat.st_mode) != 0o600:
    raise SystemExit("verified deployment record must have mode 0600")
content = record.read_bytes()
if not content.endswith(b"\n") or b"\r" in content or b"\0" in content:
    raise SystemExit("verified deployment record encoding is invalid")
try:
    lines = content.decode("utf-8").splitlines()
except UnicodeDecodeError as exc:
    raise SystemExit("verified deployment record encoding is invalid") from exc
expected_keys = [
    "deployment_id",
    "status",
    "target_sha",
    "services",
    "backup_dir",
    "migration_started",
    "runtime_marker_sha",
    "runtime_marker_state",
    "runtime_phase",
    "recovery_required",
    "current_sha_at_start",
    "current_advanced",
    "registry_stop_may_have_started",
    "registry_quiesced",
    "old_registry_container_id",
    "old_registry_image_id",
    "old_registry_image_ref",
    "old_registry_config_hash",
    "old_registry_config_files",
    "old_registry_labels_verified",
    "old_registry_was_running",
    "old_registry_was_restarting",
    "postgres_tool_image_ref",
    "postgres_tool_image_id",
    "postgres_tool_psql_version",
    "postgres_tool_pg_dump_version",
    "postgres_tool_pg_restore_version",
    "writable_primary_pre_stop_checked",
    "writable_primary_pre_quiesce_checked",
    "writable_primary_pre_migration_checked",
    "target_build_may_have_started",
    "target_registry_image_id",
    "target_ingestion_image_id",
    "target_rag_image_id",
    "target_web_image_id",
    "target_chat_web_image_id",
    "target_services_start_may_have_started",
    "target_registry_quarantined",
    "target_registry_quarantine_failed",
    "target_ingestion_quarantined",
    "target_ingestion_quarantine_failed",
    "target_rag_quarantined",
    "target_rag_quarantine_failed",
    "target_web_quarantined",
    "target_web_quarantine_failed",
    "target_chat_web_quarantined",
    "target_chat_web_quarantine_failed",
    "deploy_lock_preserved",
    "retry_requires_descendant_sha",
    "recorded_utc",
]
if len(lines) != len(expected_keys):
    raise SystemExit("verified deployment record schema is invalid")
values: dict[str, str] = {}
for expected_key, line in zip(expected_keys, lines, strict=True):
    if "=" not in line:
        raise SystemExit("verified deployment record contains a malformed field")
    key, value = line.split("=", 1)
    if key != expected_key or key in values or not value:
        raise SystemExit("verified deployment record keys are invalid")
    values[key] = value
if values["deployment_id"] != deployment_id:
    raise SystemExit("verified deployment record id does not match the runtime marker")
if values["target_sha"] != target_sha or values["services"] != services:
    raise SystemExit("verified deployment record target does not match the runtime marker")
if values["status"] not in {
    "activation_pending",
    "activating_current",
    "succeeded",
    "activated_recording_failed",
}:
    raise SystemExit("verified deployment record is not at an activation boundary")
selected_services = services.split(",")
if not selected_services or len(selected_services) != len(set(selected_services)):
    raise SystemExit("verified deployment record service set is invalid")
image_fields = {
    "registry-api": "target_registry_image_id",
    "ingestion-service": "target_ingestion_image_id",
    "rag-retrieval-service": "target_rag_image_id",
    "web": "target_web_image_id",
    "chat-web": "target_chat_web_image_id",
}
if any(service not in image_fields for service in selected_services):
    raise SystemExit("verified deployment record contains an unsupported service")
for service, field in image_fields.items():
    image_id = values[field]
    if service in selected_services:
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
            raise SystemExit("verified deployment record contains an invalid target image id")
    elif image_id != "not-affected":
        raise SystemExit("verified deployment record assigns an image id to an unaffected service")
for field in {
    "target_services_start_may_have_started",
    "target_registry_quarantined",
    "target_registry_quarantine_failed",
    "target_ingestion_quarantined",
    "target_ingestion_quarantine_failed",
    "target_rag_quarantined",
    "target_rag_quarantine_failed",
    "target_web_quarantined",
    "target_web_quarantine_failed",
    "target_chat_web_quarantined",
    "target_chat_web_quarantine_failed",
    "deploy_lock_preserved",
}:
    if values[field] not in {"true", "false"}:
        raise SystemExit("verified deployment record contains an invalid boolean field")
print(
    "|".join(
        [
            values["target_registry_image_id"],
            values["target_ingestion_image_id"],
            values["target_rag_image_id"],
            values["target_web_image_id"],
            values["target_chat_web_image_id"],
        ]
    )
)
PY
}

expected_image_for_service() {
  case "$1" in
    registry-api) printf '%s\n' "$REGISTRY_API_IMAGE" ;;
    ingestion-service) printf '%s\n' "$INGESTION_SERVICE_IMAGE" ;;
    rag-retrieval-service) printf '%s\n' "$RAG_RETRIEVAL_SERVICE_IMAGE" ;;
    web) printf '%s\n' "$WEB_IMAGE" ;;
    chat-web) printf '%s\n' "$CHAT_WEB_IMAGE" ;;
    *) akl_fail "Unsupported immutable image service: $1" ;;
  esac
}

verify_target_image_identity() {
  local service="$1"
  local phase="$2"
  local target_image image_id repo_tags_json image_revision image_project image_service
  akl_assert_expected_env_snapshot "$ENV_FILE"
  target_image="$(expected_image_for_service "$service")"
  image_id="$(
    env \
      "AKL_RELEASE_IMAGE_VERIFY_PHASE=${phase}" \
      "AKL_SERVICE_VERSION=${AKL_SERVICE_VERSION}" \
      "REGISTRY_API_IMAGE=${REGISTRY_API_IMAGE}" \
      "INGESTION_SERVICE_IMAGE=${INGESTION_SERVICE_IMAGE}" \
      "RAG_RETRIEVAL_SERVICE_IMAGE=${RAG_RETRIEVAL_SERVICE_IMAGE}" \
      "WEB_IMAGE=${WEB_IMAGE}" \
      "CHAT_WEB_IMAGE=${CHAT_WEB_IMAGE}" \
      docker image inspect --format '{{.Id}}' "$target_image"
  )" || akl_fail "Immutable target image tag is missing during ${phase}: $target_image"
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || akl_fail "Immutable target image returned an invalid content ID during ${phase}: $target_image"
  repo_tags_json="$(
    env \
      "AKL_RELEASE_IMAGE_VERIFY_PHASE=${phase}" \
      "AKL_SERVICE_VERSION=${AKL_SERVICE_VERSION}" \
      "REGISTRY_API_IMAGE=${REGISTRY_API_IMAGE}" \
      "INGESTION_SERVICE_IMAGE=${INGESTION_SERVICE_IMAGE}" \
      "RAG_RETRIEVAL_SERVICE_IMAGE=${RAG_RETRIEVAL_SERVICE_IMAGE}" \
      "WEB_IMAGE=${WEB_IMAGE}" \
      "CHAT_WEB_IMAGE=${CHAT_WEB_IMAGE}" \
      docker image inspect --format '{{json .RepoTags}}' "$target_image"
  )" || akl_fail "Could not inspect immutable target image tags during ${phase}: $target_image"
  python3 - "$repo_tags_json" "$target_image" <<'PY' \
    || akl_fail "Immutable target image lost its exact release tag during $phase: $target_image"
import json
import sys

tags = json.loads(sys.argv[1])
if not isinstance(tags, list) or sys.argv[2] not in tags:
    raise SystemExit("target image does not retain the exact immutable tag")
PY
  image_revision="$(
    env \
      "AKL_RELEASE_IMAGE_VERIFY_PHASE=${phase}" \
      "AKL_SERVICE_VERSION=${AKL_SERVICE_VERSION}" \
      "REGISTRY_API_IMAGE=${REGISTRY_API_IMAGE}" \
      "INGESTION_SERVICE_IMAGE=${INGESTION_SERVICE_IMAGE}" \
      "RAG_RETRIEVAL_SERVICE_IMAGE=${RAG_RETRIEVAL_SERVICE_IMAGE}" \
      "WEB_IMAGE=${WEB_IMAGE}" \
      "CHAT_WEB_IMAGE=${CHAT_WEB_IMAGE}" \
      docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$target_image"
  )" || akl_fail "Could not inspect target image revision label during ${phase}: $target_image"
  image_project="$(
    env \
      "AKL_RELEASE_IMAGE_VERIFY_PHASE=${phase}" \
      "AKL_SERVICE_VERSION=${AKL_SERVICE_VERSION}" \
      "REGISTRY_API_IMAGE=${REGISTRY_API_IMAGE}" \
      "INGESTION_SERVICE_IMAGE=${INGESTION_SERVICE_IMAGE}" \
      "RAG_RETRIEVAL_SERVICE_IMAGE=${RAG_RETRIEVAL_SERVICE_IMAGE}" \
      "WEB_IMAGE=${WEB_IMAGE}" \
      "CHAT_WEB_IMAGE=${CHAT_WEB_IMAGE}" \
      docker image inspect --format '{{index .Config.Labels "cz.zeleznalady.akl.compose-project"}}' "$target_image"
  )" || akl_fail "Could not inspect target image project label during ${phase}: $target_image"
  image_service="$(
    env \
      "AKL_RELEASE_IMAGE_VERIFY_PHASE=${phase}" \
      "AKL_SERVICE_VERSION=${AKL_SERVICE_VERSION}" \
      "REGISTRY_API_IMAGE=${REGISTRY_API_IMAGE}" \
      "INGESTION_SERVICE_IMAGE=${INGESTION_SERVICE_IMAGE}" \
      "RAG_RETRIEVAL_SERVICE_IMAGE=${RAG_RETRIEVAL_SERVICE_IMAGE}" \
      "WEB_IMAGE=${WEB_IMAGE}" \
      "CHAT_WEB_IMAGE=${CHAT_WEB_IMAGE}" \
      docker image inspect --format '{{index .Config.Labels "cz.zeleznalady.akl.service"}}' "$target_image"
  )" || akl_fail "Could not inspect target image service label during ${phase}: $target_image"
  [[ "$image_revision" == "$TARGET_SHA" \
    && "$image_project" == "$PROJECT_NAME" \
    && "$image_service" == "$service" ]] \
    || akl_fail "Immutable target image provenance labels do not match SHA, project, and service during ${phase}: $target_image"
  printf '%s\n' "$image_id"
}

assert_target_image_identity_unchanged() {
  local service="$1"
  local expected_image_id="$2"
  local phase="$3"
  local actual_image_id
  [[ "$expected_image_id" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || akl_fail "Durable target image ID is invalid during ${phase}: $service"
  actual_image_id="$(verify_target_image_identity "$service" "$phase")"
  [[ "$actual_image_id" == "$expected_image_id" ]] \
    || akl_fail "Immutable target image content ID changed after the durable post-build boundary during ${phase}: $service"
}

assert_runtime_container_bound_to_image() {
  local service="$1"
  local expected_image_id="$2"
  local phase="$3"
  local runtime_image_ref container_ps_output container_id
  local running restarting status image_id image_ref compose_project compose_service compose_oneoff
  local config_files revision release_project release_service
  local -a container_ids=()

  assert_target_image_identity_unchanged "$service" "$expected_image_id" "$phase"
  runtime_image_ref="$expected_image_id"
  container_ps_output="$("${COMPOSE[@]}" ps -q "$service")" \
    || akl_fail "Could not enumerate runtime container during ${phase}: $service"
  if [[ -n "$container_ps_output" ]]; then
    mapfile -t container_ids <<<"$container_ps_output"
  fi
  [[ ${#container_ids[@]} -eq 1 && -n "${container_ids[0]}" ]] \
    || akl_fail "Runtime service must resolve to exactly one container during ${phase}: $service"
  container_id="${container_ids[0]}"
  running="$(docker inspect --format '{{.State.Running}}' "$container_id")"
  restarting="$(docker inspect --format '{{.State.Restarting}}' "$container_id")"
  status="$(docker inspect --format '{{.State.Status}}' "$container_id")"
  image_id="$(docker inspect --format '{{.Image}}' "$container_id")"
  image_ref="$(docker inspect --format '{{.Config.Image}}' "$container_id")"
  compose_project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container_id")"
  compose_service="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$container_id")"
  compose_oneoff="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.oneoff"}}' "$container_id")"
  config_files="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$container_id")"
  revision="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$container_id")"
  release_project="$(docker inspect --format '{{index .Config.Labels "cz.zeleznalady.akl.compose-project"}}' "$container_id")"
  release_service="$(docker inspect --format '{{index .Config.Labels "cz.zeleznalady.akl.service"}}' "$container_id")"
  [[ "$running" == "true" && "$restarting" == "false" && "$status" == "running" ]] \
    || akl_fail "Runtime container is not stably running during ${phase}: $service"
  [[ "$image_id" == "$expected_image_id" && "$image_ref" == "$runtime_image_ref" ]] \
    || akl_fail "Runtime container is not bound to the durable target image during ${phase}: $service"
  [[ "$compose_project" == "$PROJECT_NAME" \
    && "$compose_service" == "$service" \
    && "${compose_oneoff,,}" == "false" \
    && "$config_files" == "$COMPOSE_FILE" \
    && "$revision" == "$TARGET_SHA" \
    && "$release_project" == "$PROJECT_NAME" \
    && "$release_service" == "$service" ]] \
    || akl_fail "Runtime container provenance does not match the durable release during ${phase}: $service"
}

mark_runtime() {
  local state="$1"
  local phase="$2"
  akl_write_runtime_marker \
    "$RELEASE_ROOT" \
    "$TARGET_SHA" \
    "$state" \
    "$phase" \
    "$SERVICE_CSV" \
    "$MIGRATION_STARTED" \
    "$DEPLOYMENT_ID"
  RUNTIME_MARKED="true"
  RUNTIME_PHASE="$phase"
  RUNTIME_MARKER_SHA="$TARGET_SHA"
  RUNTIME_MARKER_STATE="$state"
  RUNTIME_MARKER_DEPLOYMENT_ID="$DEPLOYMENT_ID"
}

restore_quiesced_registry_if_safe() {
  local registry_ps_output restored_running restored_restarting restored_status
  local -a registry_container_ids=()
  if [[ "$REGISTRY_STOP_MAY_HAVE_STARTED" != "true" || "$SAFE_TO_RESTORE_REGISTRY" != "true" ]]; then
    return 0
  fi
  [[ -n "$OLD_REGISTRY_CONTAINER_ID" ]] || return 0
  if [[ "$OLD_REGISTRY_WAS_RUNNING" != "true" ]]; then
    REGISTRY_STOP_MAY_HAVE_STARTED="false"
    REGISTRY_QUIESCED="false"
    return 0
  fi
  registry_ps_output="$(
    docker ps -a \
      --no-trunc \
      --filter "label=com.docker.compose.project=${PROJECT_NAME}" \
      --filter 'label=com.docker.compose.service=registry-api' \
      --format '{{.ID}}'
  )" || {
    printf 'CRITICAL: Could not enumerate Registry containers before predecessor restore.\n' >&2
    return 1
  }
  if [[ -n "$registry_ps_output" ]]; then
    mapfile -t registry_container_ids <<<"$registry_ps_output"
  fi
  if [[ ${#registry_container_ids[@]} -ne 1 \
    || "${registry_container_ids[0]}" != "$OLD_REGISTRY_CONTAINER_ID" ]]; then
    printf 'CRITICAL: Registry predecessor identity changed before restore.\n' >&2
    return 1
  fi
  restored_running="$(docker inspect --format '{{.State.Running}}' "$OLD_REGISTRY_CONTAINER_ID")" || return 1
  restored_restarting="$(docker inspect --format '{{.State.Restarting}}' "$OLD_REGISTRY_CONTAINER_ID")" || return 1
  restored_status="$(docker inspect --format '{{.State.Status}}' "$OLD_REGISTRY_CONTAINER_ID")" || return 1
  if [[ "$restored_running" == "true" && "$restored_restarting" == "false" && "$restored_status" == "running" ]]; then
    REGISTRY_STOP_MAY_HAVE_STARTED="false"
    REGISTRY_QUIESCED="false"
    return 0
  fi
  if [[ "$restored_running" != "false" || "$restored_restarting" != "false" \
    || ( "$restored_status" != "exited" && "$restored_status" != "created" ) ]]; then
    printf 'CRITICAL: Registry predecessor is in an unsafe state and will not be restarted.\n' >&2
    return 1
  fi
  printf 'Restoring the exact pre-migration Registry container after a pre-apply failure.\n' >&2
  docker start "$OLD_REGISTRY_CONTAINER_ID" >/dev/null
  if [[ "$(docker inspect --format '{{.State.Running}}' "$OLD_REGISTRY_CONTAINER_ID")" != "true" ]]; then
    printf 'CRITICAL: The exact pre-migration Registry container did not restart.\n' >&2
    return 1
  fi
  if [[ "$(docker inspect --format '{{.Image}}' "$OLD_REGISTRY_CONTAINER_ID")" != "$OLD_REGISTRY_IMAGE_ID" ]]; then
    printf 'CRITICAL: The restored Registry container image identity changed.\n' >&2
    return 1
  fi
  if [[ "$(docker inspect --format '{{.Config.Image}}' "$OLD_REGISTRY_CONTAINER_ID")" != "$OLD_REGISTRY_IMAGE_REF" \
    || "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.config-hash"}}' "$OLD_REGISTRY_CONTAINER_ID")" != "$OLD_REGISTRY_CONFIG_HASH" \
    || "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$OLD_REGISTRY_CONTAINER_ID")" != "$OLD_REGISTRY_CONFIG_FILES" ]]; then
    printf 'CRITICAL: The restored Registry container image reference or Compose identity changed.\n' >&2
    return 1
  fi
  REGISTRY_STOP_MAY_HAVE_STARTED="false"
  REGISTRY_QUIESCED="false"
}

quarantine_unverified_target_services() {
  local service target_image_id
  for service in "${services[@]}"; do
    case "$service" in
      registry-api) target_image_id="$TARGET_REGISTRY_IMAGE_ID" ;;
      ingestion-service) target_image_id="$TARGET_INGESTION_IMAGE_ID" ;;
      rag-retrieval-service) target_image_id="$TARGET_RAG_IMAGE_ID" ;;
      web) target_image_id="$TARGET_WEB_IMAGE_ID" ;;
      chat-web) target_image_id="$TARGET_CHAT_WEB_IMAGE_ID" ;;
      *) akl_fail "Unsupported target service during quarantine" ;;
    esac
    if (
      akl_quarantine_unverified_compose_service \
        "$PROJECT_NAME" \
        "$service" \
        "$target_image_id" \
        "$TARGET_SHA" \
        "$COMPOSE_FILE"
    ); then
      case "$service" in
        registry-api) TARGET_REGISTRY_QUARANTINED="true" ;;
        ingestion-service) TARGET_INGESTION_QUARANTINED="true" ;;
        rag-retrieval-service) TARGET_RAG_QUARANTINED="true" ;;
        web) TARGET_WEB_QUARANTINED="true" ;;
        chat-web) TARGET_CHAT_WEB_QUARANTINED="true" ;;
      esac
      printf 'Unverified AKB target service was quarantined: %s. No predecessor rollback was attempted.\n' \
        "$service" >&2
    else
      case "$service" in
        registry-api) TARGET_REGISTRY_QUARANTINE_FAILED="true" ;;
        ingestion-service) TARGET_INGESTION_QUARANTINE_FAILED="true" ;;
        rag-retrieval-service) TARGET_RAG_QUARANTINE_FAILED="true" ;;
        web) TARGET_WEB_QUARANTINE_FAILED="true" ;;
        chat-web) TARGET_CHAT_WEB_QUARANTINE_FAILED="true" ;;
      esac
      PRESERVE_DEPLOY_LOCK="true"
      printf 'CRITICAL: AKB target verification failed and quarantine could not be proven: %s.\n' \
        "$service" >&2
    fi
  done
}

on_exit() {
  local status=$?
  trap - EXIT
  set +e
  if [[ $status -ne 0 ]]; then
    if [[ "$TARGET_BUILD_MAY_HAVE_STARTED" == "true" && "$CURRENT_ADVANCED" != "true" ]]; then
      RETRY_REQUIRES_DESCENDANT_SHA="true"
    fi
    if [[ "$TARGET_SERVICES_START_MAY_HAVE_STARTED" == "true" \
      && "$RUNTIME_MARKER_STATE" != "verified" \
      && "$CURRENT_ADVANCED" != "true" ]]; then
      quarantine_unverified_target_services
    fi
    if [[ "$RUNTIME_MARKED" == "true" && "$CURRENT_ADVANCED" != "true" ]]; then
      if (
        akl_write_runtime_marker \
          "$RELEASE_ROOT" \
          "$TARGET_SHA" \
          failed \
          "$RUNTIME_PHASE" \
          "$SERVICE_CSV" \
          "$MIGRATION_STARTED" \
          "$DEPLOYMENT_ID"
      ); then
        RUNTIME_MARKER_STATE="failed"
      else
        PRESERVE_DEPLOY_LOCK="true"
        printf 'CRITICAL: Failed runtime evidence could not be published.\n' >&2
      fi
    elif [[ "$RUNTIME_MARKED" != "true" ]]; then
      restore_quiesced_registry_if_safe || true
    fi
    if [[ "$CURRENT_ADVANCED" == "true" ]]; then
      if ! ( write_deployment_record activated_recording_failed ); then
        PRESERVE_DEPLOY_LOCK="true"
        printf 'CRITICAL: Activated-release failure evidence could not be published.\n' >&2
      fi
      printf 'Release passed verification and current advanced, but final bookkeeping failed.\n' >&2
    else
      if ! ( write_deployment_record failed ); then
        PRESERVE_DEPLOY_LOCK="true"
        printf 'CRITICAL: Failed deployment evidence could not be published.\n' >&2
      fi
      printf 'Deployment failed. current was not advanced.\n' >&2
    fi
    if [[ "$MIGRATION_STARTED" == "true" && "$CURRENT_ADVANCED" != "true" ]]; then
      printf 'Database migration may be forward-only; deploy a reviewed forward-fix SHA.\n' >&2
    elif [[ "$RETRY_REQUIRES_DESCENDANT_SHA" == "true" ]]; then
      printf 'Immutable target image tags may exist; prepare and deploy a reviewed descendant SHA instead of retrying this SHA.\n' >&2
    fi
  fi
  cleanup_env_snapshot || {
    printf 'CRITICAL: Could not securely remove the private env snapshot.\n' >&2
    status=1
    PRESERVE_DEPLOY_LOCK="true"
  }
  if [[ "$PRESERVE_DEPLOY_LOCK" == "true" ]]; then
    printf 'CRITICAL: Preserving the immutable deployment lock for explicit recovery investigation.\n' >&2
  else
    if ! akl_release_deploy_lock; then
      PRESERVE_DEPLOY_LOCK="true"
      status=1
      printf 'CRITICAL: Deployment lock release failed; preserving the remaining lock state.\n' >&2
      if [[ "$CURRENT_ADVANCED" == "true" ]]; then
        write_deployment_record activated_recording_failed || true
      else
        write_deployment_record failed || true
      fi
    fi
  fi
  exit "$status"
}
trap on_exit EXIT

akl_assert_no_stale_private_postgres_credentials "$RELEASE_ROOT"

akl_assert_expected_env_snapshot "$ENV_FILE"
if [[ "$TRANSITION_EXISTING_CURRENT" == "true" ]]; then
  transition_locked_mode="$(
    akl_assert_existing_current_transition_state \
      "$RELEASE_ROOT" \
      "$ENV_FILE" \
      "$ENV_SOURCE_FILE" \
      "$GIT_DIR" \
      "$TARGET_SHA" \
      locked
  )"
  [[ "$transition_locked_mode" == "$transition_preflight_mode" ]] \
    || akl_fail "Existing-current transition state changed before lock revalidation"
  release_dir="$TARGET_RELEASE"
  printf 'Locked transition state revalidated (%s); prepare/fetch skipped.\n' \
    "$transition_locked_mode" >&2
else
  release_dir="$(
    AKL_RELEASE_ROOT="$RELEASE_ROOT" \
    AKL_PROD_ENV_FILE="$ENV_FILE" \
    AKL_RELEASE_GIT_DIR="$GIT_DIR" \
      "${SCRIPT_DIR}/prepare_docker_home_release.sh" "$TARGET_SHA"
  )"
fi
akl_assert_git_mirror_has_no_replace_refs "$GIT_DIR"
COMPOSE_FILE="${release_dir}/infra/docker-compose/docker-compose.docker-home.yml"
akl_require_file "$COMPOSE_FILE"
akl_assert_no_ambient_compose_overrides \
  "$COMPOSE_FILE" \
  AKL_SERVICE_VERSION \
  AKL_RELEASE_COMPOSE_PROJECT \
  REGISTRY_API_IMAGE \
  INGESTION_SERVICE_IMAGE \
  RAG_RETRIEVAL_SERVICE_IMAGE \
  WEB_IMAGE \
  CHAT_WEB_IMAGE
AKL_SERVICE_VERSION="$TARGET_SHA"
REGISTRY_API_IMAGE="akl/registry-api:${TARGET_SHA}"
INGESTION_SERVICE_IMAGE="akl/ingestion-service:${TARGET_SHA}"
RAG_RETRIEVAL_SERVICE_IMAGE="akl/rag-retrieval-service:${TARGET_SHA}"
WEB_IMAGE="akl/web:${TARGET_SHA}"
CHAT_WEB_IMAGE="akl/chat-web:${TARGET_SHA}"
COMPOSE=(
  env
  "AKL_SERVICE_VERSION=${AKL_SERVICE_VERSION}"
  "REGISTRY_API_IMAGE=${REGISTRY_API_IMAGE}"
  "INGESTION_SERVICE_IMAGE=${INGESTION_SERVICE_IMAGE}"
  "RAG_RETRIEVAL_SERVICE_IMAGE=${RAG_RETRIEVAL_SERVICE_IMAGE}"
  "WEB_IMAGE=${WEB_IMAGE}"
  "CHAT_WEB_IMAGE=${CHAT_WEB_IMAGE}"
  "AKL_RELEASE_COMPOSE_PROJECT=${PROJECT_NAME}"
  docker compose
  --project-name "$PROJECT_NAME"
  --env-file "$ENV_FILE"
  -f "$COMPOSE_FILE"
)

current_sha="$(akl_current_release_sha "$RELEASE_ROOT")"
CURRENT_SHA_AT_START="${current_sha:-none}"
if [[ -n "$current_sha" ]]; then
  current_release_dir="${RELEASE_ROOT}/releases/${current_sha}"
  akl_require_read_only_release_tree "$current_release_dir"
  akl_verify_release_tree "$GIT_DIR" "$current_sha" "$current_release_dir" "$TRUSTED_REF"
fi
RUNTIME_MARKER_SHA="$(akl_runtime_marker_value "$RELEASE_ROOT" applied_sha)"
RUNTIME_MARKER_STATE="$(akl_runtime_marker_value "$RELEASE_ROOT" state)"
RUNTIME_MARKER_PHASE="$(akl_runtime_marker_value "$RELEASE_ROOT" phase)"
RUNTIME_MARKER_SERVICES="$(akl_runtime_marker_value "$RELEASE_ROOT" services)"
RUNTIME_MARKER_DEPLOYMENT_ID="$(akl_runtime_marker_value "$RELEASE_ROOT" deployment_id)"
if [[ -z "$RUNTIME_MARKER_SHA" && -z "$RUNTIME_MARKER_STATE" \
  && -z "$RUNTIME_MARKER_PHASE" && -z "$RUNTIME_MARKER_SERVICES" \
  && -z "$RUNTIME_MARKER_DEPLOYMENT_ID" ]]; then
  RUNTIME_MARKER_SHA="none"
  RUNTIME_MARKER_STATE="none"
  RUNTIME_MARKER_PHASE="none"
  RUNTIME_MARKER_SERVICES="none"
  RUNTIME_MARKER_DEPLOYMENT_ID="none"
elif [[ -z "$RUNTIME_MARKER_SHA" || -z "$RUNTIME_MARKER_STATE" \
  || -z "$RUNTIME_MARKER_PHASE" || -z "$RUNTIME_MARKER_SERVICES" \
  || -z "$RUNTIME_MARKER_DEPLOYMENT_ID" ]]; then
  akl_fail "Applied runtime marker is incomplete"
fi
if [[ "$RUNTIME_MARKER_SHA" == "none" && -n "$current_sha" ]]; then
  akl_write_runtime_marker \
    "$RELEASE_ROOT" \
    "$current_sha" \
    verified \
    seeded \
    legacy \
    false \
    "seed:${DEPLOYMENT_ID}"
  RUNTIME_MARKER_SHA="$current_sha"
  RUNTIME_MARKER_STATE="verified"
  RUNTIME_MARKER_PHASE="seeded"
  RUNTIME_MARKER_SERVICES="legacy"
  RUNTIME_MARKER_DEPLOYMENT_ID="seed:${DEPLOYMENT_ID}"
fi

if [[ "$RUNTIME_MARKER_SHA" != "none" ]]; then
  git --no-replace-objects --git-dir="$GIT_DIR" cat-file -e "${RUNTIME_MARKER_SHA}^{commit}" \
    || akl_fail "Applied runtime marker SHA is not present in the trusted Git mirror"
  git --no-replace-objects --git-dir="$GIT_DIR" merge-base --is-ancestor "$RUNTIME_MARKER_SHA" "$TARGET_SHA" \
    || akl_fail "Target SHA must descend from the latest applied runtime SHA"
fi
if [[ -n "$current_sha" ]]; then
  git --no-replace-objects --git-dir="$GIT_DIR" merge-base --is-ancestor "$current_sha" "$TARGET_SHA" \
    || akl_fail "Production releases must move forward from current SHA"
fi

if [[ "$RUNTIME_MARKER_SHA" != "none" && ( "$RUNTIME_MARKER_SHA" != "$current_sha" || "$RUNTIME_MARKER_STATE" != "verified" ) ]]; then
  RECOVERY_REQUIRED="true"
fi

if [[ "$RUNTIME_MARKER_SHA" == "$TARGET_SHA" \
  && "$RUNTIME_MARKER_STATE" == "verified" \
  && "$RUNTIME_MARKER_PHASE" == "verified" ]]; then
  [[ -z "${AKL_FORWARD_FIX_FROM_SHA:-}" ]] \
    || akl_fail "Forward-fix context is invalid for verified-release reconciliation"
  [[ "$RUNTIME_MARKER_SERVICES" =~ ^(registry-api|ingestion-service|rag-retrieval-service|web|chat-web)(,(registry-api|ingestion-service|rag-retrieval-service|web|chat-web))*$ ]] \
    || akl_fail "Verified runtime marker has an invalid service set"
  SERVICE_CSV="$RUNTIME_MARKER_SERVICES"
  IFS='|' read -r \
    TARGET_REGISTRY_IMAGE_ID \
    TARGET_INGESTION_IMAGE_ID \
    TARGET_RAG_IMAGE_ID \
    TARGET_WEB_IMAGE_ID \
    TARGET_CHAT_WEB_IMAGE_ID \
    <<<"$(load_reconciliation_image_ids \
      "$RUNTIME_MARKER_DEPLOYMENT_ID" \
      "$RUNTIME_MARKER_SERVICES")"
  IFS=',' read -r -a reconciled_services <<<"$SERVICE_CSV"
  for reconciled_service in "${reconciled_services[@]}"; do
    case "$reconciled_service" in
      registry-api) reconciled_image_id="$TARGET_REGISTRY_IMAGE_ID" ;;
      ingestion-service) reconciled_image_id="$TARGET_INGESTION_IMAGE_ID" ;;
      rag-retrieval-service) reconciled_image_id="$TARGET_RAG_IMAGE_ID" ;;
      web) reconciled_image_id="$TARGET_WEB_IMAGE_ID" ;;
      chat-web) reconciled_image_id="$TARGET_CHAT_WEB_IMAGE_ID" ;;
      *) akl_fail "Verified reconciliation contains an unsupported service" ;;
    esac
    assert_runtime_container_bound_to_image \
      "$reconciled_service" "$reconciled_image_id" reconciliation-pre-verify
  done
  if [[ "$current_sha" == "$TARGET_SHA" ]]; then
    reconciliation_status="reconciling_verified_success"
  else
    reconciliation_status="reconciling_verified_activation"
  fi
  write_deployment_record "$reconciliation_status"
  akl_assert_expected_env_snapshot "$ENV_FILE"
  AKL_RELEASE_ROOT="$RELEASE_ROOT" \
  AKL_PROD_ENV_FILE="$ENV_FILE" \
  AKL_RELEASE_EXPECTED_REGISTRY_IMAGE_ID="$TARGET_REGISTRY_IMAGE_ID" \
  AKL_RELEASE_EXPECTED_INGESTION_IMAGE_ID="$TARGET_INGESTION_IMAGE_ID" \
  AKL_RELEASE_EXPECTED_RAG_IMAGE_ID="$TARGET_RAG_IMAGE_ID" \
  AKL_RELEASE_EXPECTED_WEB_IMAGE_ID="$TARGET_WEB_IMAGE_ID" \
  AKL_RELEASE_EXPECTED_CHAT_WEB_IMAGE_ID="$TARGET_CHAT_WEB_IMAGE_ID" \
    "${release_dir}/scripts/verify_docker_home_release.sh" \
      "$TARGET_SHA" "$release_dir" "$SERVICE_CSV"
  for reconciled_service in "${reconciled_services[@]}"; do
    case "$reconciled_service" in
      registry-api) reconciled_image_id="$TARGET_REGISTRY_IMAGE_ID" ;;
      ingestion-service) reconciled_image_id="$TARGET_INGESTION_IMAGE_ID" ;;
      rag-retrieval-service) reconciled_image_id="$TARGET_RAG_IMAGE_ID" ;;
      web) reconciled_image_id="$TARGET_WEB_IMAGE_ID" ;;
      chat-web) reconciled_image_id="$TARGET_CHAT_WEB_IMAGE_ID" ;;
      *) akl_fail "Verified reconciliation contains an unsupported service" ;;
    esac
    assert_runtime_container_bound_to_image \
      "$reconciled_service" "$reconciled_image_id" reconciliation-final
  done
  akl_require_read_only_release_tree "$release_dir"
  akl_verify_release_tree "$GIT_DIR" "$TARGET_SHA" "$release_dir" "$TRUSTED_REF"
  if [[ "$current_sha" != "$TARGET_SHA" ]]; then
    akl_atomic_current_symlink "$RELEASE_ROOT" "$release_dir"
  fi
  CURRENT_ADVANCED="true"
  if [[ "$current_sha" == "$TARGET_SHA" ]]; then
    write_deployment_record reconciled_verified_success
    printf 'Reconciled verified release success evidence: %s\n' "$release_dir"
  else
    write_deployment_record reconciled_verified_activation
    printf 'Reconciled verified runtime activation: %s\n' "$release_dir"
  fi
  cleanup_env_snapshot \
    || akl_fail "Could not securely remove the private env snapshot after reconciliation"
  if ! akl_release_deploy_lock; then
    PRESERVE_DEPLOY_LOCK="true"
    write_deployment_record activated_recording_failed || true
    akl_fail "Could not release the immutable deployment lock after reconciliation"
  fi
  trap - EXIT
  exit 0
fi

[[ "$current_sha" != "$TARGET_SHA" ]] || akl_fail "Target SHA is already current"
if [[ "$RECOVERY_REQUIRED" == "true" && -z "${AKL_FORWARD_FIX_FROM_SHA:-}" ]]; then
  akl_fail "Applied runtime SHA differs from the verified release; use the forward-fix recovery entry point"
fi
if [[ -n "${AKL_FORWARD_FIX_FROM_SHA:-}" ]]; then
  akl_validate_full_sha "$AKL_FORWARD_FIX_FROM_SHA"
  [[ "$RUNTIME_MARKER_SHA" != "none" && "$AKL_FORWARD_FIX_FROM_SHA" == "$RUNTIME_MARKER_SHA" ]] \
    || akl_fail "Forward-fix failed SHA must exactly match the latest applied runtime marker"
  git --no-replace-objects --git-dir="$GIT_DIR" merge-base --is-ancestor "$AKL_FORWARD_FIX_FROM_SHA" "$TARGET_SHA" \
    || akl_fail "Forward-fix SHA must descend from the latest applied runtime SHA"
fi

declare -a services=()
add_service() {
  local candidate="$1"
  local existing
  for existing in "${services[@]:-}"; do
    [[ "$existing" == "$candidate" ]] && return 0
  done
  services+=("$candidate")
}

if [[ -z "$current_sha" ]]; then
  services=(registry-api ingestion-service rag-retrieval-service web chat-web)
else
  current_compose_file="${current_release_dir}/infra/docker-compose/docker-compose.docker-home.yml"
  current_compose_sha256="$(sha256sum "$current_compose_file" | awk '{print $1}')"
  target_compose_sha256="$(sha256sum "$COMPOSE_FILE" | awk '{print $1}')"
  [[ "$current_compose_sha256" =~ ^[0-9a-f]{64}$ \
    && "$target_compose_sha256" =~ ^[0-9a-f]{64}$ ]] \
    || akl_fail "Could not establish exact current/target production Compose identity"
  compose_change_detected="false"
  if [[ "$current_compose_sha256" != "$target_compose_sha256" ]]; then
    compose_change_detected="true"
    compose_changed_services="$(
      akl_changed_supported_compose_services \
        "$current_compose_file" \
        "$COMPOSE_FILE"
    )"
    while IFS= read -r compose_service; do
      [[ -n "$compose_service" ]] || continue
      add_service "$compose_service"
    done <<<"$compose_changed_services"
  fi

  changed_paths="$(git --no-replace-objects --git-dir="$GIT_DIR" diff --name-only "$current_sha" "$TARGET_SHA" --)"
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    case "$path" in
      scripts/*|infra/docker-compose/docker-home.env.example)
        add_service registry-api
        add_service ingestion-service
        add_service rag-retrieval-service
        add_service web
        add_service chat-web
        ;;
      infra/docker-compose/docker-compose.docker-home.yml)
        [[ "$compose_change_detected" == "true" ]] \
          || akl_fail "Production Compose changed without exact structural preflight evidence"
        ;;
      services/registry-api/*|contracts/stratos/information-policy/*)
        add_service registry-api
        ;;
      services/ingestion-service/*)
        add_service ingestion-service
        ;;
      services/rag-retrieval-service/*)
        add_service rag-retrieval-service
        ;;
      services/evaluation-service/README.md|services/evaluation-service/datasets/*|services/evaluation-service/tests/*)
        # Evaluation documentation, curated datasets, and tests do not alter
        # a production runtime service managed by this release workflow.
        ;;
      apps/web/*)
        add_service web
        add_service chat-web
        ;;
      infra/keycloak/realm-stratos.json|infra/keycloak/update-stratos-public-routing.sh)
        # The shared Keycloak realm and public-routing client reconciliation
        # are applied and verified outside the AKB Compose release. These exact
        # declarative/admin resources do not select or mutate an AKB runtime
        # service.
        # Live-realm reconciliation evidence remains an independent prerequisite.
        ;;
      services/*|apps/*|infra/reverse-proxy/*|infra/keycloak/*|infra/monitoring/*|infra/postgres/*|infra/docker-compose/docker-compose.docker-home-observability.yml)
        akl_fail "Release changes unsupported runtime path outside registry/ingestion/rag/web/chat-web: $path"
        ;;
    esac
  done <<<"$changed_paths"
fi

if [[ -n "${AKL_FORWARD_FIX_FROM_SHA:-}" ]]; then
  [[ "$RUNTIME_MARKER_SERVICES" =~ ^(registry-api|ingestion-service|rag-retrieval-service|web|chat-web)(,(registry-api|ingestion-service|rag-retrieval-service|web|chat-web))*$ ]] \
    || akl_fail "Failed runtime marker has an invalid service set"
  IFS=',' read -r -a recovery_services <<<"$RUNTIME_MARKER_SERVICES"
  for recovery_service in "${recovery_services[@]}"; do
    add_service "$recovery_service"
  done
fi

[[ ${#services[@]} -gt 0 ]] || akl_fail "Release has no deployable registry/ingestion/rag/web/chat-web changes"
SERVICE_CSV="$(IFS=,; printf '%s' "${services[*]}")"
if [[ " ${services[*]} " == *" registry-api "* ]]; then
  [[ "$INGESTION_AUTHORIZATION_SECRET_FILE" == /* ]] \
    || akl_fail "AKL_INGESTION_AUTHORIZATION_SECRET_FILE must be an absolute path"
  akl_require_private_secret_file "$INGESTION_AUTHORIZATION_SECRET_FILE" 32
fi
if [[ " ${services[*]} " == *" ingestion-service "* ]]; then
  [[ "$INGESTION_REGISTRY_CLIENT_SECRET_FILE" == /* ]] \
    || akl_fail "AKL_INGESTION_REGISTRY_CLIENT_SECRET_FILE must be an absolute path"
  akl_require_private_secret_file "$INGESTION_REGISTRY_CLIENT_SECRET_FILE"
fi
if [[ " ${services[*]} " == *" rag-retrieval-service "* ]]; then
  [[ "$RAG_REGISTRY_CLIENT_SECRET_FILE" == /* ]] \
    || akl_fail "AKL_RAG_REGISTRY_CLIENT_SECRET_FILE must be an absolute path"
  akl_require_private_secret_file "$RAG_REGISTRY_CLIENT_SECRET_FILE"
fi
if [[ " ${services[*]} " == *" web "* ]]; then
  [[ "$WEB_INGESTION_CLIENT_SECRET_FILE" == /* ]] \
    || akl_fail "AKL_WEB_INGESTION_CLIENT_SECRET_FILE must be an absolute path"
  akl_require_private_secret_file "$WEB_INGESTION_CLIENT_SECRET_FILE"
fi
if ! akl_assert_release_sha_not_burned "$RELEASE_ROOT" "$TARGET_SHA"; then
  TARGET_BUILD_MAY_HAVE_STARTED="true"
  RETRY_REQUIRES_DESCENDANT_SHA="true"
  write_deployment_record burned_sha_rejected
  akl_fail "Target SHA has durable post-build evidence and requires a reviewed descendant: $TARGET_SHA"
fi

if [[ " ${services[*]} " == *" registry-api "* ]]; then
  POSTGRES_TOOL_IMAGE_REF="$(akl_env_value "$ENV_FILE" AKL_RELEASE_POSTGRES_TOOL_IMAGE)"
  [[ -n "$POSTGRES_TOOL_IMAGE_REF" ]] \
    || akl_fail "AKL_RELEASE_POSTGRES_TOOL_IMAGE is missing"
  POSTGRES_TOOL_IMAGE_ID="$(akl_resolve_local_exact_image_id "$POSTGRES_TOOL_IMAGE_REF")"
  POSTGRES_TOOL_PSQL_VERSION="$(akl_postgres_tool_version "$POSTGRES_TOOL_IMAGE_REF" psql)"
  POSTGRES_TOOL_PG_DUMP_VERSION="$(akl_postgres_tool_version "$POSTGRES_TOOL_IMAGE_REF" pg_dump)"
  POSTGRES_TOOL_PG_RESTORE_VERSION="$(akl_postgres_tool_version "$POSTGRES_TOOL_IMAGE_REF" pg_restore)"
  AKL_RELEASE_ROOT="$RELEASE_ROOT" \
  AKL_PROD_ENV_FILE="$ENV_FILE" \
  AKL_RELEASE_DEPLOYMENT_ID="$DEPLOYMENT_ID" \
  AKL_RELEASE_EXPECTED_POSTGRES_TOOL_IMAGE_ID="$POSTGRES_TOOL_IMAGE_ID" \
    "${release_dir}/scripts/check_registry_writable_primary.sh" --phase pre-stop
  WRITABLE_PRIMARY_PRE_STOP_CHECKED="true"
fi
write_deployment_record preparing

for service in "${services[@]}"; do
  case "$service" in
    registry-api) target_image="$REGISTRY_API_IMAGE" ;;
    ingestion-service) target_image="$INGESTION_SERVICE_IMAGE" ;;
    rag-retrieval-service) target_image="$RAG_RETRIEVAL_SERVICE_IMAGE" ;;
    web) target_image="$WEB_IMAGE" ;;
    chat-web) target_image="$CHAT_WEB_IMAGE" ;;
  esac
  if docker image inspect "$target_image" >/dev/null 2>&1; then
    TARGET_BUILD_MAY_HAVE_STARTED="true"
    RETRY_REQUIRES_DESCENDANT_SHA="true"
    akl_burn_release_sha "$RELEASE_ROOT" "$TARGET_SHA" immutable_target_tag_exists
    write_deployment_record immutable_target_tag_exists
    akl_fail "Immutable target image tag already exists and will not be overwritten: $target_image"
  fi
done
printf 'Rendering immutable release compose configuration...\n'
akl_assert_expected_env_snapshot "$ENV_FILE"
"${COMPOSE[@]}" config --quiet

printf 'Building only affected services: %s\n' "$SERVICE_CSV"
TARGET_BUILD_MAY_HAVE_STARTED="true"
RETRY_REQUIRES_DESCENDANT_SHA="true"
akl_burn_release_sha "$RELEASE_ROOT" "$TARGET_SHA" build_may_have_started
write_deployment_record target_build_may_have_started
akl_assert_expected_env_snapshot "$ENV_FILE"
compose_build_services=()
for service in "${services[@]}"; do
  [[ "$service" == "ingestion-service" ]] || compose_build_services+=("$service")
done
if [[ ${#compose_build_services[@]} -gt 0 ]]; then
  DOCKER_BUILDKIT=1 "${COMPOSE[@]}" build "${compose_build_services[@]}"
fi
if [[ " ${services[*]} " == *" ingestion-service "* ]]; then
  env \
    "AKL_SERVICE_VERSION=${AKL_SERVICE_VERSION}" \
    "AKL_RELEASE_COMPOSE_PROJECT=${PROJECT_NAME}" \
    "INGESTION_SERVICE_IMAGE=${INGESTION_SERVICE_IMAGE}" \
    'DOCKER_BUILDKIT=1' \
    docker build --pull=false \
    --label "org.opencontainers.image.revision=${TARGET_SHA}" \
    --label "cz.zeleznalady.akl.compose-project=${PROJECT_NAME}" \
    --label 'cz.zeleznalady.akl.service=ingestion-service' \
    --tag "$INGESTION_SERVICE_IMAGE" \
    --file "${release_dir}/services/ingestion-service/Dockerfile" \
    "${release_dir}/services/ingestion-service"
fi
for service in "${services[@]}"; do
  verified_image_id="$(verify_target_image_identity "$service" post-build)"
  case "$service" in
    registry-api) TARGET_REGISTRY_IMAGE_ID="$verified_image_id" ;;
    ingestion-service) TARGET_INGESTION_IMAGE_ID="$verified_image_id" ;;
    rag-retrieval-service) TARGET_RAG_IMAGE_ID="$verified_image_id" ;;
    web) TARGET_WEB_IMAGE_ID="$verified_image_id" ;;
    chat-web) TARGET_CHAT_WEB_IMAGE_ID="$verified_image_id" ;;
  esac
done
write_deployment_record target_images_verified

PINNED_REGISTRY_API_IMAGE="$REGISTRY_API_IMAGE"
PINNED_INGESTION_SERVICE_IMAGE="$INGESTION_SERVICE_IMAGE"
PINNED_RAG_RETRIEVAL_SERVICE_IMAGE="$RAG_RETRIEVAL_SERVICE_IMAGE"
PINNED_WEB_IMAGE="$WEB_IMAGE"
PINNED_CHAT_WEB_IMAGE="$CHAT_WEB_IMAGE"
[[ "$TARGET_REGISTRY_IMAGE_ID" == "not-affected" ]] \
  || PINNED_REGISTRY_API_IMAGE="$TARGET_REGISTRY_IMAGE_ID"
[[ "$TARGET_INGESTION_IMAGE_ID" == "not-affected" ]] \
  || PINNED_INGESTION_SERVICE_IMAGE="$TARGET_INGESTION_IMAGE_ID"
[[ "$TARGET_RAG_IMAGE_ID" == "not-affected" ]] \
  || PINNED_RAG_RETRIEVAL_SERVICE_IMAGE="$TARGET_RAG_IMAGE_ID"
[[ "$TARGET_WEB_IMAGE_ID" == "not-affected" ]] \
  || PINNED_WEB_IMAGE="$TARGET_WEB_IMAGE_ID"
[[ "$TARGET_CHAT_WEB_IMAGE_ID" == "not-affected" ]] \
  || PINNED_CHAT_WEB_IMAGE="$TARGET_CHAT_WEB_IMAGE_ID"
PINNED_COMPOSE=(
  env
  "AKL_SERVICE_VERSION=${AKL_SERVICE_VERSION}"
  "REGISTRY_API_IMAGE=${PINNED_REGISTRY_API_IMAGE}"
  "INGESTION_SERVICE_IMAGE=${PINNED_INGESTION_SERVICE_IMAGE}"
  "RAG_RETRIEVAL_SERVICE_IMAGE=${PINNED_RAG_RETRIEVAL_SERVICE_IMAGE}"
  "WEB_IMAGE=${PINNED_WEB_IMAGE}"
  "CHAT_WEB_IMAGE=${PINNED_CHAT_WEB_IMAGE}"
  "AKL_RELEASE_COMPOSE_PROJECT=${PROJECT_NAME}"
  docker compose
  --project-name "$PROJECT_NAME"
  --env-file "$ENV_FILE"
  -f "$COMPOSE_FILE"
)

if [[ " ${services[*]} " == *" registry-api "* ]]; then
  registry_ps_output="$(
    docker ps -a \
      --no-trunc \
      --filter "label=com.docker.compose.project=${PROJECT_NAME}" \
      --filter 'label=com.docker.compose.service=registry-api' \
      --format '{{.ID}}'
  )" \
    || akl_fail "Could not enumerate the Registry writer container"
  registry_container_ids=()
  if [[ -n "$registry_ps_output" ]]; then
    mapfile -t registry_container_ids <<<"$registry_ps_output"
  fi
  [[ ${#registry_container_ids[@]} -le 1 ]] \
    || akl_fail "Registry writer quiesce requires exactly one or zero project containers"
  if [[ ${#registry_container_ids[@]} -eq 0 && -n "$current_sha" && "$RECOVERY_REQUIRED" != "true" ]]; then
    akl_fail "The verified current release has no Registry container to quiesce"
  fi
  if [[ ${#registry_container_ids[@]} -eq 1 ]]; then
    OLD_REGISTRY_CONTAINER_ID="${registry_container_ids[0]}"
    [[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$OLD_REGISTRY_CONTAINER_ID")" == "$PROJECT_NAME" ]] \
      || akl_fail "Registry writer container has the wrong Compose project label"
    [[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$OLD_REGISTRY_CONTAINER_ID")" == "registry-api" ]] \
      || akl_fail "Registry writer container has the wrong Compose service label"
    OLD_REGISTRY_ONEOFF="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.oneoff"}}' "$OLD_REGISTRY_CONTAINER_ID")"
    [[ "${OLD_REGISTRY_ONEOFF,,}" == "false" ]] \
      || akl_fail "Registry writer quiesce refuses a one-off container"
    OLD_REGISTRY_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$OLD_REGISTRY_CONTAINER_ID")"
    [[ "$OLD_REGISTRY_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] \
      || akl_fail "Registry writer container image ID is invalid"
    OLD_REGISTRY_IMAGE_REF="$(docker inspect --format '{{.Config.Image}}' "$OLD_REGISTRY_CONTAINER_ID")"
    [[ -n "$OLD_REGISTRY_IMAGE_REF" && "$OLD_REGISTRY_IMAGE_REF" != *$'\n'* && "$OLD_REGISTRY_IMAGE_REF" != *$'\r'* ]] \
      || akl_fail "Registry writer container image reference is invalid"
    OLD_REGISTRY_CONFIG_HASH="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.config-hash"}}' "$OLD_REGISTRY_CONTAINER_ID")"
    [[ "$OLD_REGISTRY_CONFIG_HASH" =~ ^[0-9a-f]{64}$ ]] \
      || akl_fail "Registry writer container Compose config hash is invalid"
    OLD_REGISTRY_CONFIG_FILES="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$OLD_REGISTRY_CONTAINER_ID")"
    [[ -n "$OLD_REGISTRY_CONFIG_FILES" && "$OLD_REGISTRY_CONFIG_FILES" != *$'\n'* && "$OLD_REGISTRY_CONFIG_FILES" != *$'\r'* ]] \
      || akl_fail "Registry writer container Compose config-files label is invalid"
    OLD_REGISTRY_LABELS_VERIFIED="true"
    old_registry_running="$(docker inspect --format '{{.State.Running}}' "$OLD_REGISTRY_CONTAINER_ID")" \
      || akl_fail "Could not inspect the Registry writer running state"
    old_registry_restarting="$(docker inspect --format '{{.State.Restarting}}' "$OLD_REGISTRY_CONTAINER_ID")" \
      || akl_fail "Could not inspect the Registry writer restart state"
    old_registry_status="$(docker inspect --format '{{.State.Status}}' "$OLD_REGISTRY_CONTAINER_ID")" \
      || akl_fail "Could not inspect the Registry writer status"
    [[ "$old_registry_running" == "true" || "$old_registry_running" == "false" ]] \
      || akl_fail "Registry writer returned an invalid running state"
    [[ "$old_registry_restarting" == "true" || "$old_registry_restarting" == "false" ]] \
      || akl_fail "Registry writer returned an invalid restart state"
    case "$old_registry_status" in
      running|restarting|exited|created) ;;
      *) akl_fail "Registry writer returned an unsafe container status" ;;
    esac
    [[ "$old_registry_status" != "running" || "$old_registry_running" == "true" ]] \
      || akl_fail "Registry writer running-state evidence is inconsistent"
    [[ "$old_registry_status" != "restarting" || "$old_registry_restarting" == "true" ]] \
      || akl_fail "Registry writer restart-state evidence is inconsistent"
    OLD_REGISTRY_WAS_RESTARTING="$old_registry_restarting"
    if [[ "$old_registry_running" == "true" || "$old_registry_restarting" == "true" ]]; then
      OLD_REGISTRY_WAS_RUNNING="true"
    else
      OLD_REGISTRY_WAS_RUNNING="false"
    fi
    if [[ "$RECOVERY_REQUIRED" != "true" && "$RUNTIME_MARKER_SHA" == "$current_sha" && "$RUNTIME_MARKER_STATE" == "verified" ]]; then
      SAFE_TO_RESTORE_REGISTRY="true"
    elif [[ -z "$current_sha" && "$RUNTIME_MARKER_SHA" == "none" && "$RUNTIME_MARKER_STATE" == "none" ]]; then
      # First immutable rollout: the exact verified legacy Compose predecessor
      # may be restored only until the new runtime watermark is written.
      SAFE_TO_RESTORE_REGISTRY="true"
    fi
  fi

  assert_target_image_identity_unchanged \
    registry-api "$TARGET_REGISTRY_IMAGE_ID" pre-quiesce
  AKL_RELEASE_ROOT="$RELEASE_ROOT" \
  AKL_PROD_ENV_FILE="$ENV_FILE" \
  AKL_RELEASE_DEPLOYMENT_ID="$DEPLOYMENT_ID" \
  AKL_RELEASE_EXPECTED_POSTGRES_TOOL_IMAGE_ID="$POSTGRES_TOOL_IMAGE_ID" \
    "${release_dir}/scripts/check_registry_writable_primary.sh" --phase pre-quiesce
  WRITABLE_PRIMARY_PRE_QUIESCE_CHECKED="true"
  REGISTRY_STOP_MAY_HAVE_STARTED="true"
  write_deployment_record registry_stop_may_have_started
  if [[ -n "$OLD_REGISTRY_CONTAINER_ID" ]]; then
    akl_assert_expected_env_snapshot "$ENV_FILE"
    "${COMPOSE[@]}" stop --timeout "$REGISTRY_STOP_TIMEOUT" registry-api
  fi
  quiesced_predecessor_id="${OLD_REGISTRY_CONTAINER_ID:-none}"
  akl_record_registry_quiescence \
    "$RELEASE_ROOT" \
    "$DEPLOYMENT_ID" \
    "$PROJECT_NAME" \
    "$quiesced_predecessor_id" \
    "$OLD_REGISTRY_WAS_RUNNING"
  REGISTRY_QUIESCED="true"
  write_deployment_record registry_quiesced

  akl_assert_expected_env_snapshot "$ENV_FILE"
  BACKUP_DIR="$(
    AKL_RELEASE_DEPLOYMENT_ID="$DEPLOYMENT_ID" \
    AKL_RELEASE_ROOT="$RELEASE_ROOT" \
    AKL_PROD_ENV_FILE="$ENV_FILE" \
    AKL_RELEASE_EXPECTED_POSTGRES_TOOL_IMAGE_ID="$POSTGRES_TOOL_IMAGE_ID" \
      "${release_dir}/scripts/backup_registry_release.sh" "$TARGET_SHA"
  )"
  [[ "$BACKUP_DIR" == "${RELEASE_ROOT}/backups/"* ]] \
    || akl_fail "Registry backup was not written below ${RELEASE_ROOT}/backups"
  write_deployment_record backed_up

  akl_assert_registry_writer_quiesced \
    "$RELEASE_ROOT" "$DEPLOYMENT_ID" pre-alembic-heads
  assert_target_image_identity_unchanged \
    registry-api "$TARGET_REGISTRY_IMAGE_ID" pre-alembic-heads

  akl_assert_expected_env_snapshot "$ENV_FILE"
  heads_output="$("${PINNED_COMPOSE[@]}" run --rm --pull never --no-deps registry-api alembic heads)"
  mapfile -t target_head_lines < <(awk 'NF {print}' <<<"$heads_output")
  [[ ${#target_head_lines[@]} -eq 1 \
    && "${target_head_lines[0]}" =~ ^([0-9]{4}_[a-z0-9_]+)[[:space:]]+\(head\)$ ]] \
    || akl_fail "Registry release must declare exactly one canonical Alembic head"
  target_head="${BASH_REMATCH[1]:-}"

  AKL_RELEASE_ROOT="$RELEASE_ROOT" \
  AKL_PROD_ENV_FILE="$ENV_FILE" \
  AKL_RELEASE_DEPLOYMENT_ID="$DEPLOYMENT_ID" \
  AKL_RELEASE_EXPECTED_POSTGRES_TOOL_IMAGE_ID="$POSTGRES_TOOL_IMAGE_ID" \
    "${release_dir}/scripts/check_registry_writable_primary.sh" --phase pre-migration
  WRITABLE_PRIMARY_PRE_MIGRATION_CHECKED="true"
  akl_assert_registry_writer_quiesced \
    "$RELEASE_ROOT" "$DEPLOYMENT_ID" pre-runtime-marker
  assert_target_image_identity_unchanged \
    registry-api "$TARGET_REGISTRY_IMAGE_ID" pre-runtime-marker
  MIGRATION_STARTED="true"
  mark_runtime applying migrating
  write_deployment_record migrating
  akl_assert_expected_env_snapshot "$ENV_FILE"
  "${PINNED_COMPOSE[@]}" run --rm --pull never --no-deps registry-api alembic upgrade head
  assert_target_image_identity_unchanged \
    registry-api "$TARGET_REGISTRY_IMAGE_ID" post-migration-command
  akl_assert_expected_env_snapshot "$ENV_FILE"
  current_heads_output="$(
    "${PINNED_COMPOSE[@]}" run --rm --pull never --no-deps registry-api alembic current
  )"
  mapfile -t current_head_lines < <(awk 'NF {print}' <<<"$current_heads_output")
  [[ ${#current_head_lines[@]} -eq 1 \
    && "${current_head_lines[0]}" =~ ^([0-9]{4}_[a-z0-9_]+)([[:space:]]+\(head\))?$ ]] \
    || akl_fail "Registry database returned multiple or malformed Alembic heads"
  current_head="${BASH_REMATCH[1]:-}"
  [[ "$current_head" == "$target_head" ]] \
    || akl_fail "Registry database must reach exactly the single target Alembic head"
  mark_runtime applying migrated
fi

for service in "${services[@]}"; do
  case "$service" in
    registry-api) expected_image_id="$TARGET_REGISTRY_IMAGE_ID" ;;
    ingestion-service) expected_image_id="$TARGET_INGESTION_IMAGE_ID" ;;
    rag-retrieval-service) expected_image_id="$TARGET_RAG_IMAGE_ID" ;;
    web) expected_image_id="$TARGET_WEB_IMAGE_ID" ;;
    chat-web) expected_image_id="$TARGET_CHAT_WEB_IMAGE_ID" ;;
  esac
  assert_target_image_identity_unchanged "$service" "$expected_image_id" pre-restart
done
mark_runtime applying restarting
write_deployment_record restarting
printf 'Restarting only affected services: %s\n' "$SERVICE_CSV"
akl_assert_expected_env_snapshot "$ENV_FILE"
TARGET_SERVICES_START_MAY_HAVE_STARTED="true"
write_deployment_record target_services_start_may_have_started
"${PINNED_COMPOSE[@]}" up -d --pull never --no-build --no-deps --force-recreate "${services[@]}"
if [[ " ${services[*]} " == *" registry-api "* ]]; then
  REGISTRY_QUIESCED="false"
  REGISTRY_STOP_MAY_HAVE_STARTED="false"
fi
for service in "${services[@]}"; do
  case "$service" in
    registry-api) expected_image_id="$TARGET_REGISTRY_IMAGE_ID" ;;
    ingestion-service) expected_image_id="$TARGET_INGESTION_IMAGE_ID" ;;
    rag-retrieval-service) expected_image_id="$TARGET_RAG_IMAGE_ID" ;;
    web) expected_image_id="$TARGET_WEB_IMAGE_ID" ;;
    chat-web) expected_image_id="$TARGET_CHAT_WEB_IMAGE_ID" ;;
  esac
  assert_runtime_container_bound_to_image "$service" "$expected_image_id" post-restart
done

mark_runtime applying verifying
akl_assert_expected_env_snapshot "$ENV_FILE"
AKL_RELEASE_ROOT="$RELEASE_ROOT" \
AKL_PROD_ENV_FILE="$ENV_FILE" \
AKL_RELEASE_EXPECTED_REGISTRY_IMAGE_ID="$TARGET_REGISTRY_IMAGE_ID" \
AKL_RELEASE_EXPECTED_INGESTION_IMAGE_ID="$TARGET_INGESTION_IMAGE_ID" \
AKL_RELEASE_EXPECTED_RAG_IMAGE_ID="$TARGET_RAG_IMAGE_ID" \
AKL_RELEASE_EXPECTED_WEB_IMAGE_ID="$TARGET_WEB_IMAGE_ID" \
AKL_RELEASE_EXPECTED_CHAT_WEB_IMAGE_ID="$TARGET_CHAT_WEB_IMAGE_ID" \
  "${release_dir}/scripts/verify_docker_home_release.sh" \
    "$TARGET_SHA" "$release_dir" "$SERVICE_CSV"

for service in "${services[@]}"; do
  case "$service" in
    registry-api) expected_image_id="$TARGET_REGISTRY_IMAGE_ID" ;;
    ingestion-service) expected_image_id="$TARGET_INGESTION_IMAGE_ID" ;;
    rag-retrieval-service) expected_image_id="$TARGET_RAG_IMAGE_ID" ;;
    web) expected_image_id="$TARGET_WEB_IMAGE_ID" ;;
    chat-web) expected_image_id="$TARGET_CHAT_WEB_IMAGE_ID" ;;
  esac
  assert_runtime_container_bound_to_image "$service" "$expected_image_id" pre-verified-marker
done
akl_assert_expected_env_snapshot "$ENV_FILE"
akl_require_read_only_release_tree "$release_dir"
akl_verify_release_tree "$GIT_DIR" "$TARGET_SHA" "$release_dir" "$TRUSTED_REF"
write_deployment_record activation_pending
mark_runtime verified verified
RETRY_REQUIRES_DESCENDANT_SHA="false"
write_deployment_record activating_current
akl_atomic_current_symlink "$RELEASE_ROOT" "$release_dir"
CURRENT_ADVANCED="true"
write_deployment_record succeeded
printf 'Immutable release is current: %s\n' "$release_dir"

cleanup_env_snapshot \
  || akl_fail "Could not securely remove the private env snapshot after activation"
if ! akl_release_deploy_lock; then
  PRESERVE_DEPLOY_LOCK="true"
  write_deployment_record activated_recording_failed || true
  akl_fail "Could not release the immutable deployment lock after activation"
fi
trap - EXIT
