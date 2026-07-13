#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/immutable_release_common.sh
source "${SCRIPT_DIR}/lib/immutable_release_common.sh"

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
    -h|--help) usage ;;
    *) usage ;;
  esac
done
[[ -n "$TARGET_SHA" ]] || usage
akl_validate_full_sha "$TARGET_SHA"

RELEASE_ROOT="${AKL_RELEASE_ROOT:-/srv/akl}"
ENV_FILE="${AKL_PROD_ENV_FILE:-${RELEASE_ROOT}/env/akl.prod.env}"
DEPLOYMENTS_DIR="${RELEASE_ROOT}/deployments"
GIT_DIR="${AKL_RELEASE_GIT_DIR:-${RELEASE_ROOT}/git/AI-KnowledgeBase.git}"
MIGRATION_STARTED="false"
CURRENT_ADVANCED="false"
RUNTIME_MARKED="false"
RUNTIME_PHASE="not-applied"
RUNTIME_MARKER_SHA="none"
RUNTIME_MARKER_STATE="none"
RECOVERY_REQUIRED="false"
REGISTRY_QUIESCED="false"
SAFE_TO_RESTORE_REGISTRY="false"
OLD_REGISTRY_CONTAINER_ID=""
OLD_REGISTRY_IMAGE_ID=""
OLD_REGISTRY_IMAGE_REF=""
OLD_REGISTRY_CONFIG_HASH=""
OLD_REGISTRY_CONFIG_FILES=""
OLD_REGISTRY_LABELS_VERIFIED="false"
BACKUP_DIR="none"
SERVICE_CSV=""

akl_require_private_env_file "$ENV_FILE"
PROJECT_NAME="${AKL_RELEASE_COMPOSE_PROJECT:-$(akl_env_value "$ENV_FILE" AKL_RELEASE_COMPOSE_PROJECT akl)}"
REGISTRY_STOP_TIMEOUT="${AKL_RELEASE_REGISTRY_STOP_TIMEOUT_SECONDS:-$(akl_env_value "$ENV_FILE" AKL_RELEASE_REGISTRY_STOP_TIMEOUT_SECONDS 30)}"
DEPLOYMENT_ID="$(date -u +%Y%m%dT%H%M%SZ)-${TARGET_SHA}-$$"
DEPLOYMENT_RECORD="${DEPLOYMENTS_DIR}/${DEPLOYMENT_ID}.txt"
akl_validate_project_name "$PROJECT_NAME"
[[ "$REGISTRY_STOP_TIMEOUT" =~ ^[1-9][0-9]*$ && "$REGISTRY_STOP_TIMEOUT" -le 300 ]] \
  || akl_fail "AKL_RELEASE_REGISTRY_STOP_TIMEOUT_SECONDS must be between 1 and 300"
for command_name in docker git python3 curl pg_dump pg_restore psql sha256sum tar; do
  akl_require_command "$command_name"
done
if grep -E 'replace-with|<user>|<password>|long-random|prod-password' "$ENV_FILE" >/dev/null; then
  akl_fail "Production env file still contains placeholder values"
fi

umask 077
mkdir -p "$RELEASE_ROOT" "${RELEASE_ROOT}/env" "${RELEASE_ROOT}/backups" \
  "${RELEASE_ROOT}/releases" "$DEPLOYMENTS_DIR"
akl_acquire_deploy_lock "$RELEASE_ROOT"

write_deployment_record() {
  local status="$1"
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
    printf 'registry_quiesced=%s\n' "$REGISTRY_QUIESCED"
    printf 'old_registry_container_id=%s\n' "${OLD_REGISTRY_CONTAINER_ID:-none}"
    printf 'old_registry_image_id=%s\n' "${OLD_REGISTRY_IMAGE_ID:-none}"
    printf 'old_registry_image_ref=%s\n' "${OLD_REGISTRY_IMAGE_REF:-none}"
    printf 'old_registry_config_hash=%s\n' "${OLD_REGISTRY_CONFIG_HASH:-none}"
    printf 'old_registry_config_files=%s\n' "${OLD_REGISTRY_CONFIG_FILES:-none}"
    printf 'old_registry_labels_verified=%s\n' "$OLD_REGISTRY_LABELS_VERIFIED"
    printf 'recorded_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >"$DEPLOYMENT_RECORD"
  chmod 0600 "$DEPLOYMENT_RECORD"
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
}

restore_quiesced_registry_if_safe() {
  if [[ "$REGISTRY_QUIESCED" != "true" || "$SAFE_TO_RESTORE_REGISTRY" != "true" ]]; then
    return 0
  fi
  [[ -n "$OLD_REGISTRY_CONTAINER_ID" ]] || return 0
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
  REGISTRY_QUIESCED="false"
}

on_exit() {
  local status=$?
  trap - EXIT
  set +e
  if [[ $status -ne 0 ]]; then
    if [[ "$RUNTIME_MARKED" == "true" && "$CURRENT_ADVANCED" != "true" ]]; then
      akl_write_runtime_marker \
        "$RELEASE_ROOT" \
        "$TARGET_SHA" \
        failed \
        "$RUNTIME_PHASE" \
        "$SERVICE_CSV" \
        "$MIGRATION_STARTED" \
        "$DEPLOYMENT_ID" || true
      RUNTIME_MARKER_STATE="failed"
    elif [[ "$RUNTIME_MARKED" != "true" ]]; then
      restore_quiesced_registry_if_safe || true
    fi
    if [[ "$CURRENT_ADVANCED" == "true" ]]; then
      write_deployment_record activated_recording_failed || true
      printf 'Release passed verification and current advanced, but final bookkeeping failed.\n' >&2
    else
      write_deployment_record failed || true
      printf 'Deployment failed. current was not advanced.\n' >&2
    fi
    if [[ "$MIGRATION_STARTED" == "true" && "$CURRENT_ADVANCED" != "true" ]]; then
      printf 'Database migration may be forward-only; deploy a reviewed forward-fix SHA.\n' >&2
    fi
  fi
  akl_release_deploy_lock
  exit "$status"
}
trap on_exit EXIT

release_dir="$(
  AKL_RELEASE_ROOT="$RELEASE_ROOT" \
  AKL_PROD_ENV_FILE="$ENV_FILE" \
  AKL_RELEASE_GIT_DIR="$GIT_DIR" \
    "${SCRIPT_DIR}/prepare_docker_home_release.sh" "$TARGET_SHA"
)"
COMPOSE_FILE="${release_dir}/infra/docker-compose/docker-compose.docker-home.yml"
akl_require_file "$COMPOSE_FILE"

current_sha="$(akl_current_release_sha "$RELEASE_ROOT")"
RUNTIME_MARKER_SHA="$(akl_runtime_marker_value "$RELEASE_ROOT" applied_sha)"
RUNTIME_MARKER_STATE="$(akl_runtime_marker_value "$RELEASE_ROOT" state)"
if [[ -z "$RUNTIME_MARKER_SHA" && -z "$RUNTIME_MARKER_STATE" ]]; then
  RUNTIME_MARKER_SHA="none"
  RUNTIME_MARKER_STATE="none"
elif [[ -z "$RUNTIME_MARKER_SHA" || -z "$RUNTIME_MARKER_STATE" ]]; then
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
fi

[[ "$current_sha" != "$TARGET_SHA" ]] || akl_fail "Target SHA is already current"
if [[ "$RUNTIME_MARKER_SHA" != "none" ]]; then
  git --git-dir="$GIT_DIR" cat-file -e "${RUNTIME_MARKER_SHA}^{commit}" \
    || akl_fail "Applied runtime marker SHA is not present in the trusted Git mirror"
  git --git-dir="$GIT_DIR" merge-base --is-ancestor "$RUNTIME_MARKER_SHA" "$TARGET_SHA" \
    || akl_fail "Target SHA must descend from the latest applied runtime SHA"
fi
if [[ -n "$current_sha" ]]; then
  git --git-dir="$GIT_DIR" merge-base --is-ancestor "$current_sha" "$TARGET_SHA" \
    || akl_fail "Production releases must move forward from current SHA"
fi

if [[ "$RUNTIME_MARKER_SHA" != "none" && ( "$RUNTIME_MARKER_SHA" != "$current_sha" || "$RUNTIME_MARKER_STATE" != "verified" ) ]]; then
  RECOVERY_REQUIRED="true"
fi
if [[ "$RECOVERY_REQUIRED" == "true" && -z "${AKL_FORWARD_FIX_FROM_SHA:-}" ]]; then
  akl_fail "Applied runtime SHA differs from the verified release; use the forward-fix recovery entry point"
fi
if [[ -n "${AKL_FORWARD_FIX_FROM_SHA:-}" ]]; then
  akl_validate_full_sha "$AKL_FORWARD_FIX_FROM_SHA"
  [[ "$RUNTIME_MARKER_SHA" != "none" && "$AKL_FORWARD_FIX_FROM_SHA" == "$RUNTIME_MARKER_SHA" ]] \
    || akl_fail "Forward-fix failed SHA must exactly match the latest applied runtime marker"
  git --git-dir="$GIT_DIR" merge-base --is-ancestor "$AKL_FORWARD_FIX_FROM_SHA" "$TARGET_SHA" \
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
  services=(registry-api rag-retrieval-service web)
else
  changed_paths="$(git --git-dir="$GIT_DIR" diff --name-only "$current_sha" "$TARGET_SHA" --)"
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    case "$path" in
      infra/docker-compose/docker-compose.docker-home.yml)
        add_service registry-api
        add_service rag-retrieval-service
        add_service web
        ;;
      services/registry-api/*|contracts/stratos/information-policy/*)
        add_service registry-api
        ;;
      services/rag-retrieval-service/*)
        add_service rag-retrieval-service
        ;;
      apps/web/*)
        add_service web
        ;;
      services/*|apps/*|infra/reverse-proxy/*|infra/keycloak/*|infra/monitoring/*|infra/postgres/*|infra/docker-compose/docker-compose.docker-home-observability.yml)
        akl_fail "Release changes unsupported runtime path outside registry/rag/web: $path"
        ;;
    esac
  done <<<"$changed_paths"
fi
[[ ${#services[@]} -gt 0 ]] || akl_fail "Release has no deployable registry/rag/web changes"
SERVICE_CSV="$(IFS=,; printf '%s' "${services[*]}")"
write_deployment_record preparing

export AKL_SERVICE_VERSION="$TARGET_SHA"
export AKL_RELEASE_COMPOSE_PROJECT="$PROJECT_NAME"
export REGISTRY_API_IMAGE="${AKL_REGISTRY_RELEASE_IMAGE_REPOSITORY:-akl/registry-api}:${TARGET_SHA}"
export RAG_RETRIEVAL_SERVICE_IMAGE="${AKL_RAG_RELEASE_IMAGE_REPOSITORY:-akl/rag-retrieval-service}:${TARGET_SHA}"
export WEB_IMAGE="${AKL_WEB_RELEASE_IMAGE_REPOSITORY:-akl/web}:${TARGET_SHA}"
for service in "${services[@]}"; do
  case "$service" in
    registry-api) target_image="$REGISTRY_API_IMAGE" ;;
    rag-retrieval-service) target_image="$RAG_RETRIEVAL_SERVICE_IMAGE" ;;
    web) target_image="$WEB_IMAGE" ;;
  esac
  if docker image inspect "$target_image" >/dev/null 2>&1; then
    akl_fail "Immutable target image tag already exists and will not be overwritten: $target_image"
  fi
done
COMPOSE=(
  docker compose
  --project-name "$PROJECT_NAME"
  --env-file "$ENV_FILE"
  -f "$COMPOSE_FILE"
)

printf 'Rendering immutable release compose configuration...\n'
"${COMPOSE[@]}" config --quiet

printf 'Building only affected services: %s\n' "$SERVICE_CSV"
DOCKER_BUILDKIT=1 "${COMPOSE[@]}" build "${services[@]}"

if [[ " ${services[*]} " == *" registry-api "* ]]; then
  registry_ps_output="$(
    docker ps \
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
    if [[ "$RECOVERY_REQUIRED" != "true" && "$RUNTIME_MARKER_SHA" == "$current_sha" && "$RUNTIME_MARKER_STATE" == "verified" ]]; then
      SAFE_TO_RESTORE_REGISTRY="true"
    elif [[ -z "$current_sha" && "$RUNTIME_MARKER_SHA" == "none" && "$RUNTIME_MARKER_STATE" == "none" ]]; then
      # First immutable rollout: the exact verified legacy Compose predecessor
      # may be restored only until the new runtime watermark is written.
      SAFE_TO_RESTORE_REGISTRY="true"
    fi
  fi

  write_deployment_record quiescing_registry
  REGISTRY_QUIESCED="true"
  if [[ -n "$OLD_REGISTRY_CONTAINER_ID" ]]; then
    old_registry_running="$(docker inspect --format '{{.State.Running}}' "$OLD_REGISTRY_CONTAINER_ID")" \
      || akl_fail "Could not inspect the Registry writer running state"
    [[ "$old_registry_running" == "true" || "$old_registry_running" == "false" ]] \
      || akl_fail "Registry writer returned an invalid running state"
    if [[ "$old_registry_running" == "true" ]]; then
      "${COMPOSE[@]}" stop --timeout "$REGISTRY_STOP_TIMEOUT" registry-api
    fi
  fi
  running_registry_ids="$(
    docker ps \
      --no-trunc \
      --filter "label=com.docker.compose.project=${PROJECT_NAME}" \
      --filter 'label=com.docker.compose.service=registry-api' \
      --format '{{.ID}}'
  )" \
    || akl_fail "Could not verify Registry writer quiescence"
  [[ -z "$running_registry_ids" ]] \
    || akl_fail "Registry writer remained running after quiesce"
  write_deployment_record registry_quiesced

  BACKUP_DIR="$(
    AKL_REGISTRY_WRITERS_QUIESCED=true \
    AKL_RELEASE_ROOT="$RELEASE_ROOT" \
    AKL_PROD_ENV_FILE="$ENV_FILE" \
      "${release_dir}/scripts/backup_registry_release.sh" "$TARGET_SHA"
  )"
  [[ "$BACKUP_DIR" == "${RELEASE_ROOT}/backups/"* ]] \
    || akl_fail "Registry backup was not written below ${RELEASE_ROOT}/backups"
  write_deployment_record backed_up

  heads_output="$("${COMPOSE[@]}" run --rm --no-deps registry-api alembic heads)"
  target_head="$(awk '$1 ~ /^[0-9]{4}_[a-z0-9_]+$/ {print $1}' <<<"$heads_output" | head -n 1)"
  [[ "$target_head" =~ ^[0-9]{4}_[a-z0-9_]+$ ]] || akl_fail "Could not determine target Alembic head"
  [[ "$(awk '$1 ~ /^[0-9]{4}_[a-z0-9_]+$/ {count++} END {print count+0}' <<<"$heads_output")" -eq 1 ]] \
    || akl_fail "Registry release must contain exactly one Alembic head"

  MIGRATION_STARTED="true"
  mark_runtime applying migrating
  write_deployment_record migrating
  "${COMPOSE[@]}" run --rm --no-deps registry-api alembic upgrade head
  current_head="$(
    "${COMPOSE[@]}" run --rm --no-deps registry-api alembic current \
      | awk '$1 ~ /^[0-9]{4}_[a-z0-9_]+$/ {print $1}' \
      | head -n 1
  )"
  [[ "$current_head" == "$target_head" ]] \
    || akl_fail "Registry database did not reach target Alembic head"
  mark_runtime applying migrated
fi

mark_runtime applying restarting
write_deployment_record restarting
printf 'Restarting only affected services: %s\n' "$SERVICE_CSV"
"${COMPOSE[@]}" up -d --no-deps --force-recreate "${services[@]}"
if [[ " ${services[*]} " == *" registry-api "* ]]; then
  REGISTRY_QUIESCED="false"
fi

mark_runtime applying verifying
AKL_RELEASE_ROOT="$RELEASE_ROOT" \
AKL_PROD_ENV_FILE="$ENV_FILE" \
AKL_RELEASE_COMPOSE_PROJECT="$PROJECT_NAME" \
  "${release_dir}/scripts/verify_docker_home_release.sh" \
    "$TARGET_SHA" "$release_dir" "$SERVICE_CSV"

akl_require_read_only_release_tree "$release_dir"
akl_verify_release_tree "$GIT_DIR" "$TARGET_SHA" "$release_dir"
mark_runtime verified verified
akl_atomic_current_symlink "$RELEASE_ROOT" "$release_dir"
CURRENT_ADVANCED="true"
write_deployment_record succeeded
printf 'Immutable release is current: %s\n' "$release_dir"

akl_release_deploy_lock
trap - EXIT
