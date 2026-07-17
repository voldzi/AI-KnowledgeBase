#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REAL_PYTHON3="$(command -v python3)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/akl-immutable-release-test.XXXXXX")"
TMP_ROOT="$(python3 - "$TMP_ROOT" <<'PY'
import os
import sys
print(os.path.realpath(sys.argv[1]))
PY
)"

cleanup() {
  local status=$?
  trap - EXIT
  set +e
  chmod -R u+w "$TMP_ROOT" 2>/dev/null || true
  rm -rf "$TMP_ROOT"
  exit "$status"
}
trap cleanup EXIT

fail() {
  printf 'TEST FAILURE: %s\n' "$*" >&2
  exit 1
}

assert_current_sha() {
  local expected_sha="$1"
  local target
  target="$(python3 - "${AKL_RELEASE_ROOT}/current" <<'PY'
import os
import sys
print(os.path.realpath(sys.argv[1]))
PY
)"
  [[ "$target" == "${AKL_RELEASE_ROOT}/releases/${expected_sha}" ]] \
    || fail "current release is ${target}, expected ${expected_sha}"
}

runtime_marker_value() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key {print $2}' \
    "${AKL_RELEASE_ROOT}/state/applied-runtime.env"
}

assert_runtime_marker() {
  local expected_sha="$1"
  local expected_state="$2"
  [[ "$(runtime_marker_value applied_sha)" == "$expected_sha" ]] \
    || fail "runtime marker SHA does not equal ${expected_sha}"
  [[ "$(runtime_marker_value state)" == "$expected_state" ]] \
    || fail "runtime marker state does not equal ${expected_state}"
  [[ "$(python3 - "${AKL_RELEASE_ROOT}/state/applied-runtime.env" <<'PY'
import os
import stat
import sys
print(f"{stat.S_IMODE(os.stat(sys.argv[1]).st_mode):04o}")
PY
)" == "0600" ]] \
    || fail 'runtime marker mode is not 0600'
}

deployment_record_for_sha() {
  local target_sha="$1"
  local record
  record="$(
    find "${AKL_RELEASE_ROOT}/deployments" \
      -maxdepth 1 \
      -type f \
      -name "*-${target_sha}-*.txt" \
      -print \
      | sort \
      | tail -n 1
  )"
  [[ -n "$record" && -f "$record" ]] \
    || fail "deployment record is missing for ${target_sha}"
  printf '%s\n' "$record"
}

assert_burned_sha() {
  local expected_sha="$1"
  local expected_reason="$2"
  local marker="${AKL_RELEASE_ROOT}/state/burned-shas/${expected_sha}"
  [[ -f "$marker" && ! -L "$marker" ]] \
    || fail "burned-SHA marker is missing for ${expected_sha}"
  [[ "$(python3 - "$marker" <<'PY'
import os
import stat
import sys
print(f"{stat.S_IMODE(os.stat(sys.argv[1]).st_mode):04o}")
PY
)" == "0600" ]] \
    || fail "burned-SHA marker mode is not 0600 for ${expected_sha}"
  grep -Fxq 'schema_version=1' "$marker" \
    || fail "burned-SHA marker schema is invalid for ${expected_sha}"
  grep -Fxq "target_sha=${expected_sha}" "$marker" \
    || fail "burned-SHA marker identity is invalid for ${expected_sha}"
  grep -Fxq "reason=${expected_reason}" "$marker" \
    || fail "burned-SHA marker reason is invalid for ${expected_sha}"
}

WORK_REPO="${TMP_ROOT}/work"
REMOTE_REPO="${TMP_ROOT}/remote.git"
FAKE_BIN="${TMP_ROOT}/fake-bin"
CALL_LOG="${TMP_ROOT}/calls.log"
FAKE_ALEMBIC_STATE="${TMP_ROOT}/alembic-head"
FAKE_WEB_STATE="${TMP_ROOT}/web-release"
FAKE_RUNTIME_DIR="${TMP_ROOT}/fake-runtime"
VERIFIED_BOOTSTRAP_RELEASE="${TMP_ROOT}/verified-bootstrap-release"
FAKE_POSTGRES_TOOL_IMAGE="postgres:17-alpine@sha256:$(printf 'a%.0s' {1..64})"
FAKE_POSTGRES_TOOL_IMAGE_ID="sha256:$(printf 'b%.0s' {1..64})"
FAKE_POSTGRES_TOOL_REPO_DIGEST="postgres@sha256:$(printf 'a%.0s' {1..64})"
AKL_RELEASE_ROOT="${TMP_ROOT}/srv/akl"
AKL_PROD_ENV_FILE="${AKL_RELEASE_ROOT}/env/akl.prod.env"
FAKE_PERSISTENT_ENV_FILE="$AKL_PROD_ENV_FILE"
INGESTION_AUTHORIZATION_SECRET_FILE="${AKL_RELEASE_ROOT}/env/ingestion-authorization.secret"
INGESTION_REGISTRY_CLIENT_SECRET_FILE="${AKL_RELEASE_ROOT}/env/svc-ingestion.client-secret"
RAG_REGISTRY_CLIENT_SECRET_FILE="${AKL_RELEASE_ROOT}/env/akb-rag-service.client-secret"
WEB_INGESTION_CLIENT_SECRET_FILE="${AKL_RELEASE_ROOT}/env/svc-akb-web-ingestion.client-secret"
export CALL_LOG FAKE_ALEMBIC_STATE FAKE_WEB_STATE FAKE_RUNTIME_DIR
export FAKE_POSTGRES_TOOL_IMAGE FAKE_POSTGRES_TOOL_IMAGE_ID FAKE_POSTGRES_TOOL_REPO_DIGEST REAL_PYTHON3
export AKL_RELEASE_ROOT AKL_PROD_ENV_FILE FAKE_PERSISTENT_ENV_FILE
export AKL_RELEASE_VERIFY_ATTEMPTS=1
export AKL_RELEASE_VERIFY_DELAY_SECONDS=0

mkdir -p \
  "$WORK_REPO/scripts/lib" \
  "$WORK_REPO/infra/docker-compose" \
  "$WORK_REPO/services/registry-api" \
  "$WORK_REPO/services/ingestion-service" \
  "$WORK_REPO/services/rag-retrieval-service" \
  "$WORK_REPO/apps/web" \
  "$FAKE_BIN" \
  "${VERIFIED_BOOTSTRAP_RELEASE}/scripts/lib" \
  "${FAKE_RUNTIME_DIR}/images" \
  "${FAKE_RUNTIME_DIR}/containers" \
  "${AKL_RELEASE_ROOT}/env" \
  "${AKL_RELEASE_ROOT}/repo"

cp \
  "$SOURCE_ROOT/scripts/backup_registry_release.sh" \
  "$SOURCE_ROOT/scripts/bootstrap_docker_home_target.sh" \
  "$SOURCE_ROOT/scripts/check_registry_writable_primary.sh" \
  "$SOURCE_ROOT/scripts/cleanup_stale_release_env_snapshot.sh" \
  "$SOURCE_ROOT/scripts/cleanup_stale_release_postgres_credentials.sh" \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" \
  "$SOURCE_ROOT/scripts/prepare_docker_home_release.sh" \
  "$SOURCE_ROOT/scripts/rollback_docker_home_release.sh" \
  "$SOURCE_ROOT/scripts/verify_docker_home_release.sh" \
  "$WORK_REPO/scripts/"
cp "$SOURCE_ROOT/scripts/lib/immutable_release_common.sh" "$WORK_REPO/scripts/lib/"
chmod +x "$WORK_REPO/scripts/"*.sh
chmod 0700 "${AKL_RELEASE_ROOT}/env"
cp "$SOURCE_ROOT/scripts/prepare_docker_home_release.sh" \
  "${VERIFIED_BOOTSTRAP_RELEASE}/scripts/"
cp "$SOURCE_ROOT/scripts/lib/immutable_release_common.sh" \
  "${VERIFIED_BOOTSTRAP_RELEASE}/scripts/lib/"
chmod +x "${VERIFIED_BOOTSTRAP_RELEASE}/scripts/prepare_docker_home_release.sh"
chmod -R a-w "$VERIFIED_BOOTSTRAP_RELEASE"

cat >"$WORK_REPO/infra/docker-compose/docker-compose.docker-home.yml" <<'YAML'
name: ${AKL_RELEASE_COMPOSE_PROJECT}
services:
  registry-api:
    image: ${REGISTRY_API_IMAGE}
    environment:
      AKL_REGISTRY_AUTH_MODE: ${AKL_REGISTRY_AUTH_MODE:-keycloak}
  ingestion-service:
    image: ${INGESTION_SERVICE_IMAGE}
  rag-retrieval-service:
    image: ${RAG_RETRIEVAL_SERVICE_IMAGE}
  web:
    image: ${WEB_IMAGE}
  chat-web:
    image: ${CHAT_WEB_IMAGE}
YAML
printf 'registry-v1\n' >"$WORK_REPO/services/registry-api/release.txt"
printf 'FROM scratch\n' >"$WORK_REPO/services/ingestion-service/Dockerfile"
printf 'ingestion-v1\n' >"$WORK_REPO/services/ingestion-service/release.txt"
printf 'rag-v1\n' >"$WORK_REPO/services/rag-retrieval-service/release.txt"
printf 'web-v1\n' >"$WORK_REPO/apps/web/release.txt"

git -C "$WORK_REPO" init --initial-branch=main --quiet
git -C "$WORK_REPO" config user.name 'AKL release test'
git -C "$WORK_REPO" config user.email 'akl-release-test@example.invalid'
git -C "$WORK_REPO" add .
git -C "$WORK_REPO" commit --quiet -m 'initial release'
SHA_ONE="$(git -C "$WORK_REPO" rev-parse HEAD)"
git init --bare --quiet "$REMOTE_REPO"
git -C "$WORK_REPO" remote add origin "$REMOTE_REPO"
git -C "$WORK_REPO" push --quiet --set-upstream origin main
git --git-dir="$REMOTE_REPO" symbolic-ref HEAD refs/heads/main

cat >"$AKL_PROD_ENV_FILE" <<ENV
AKL_RELEASE_GIT_URL=${REMOTE_REPO}
AKL_RELEASE_TRUSTED_REF=refs/remotes/origin/main
AKL_RELEASE_COMPOSE_PROJECT=akl-test
AKL_RELEASE_EXPECTED_REGISTRY_DB_HOST=db.internal
AKL_RELEASE_EXPECTED_REGISTRY_DB_PORT=5432
AKL_RELEASE_EXPECTED_REGISTRY_DB_NAME=registry
AKL_RELEASE_EXPECTED_REGISTRY_DB_USER=release_user
AKL_RELEASE_POSTGRES_TOOL_IMAGE=${FAKE_POSTGRES_TOOL_IMAGE}
AKL_REGISTRY_DATABASE_URL=postgresql+psycopg://release_user:test_secret@db.internal:5432/registry
AKL_INGESTION_AUTHORIZATION_SECRET_FILE=${INGESTION_AUTHORIZATION_SECRET_FILE}
AKL_INGESTION_REGISTRY_CLIENT_SECRET_FILE=${INGESTION_REGISTRY_CLIENT_SECRET_FILE}
AKL_RAG_REGISTRY_CLIENT_SECRET_FILE=${RAG_REGISTRY_CLIENT_SECRET_FILE}
AKL_WEB_INGESTION_CLIENT_SECRET_FILE=${WEB_INGESTION_CLIENT_SECRET_FILE}
AKL_WEB_PUBLIC_BASE_URL=https://stratos.example.invalid/akb
AKL_CHAT_WEB_PUBLIC_BASE_URL=https://chat.example.invalid
AKL_CHAT_WEB_HTTP_PORT=18221
AKL_PROXY_HTTP_PORT=18080
ENV
chmod 0600 "$AKL_PROD_ENV_FILE"
printf 'fixture-ingestion-authorization-secret-0001\n' \
  >"$INGESTION_AUTHORIZATION_SECRET_FILE"
printf 'fixture-svc-ingestion-client-secret\n' \
  >"$INGESTION_REGISTRY_CLIENT_SECRET_FILE"
printf 'fixture-akb-rag-registry-client-secret\n' \
  >"$RAG_REGISTRY_CLIENT_SECRET_FILE"
printf 'fixture-akb-web-ingestion-client-secret\n' \
  >"$WEB_INGESTION_CLIENT_SECRET_FILE"
chmod 0600 \
  "$INGESTION_AUTHORIZATION_SECRET_FILE" \
  "$INGESTION_REGISTRY_CLIENT_SECRET_FILE" \
  "$RAG_REGISTRY_CLIENT_SECRET_FILE" \
  "$WEB_INGESTION_CLIENT_SECRET_FILE"
printf 'must remain untouched\n' >"${AKL_RELEASE_ROOT}/repo/sentinel"

set_env_value() {
  "$REAL_PYTHON3" - "$AKL_PROD_ENV_FILE" "$1" "$2" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2] + "="
replacement = key + sys.argv[3]
lines = path.read_text(encoding="utf-8").splitlines()
if sum(line.startswith(key) for line in lines) != 1:
    raise SystemExit(f"expected exactly one env key: {sys.argv[2]}")
path.write_text(
    "\n".join(replacement if line.startswith(key) else line for line in lines) + "\n",
    encoding="utf-8",
)
PY
  chmod 0600 "$AKL_PROD_ENV_FILE"
}

cat >"$FAKE_BIN/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
{
  printf 'docker'
  printf '\t%s' "$@"
  printf '\n'
} >>"$CALL_LOG"

image_ref_for_service() {
  case "$1" in
    registry-api) printf '%s\n' "$REGISTRY_API_IMAGE" ;;
    ingestion-service) printf '%s\n' "$INGESTION_SERVICE_IMAGE" ;;
    rag-retrieval-service) printf '%s\n' "$RAG_RETRIEVAL_SERVICE_IMAGE" ;;
    web) printf '%s\n' "$WEB_IMAGE" ;;
    chat-web) printf '%s\n' "$CHAT_WEB_IMAGE" ;;
    *) return 1 ;;
  esac
}

service_for_image_ref() {
  local ref="$1"
  local service
  for service in registry-api ingestion-service rag-retrieval-service web chat-web; do
    if [[ "$(image_ref_for_service "$service")" == "$ref" ]]; then
      printf '%s\n' "$service"
      return 0
    fi
  done
  return 1
}

write_image_state() {
  local service="$1"
  local state_dir="${FAKE_RUNTIME_DIR}/images/${service}"
  local ref digest revision project
  ref="$(image_ref_for_service "$service")"
  digest="$(printf '%s' "$ref" | sha256sum | awk '{print $1}')"
  revision="$AKL_SERVICE_VERSION"
  project="akl-test"
  if [[ "${FAKE_IMAGE_LABEL_MISMATCH_SERVICE:-}" == "$service" ]]; then
    revision="mismatched-revision"
  fi
  mkdir -p "$state_dir"
  printf '%s\n' "$ref" >"${state_dir}/ref"
  printf 'sha256:%s\n' "$digest" >"${state_dir}/id"
  printf '%s\n' "$revision" >"${state_dir}/revision"
  printf '%s\n' "$project" >"${state_dir}/project"
  printf '%s\n' "$service" >"${state_dir}/service"
}

container_service_for_id() {
  local requested_id="$1"
  local service state_dir
  for service in registry-api ingestion-service rag-retrieval-service web chat-web; do
    state_dir="${FAKE_RUNTIME_DIR}/containers/${service}"
    if [[ -f "${state_dir}/id" && "$(<"${state_dir}/id")" == "$requested_id" ]]; then
      printf '%s\n' "$service"
      return 0
    fi
  done
  return 1
}

write_container_state() {
  local service="$1"
  local compose_file="$2"
  local image_dir="${FAKE_RUNTIME_DIR}/images/${service}"
  local state_dir="${FAKE_RUNTIME_DIR}/containers/${service}"
  local execution_ref image_id revision project
  [[ -d "$image_dir" ]]
  execution_ref="$(image_ref_for_service "$service")"
  if [[ "$execution_ref" == sha256:* ]]; then
    image_id="$execution_ref"
  else
    image_id="$(<"${image_dir}/id")"
  fi
  revision="$AKL_SERVICE_VERSION"
  project="akl-test"
  if [[ "${FAKE_CONTAINER_IMAGE_MISMATCH_SERVICE:-}" == "$service" ]]; then
    image_id="sha256:$(printf '0%.0s' {1..64})"
  fi
  if [[ "${FAKE_CONTAINER_LABEL_MISMATCH_SERVICE:-}" == "$service" ]]; then
    revision="mismatched-revision"
  fi
  mkdir -p "$state_dir"
  printf 'akl-test-%s-1\n' "$service" >"${state_dir}/id"
  printf 'true\n' >"${state_dir}/running"
  printf 'false\n' >"${state_dir}/restarting"
  printf '%s\n' "$execution_ref" >"${state_dir}/image_ref"
  printf '%s\n' "$image_id" >"${state_dir}/image_id"
  printf 'akl-test\n' >"${state_dir}/compose_project"
  printf '%s\n' "$service" >"${state_dir}/compose_service"
  printf 'False\n' >"${state_dir}/compose_oneoff"
  printf '%s\n' "$compose_file" >"${state_dir}/compose_config_files"
  printf '%s' "$service" | sha256sum | awk '{print $1}' >"${state_dir}/compose_config_hash"
  printf '%s\n' "$revision" >"${state_dir}/revision"
  printf '%s\n' "$project" >"${state_dir}/project"
  printf 'container_execution:%s:%s:%s\n' \
    "$service" "$execution_ref" "$image_id" >>"$CALL_LOG"
  if [[ "$service" == "web" ]]; then
    printf '%s\n' "$AKL_SERVICE_VERSION" >"$FAKE_WEB_STATE"
  fi
}

if [[ "${1-}" == "image" && "${2-}" == "inspect" ]]; then
  shift 2
  format=""
  if [[ "${1-}" == "--format" ]]; then
    format="$2"
    shift 2
  fi
  ref="${1-}"
  if [[ "$ref" == "$FAKE_POSTGRES_TOOL_IMAGE" || "$ref" == "$FAKE_POSTGRES_TOOL_IMAGE_ID" ]]; then
    [[ "${FAKE_POSTGRES_TOOL_IMAGE_MISSING:-false}" != "true" ]] || exit 1
    case "$format" in
      '') printf '{}\n' ;;
      '{{.Id}}') printf '%s\n' "$FAKE_POSTGRES_TOOL_IMAGE_ID" ;;
      '{{json .RepoDigests}}')
        if [[ "${FAKE_POSTGRES_TOOL_REPO_MISMATCH:-false}" == "true" ]]; then
          printf '["example.invalid/postgres@sha256:%s"]\n' "$(printf 'a%.0s' {1..64})"
        else
          printf '["%s"]\n' "$FAKE_POSTGRES_TOOL_REPO_DIGEST"
        fi
        ;;
      *) exit 90 ;;
    esac
    exit 0
  fi
  if [[ -z "$format" && "${FAKE_EXISTING_IMAGE:-}" == "$ref" ]]; then
    exit 0
  fi
  service="$(service_for_image_ref "$ref")" || exit 1
  state_dir="${FAKE_RUNTIME_DIR}/images/${service}"
  [[ -d "$state_dir" && "$(<"${state_dir}/ref")" == "$ref" ]] || exit 1
  if [[ -n "${FAKE_IMAGE_RETARGET_PHASE:-}" \
    && "${FAKE_IMAGE_RETARGET_PHASE}" == "${AKL_RELEASE_IMAGE_VERIFY_PHASE:-}" \
    && ! -e "${FAKE_RUNTIME_DIR}/fault-image-retarget-${AKL_RELEASE_IMAGE_VERIFY_PHASE}" ]]; then
    : >"${FAKE_RUNTIME_DIR}/fault-image-retarget-${AKL_RELEASE_IMAGE_VERIFY_PHASE}"
    printf 'sha256:%s\n' "$(printf 'd%.0s' {1..64})" >"${state_dir}/id"
    printf 'fault:image-retarget:%s:%s\n' "$AKL_RELEASE_IMAGE_VERIFY_PHASE" "$service" >>"$CALL_LOG"
  fi
  if [[ -n "${FAKE_IMAGE_MISSING_PHASE:-}" \
    && "${FAKE_IMAGE_MISSING_PHASE}" == "${AKL_RELEASE_IMAGE_VERIFY_PHASE:-}" ]]; then
    printf 'fault:image-missing:%s:%s\n' "$AKL_RELEASE_IMAGE_VERIFY_PHASE" "$service" >>"$CALL_LOG"
    exit 1
  fi
  case "$format" in
    '') printf '{}\n' ;;
    '{{.Id}}') cat "${state_dir}/id" ;;
    '{{json .RepoTags}}') printf '["%s"]\n' "$ref" ;;
    '{{index .Config.Labels "org.opencontainers.image.revision"}}') cat "${state_dir}/revision" ;;
    '{{index .Config.Labels "cz.zeleznalady.akl.compose-project"}}') cat "${state_dir}/project" ;;
    '{{index .Config.Labels "cz.zeleznalady.akl.service"}}') cat "${state_dir}/service" ;;
    *) exit 90 ;;
  esac
  exit 0
fi

if [[ "${1-}" == "context" && "${2-}" == "show" ]]; then
  printf 'default\n'
  exit 0
fi
if [[ "${1-}" == "context" && "${2-}" == "inspect" \
  && "${3-}" == "default" && "${4-}" == "--format" \
  && "${5-}" == '{{.Endpoints.docker.Host}}' ]]; then
  printf 'unix:///var/run/docker.sock\n'
  exit 0
fi

if [[ "${1-}" == "run" ]]; then
  shift
  original_arguments="$*"
  [[ " $original_arguments " == *" --rm "* ]]
  [[ " $original_arguments " == *" --pull never "* ]]
  [[ " $original_arguments " == *" --network host "* ]]
  [[ " $original_arguments " == *" --read-only "* ]]
  [[ " $original_arguments " == *" --cap-drop ALL "* ]]
  [[ " $original_arguments " == *" --security-opt no-new-privileges "* ]]

  mounts=()
  image_reference=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --rm|--read-only)
        shift
        ;;
      --pull|--network|--cap-drop|--security-opt|--user|--tmpfs|--env)
        [[ $# -ge 2 ]]
        if [[ "$1" == "--env" && "$2" == *test_secret* ]]; then
          exit 89
        fi
        shift 2
        ;;
      --mount)
        [[ $# -ge 2 ]]
        mounts+=("$2")
        shift 2
        ;;
      "$FAKE_POSTGRES_TOOL_IMAGE"|"$FAKE_POSTGRES_TOOL_IMAGE_ID")
        image_reference="$1"
        shift
        break
        ;;
      *) exit 88 ;;
    esac
  done
  [[ -n "$image_reference" && "${FAKE_POSTGRES_TOOL_IMAGE_MISSING:-false}" != "true" ]]
  tool_name="${1-}"
  shift || true

  pgpass_mount=""
  backup_mount=""
  backup_mount_readonly="false"
  for mount_spec in "${mounts[@]}"; do
    case "$mount_spec" in
      type=bind,src=*,dst=/run/secrets/akl-pgpass,readonly)
        pgpass_mount="${mount_spec#type=bind,src=}"
        pgpass_mount="${pgpass_mount%,dst=/run/secrets/akl-pgpass,readonly}"
        [[ -f "$pgpass_mount" ]]
        [[ "$("$REAL_PYTHON3" - "$pgpass_mount" <<'PY'
import os
import stat
import sys
print(f"{stat.S_IMODE(os.stat(sys.argv[1]).st_mode):03o}")
PY
)" == "600" ]]
        grep -Fq 'test_secret' "$pgpass_mount"
        ;;
      type=bind,src=*,dst=/backup)
        backup_mount="${mount_spec#type=bind,src=}"
        backup_mount="${backup_mount%,dst=/backup}"
        [[ -d "$backup_mount" ]]
        ;;
      type=bind,src=*,dst=/backup,readonly)
        backup_mount="${mount_spec#type=bind,src=}"
        backup_mount="${backup_mount%,dst=/backup,readonly}"
        backup_mount_readonly="true"
        [[ -d "$backup_mount" ]]
        ;;
      *) exit 87 ;;
    esac
  done

  case "$tool_name" in
    psql)
      if [[ "${1-}" == "--version" ]]; then
        [[ ${#mounts[@]} -eq 0 ]]
        printf 'psql (PostgreSQL) 17.5\n'
      else
        [[ -n "$pgpass_mount" && -z "$backup_mount" && ${#mounts[@]} -eq 1 ]]
        printf 'postgres_tool:psql\n' >>"$CALL_LOG"
        actual_database="${FAKE_POSTGRES_ACTUAL_DATABASE:-registry}"
        actual_user="${FAKE_POSTGRES_ACTUAL_USER:-release_user}"
        if [[ " $* " == *" pg_is_in_recovery()"* ]]; then
          gate_phase="${PGAPPNAME#akl-release-writable-primary-}"
          if [[ "${FAKE_KILL_PRIMARY_GATE_PHASE:-}" == "$gate_phase" ]]; then
            [[ "${FAKE_PRIMARY_GATE_PID:-}" =~ ^[1-9][0-9]*$ ]]
            printf 'fault:sigkill-primary-gate:%s\n' "$gate_phase" >>"$CALL_LOG"
            kill -KILL "$FAKE_PRIMARY_GATE_PID"
            exit 137
          fi
          gate_mode="writable"
          if [[ "${FAKE_POSTGRES_PRIMARY_GATE_PHASE:-}" == "$gate_phase" ]]; then
            gate_mode="${FAKE_POSTGRES_PRIMARY_GATE_MODE:-writable}"
          fi
          case "$gate_mode" in
            writable) gate_state='off|f' ;;
            read-only) gate_state='on|f' ;;
            recovery) gate_state='off|t' ;;
            *) exit 85 ;;
          esac
          printf 'postgres_primary_gate:%s:%s\n' "$gate_phase" "$gate_state" >>"$CALL_LOG"
          printf '%s|%s|%s|10.0.0.21|5432\n' "$gate_state" "$actual_database" "$actual_user"
        elif [[ " $* " == *" current_database()"* ]]; then
          printf 'postgres_backend_identity:%s:%s\n' "$actual_database" "$actual_user" >>"$CALL_LOG"
          printf '%s|%s|10.0.0.21|5432\n' "$actual_database" "$actual_user"
        elif [[ " $* " == *" alembic_version "* \
          && "${FAKE_ALEMBIC_MULTI_HEAD_BEFORE:-false}" == "true" ]]; then
          printf '0013_information_policy_v2\n0014_parallel_branch\n'
        elif [[ " $* " == *"COUNT(*) FROM documents)"* ]]; then
          printf '3|5|7|3|11\n'
        elif [[ -f "$FAKE_ALEMBIC_STATE" ]]; then
          cat "$FAKE_ALEMBIC_STATE"
        else
          printf '0013_information_policy_v2\n'
        fi
      fi
      ;;
    pg_dump)
      if [[ "${1-}" == "--version" ]]; then
        [[ ${#mounts[@]} -eq 0 ]]
        printf 'pg_dump (PostgreSQL) 17.5\n'
      else
        [[ -n "$pgpass_mount" && -n "$backup_mount" \
          && "$backup_mount_readonly" == "false" && ${#mounts[@]} -eq 2 ]]
        printf 'postgres_tool:pg_dump\n' >>"$CALL_LOG"
        registry_running="${FAKE_RUNTIME_DIR}/containers/registry-api/running"
        if [[ -f "$registry_running" && "$(<"$registry_running")" == "true" ]]; then
          printf 'Registry writer was not quiesced before pg_dump.\n' >&2
          exit 98
        fi
        [[ "${FAKE_PG_DUMP_FAIL:-false}" != "true" ]] || exit 99
        [[ " $* " == *" --file=/backup/registry.dump "* ]]
        printf 'PGDMPmock-registry-backup\n' >"${backup_mount}/registry.dump"
      fi
      ;;
    pg_restore)
      if [[ "${1-}" == "--version" ]]; then
        [[ ${#mounts[@]} -eq 0 ]]
        printf 'pg_restore (PostgreSQL) 17.5\n'
      else
        [[ -z "$pgpass_mount" && -n "$backup_mount" \
          && "$backup_mount_readonly" == "true" && ${#mounts[@]} -eq 1 ]]
        [[ "${1-}" == "--list" && "${2-}" == "/backup/registry.dump" ]]
        [[ -s "${backup_mount}/registry.dump" ]]
        printf 'postgres_tool:pg_restore\n' >>"$CALL_LOG"
        printf '; mock custom archive\n1; 0 0 TABLE public documents release_user\n'
      fi
      ;;
    *) exit 86 ;;
  esac
  exit 0
fi

if [[ "${1-}" == "inspect" ]]; then
  shift
  [[ "${1-}" == "--format" ]]
  format="$2"
  requested_id="$3"
  service="$(container_service_for_id "$requested_id")" || exit 1
  state_dir="${FAKE_RUNTIME_DIR}/containers/${service}"
  case "$format" in
    '{{.State.Running}}') cat "${state_dir}/running" ;;
    '{{.State.Restarting}}')
      [[ ! -f "${state_dir}/restarting" ]] || cat "${state_dir}/restarting"
      [[ -f "${state_dir}/restarting" ]] || printf 'false\n'
      ;;
    '{{.State.Status}}')
      if [[ -f "${state_dir}/restarting" && "$(<"${state_dir}/restarting")" == "true" ]]; then
        printf 'restarting\n'
      elif [[ "$(<"${state_dir}/running")" == "true" ]]; then
        printf 'running\n'
      else
        printf 'exited\n'
      fi
      ;;
    '{{.Config.Image}}') cat "${state_dir}/image_ref" ;;
    '{{.Image}}') cat "${state_dir}/image_id" ;;
    '{{index .Config.Labels "com.docker.compose.project"}}') cat "${state_dir}/compose_project" ;;
    '{{index .Config.Labels "com.docker.compose.service"}}') cat "${state_dir}/compose_service" ;;
    '{{index .Config.Labels "com.docker.compose.oneoff"}}') cat "${state_dir}/compose_oneoff" ;;
    '{{index .Config.Labels "com.docker.compose.project.config_files"}}') cat "${state_dir}/compose_config_files" ;;
    '{{index .Config.Labels "com.docker.compose.config-hash"}}') cat "${state_dir}/compose_config_hash" ;;
    '{{index .Config.Labels "org.opencontainers.image.revision"}}') cat "${state_dir}/revision" ;;
    '{{index .Config.Labels "cz.zeleznalady.akl.compose-project"}}') cat "${state_dir}/project" ;;
    '{{index .Config.Labels "cz.zeleznalady.akl.service"}}') cat "${state_dir}/compose_service" ;;
    *) exit 90 ;;
  esac
  exit 0
fi

if [[ "${1-}" == "start" ]]; then
  service="$(container_service_for_id "${2-}")" || exit 1
  printf 'true\n' >"${FAKE_RUNTIME_DIR}/containers/${service}/running"
  printf 'false\n' >"${FAKE_RUNTIME_DIR}/containers/${service}/restarting"
  printf 'docker_start:%s\n' "${2-}" >>"$CALL_LOG"
  printf '%s\n' "${2-}"
  exit 0
fi

if [[ "${1-}" == "rm" && "${2-}" == "--force" ]]; then
  requested_id="${3-}"
  service="$(container_service_for_id "$requested_id")" || exit 1
  if [[ "${FAKE_DOCKER_RM_FAIL_SERVICE:-}" == "$service" ]]; then
    printf 'fault:docker-rm:%s:%s\n' "$service" "$requested_id" >>"$CALL_LOG"
    exit 97
  fi
  rm -rf "${FAKE_RUNTIME_DIR}/containers/${service}"
  printf 'docker_rm:%s:%s\n' "$service" "$requested_id" >>"$CALL_LOG"
  printf '%s\n' "$requested_id"
  exit 0
fi

if [[ "${1-}" == "ps" ]]; then
  shift
  include_all="false"
  if [[ "${1-}" == "-a" ]]; then
    include_all="true"
    shift
  fi
  [[ "${1-}" == "--no-trunc" ]]
  shift
  [[ "${1-}" == "--filter" && "${2-}" == "label=com.docker.compose.project=akl-test" ]]
  shift 2
  [[ "${1-}" == "--filter" && "${2-}" == label=com.docker.compose.service=* ]]
  service="${2#label=com.docker.compose.service=}"
  shift 2
  [[ "${1-}" == "--format" && "${2-}" == '{{.ID}}' && $# -eq 2 ]]
  case "$service" in
    registry-api|ingestion-service|rag-retrieval-service|web|chat-web) ;;
    *) exit 98 ;;
  esac
  if [[ "$service" == "registry-api" \
    && -n "${FAKE_EXTERNAL_REGISTRY_RESTART_PHASE:-}" \
    && "${FAKE_EXTERNAL_REGISTRY_RESTART_PHASE}" == "${AKL_RELEASE_QUIESCE_CHECK_PHASE:-}" ]]; then
    printf 'true\n' >"${FAKE_RUNTIME_DIR}/containers/registry-api/running"
    printf 'false\n' >"${FAKE_RUNTIME_DIR}/containers/registry-api/restarting"
    printf 'fault:external-registry-restart:%s\n' "$AKL_RELEASE_QUIESCE_CHECK_PHASE" >>"$CALL_LOG"
  fi
  state_dir="${FAKE_RUNTIME_DIR}/containers/${service}"
  if [[ "$include_all" == "true" && -f "${state_dir}/id" ]]; then
    cat "${state_dir}/id"
  elif [[ -f "${state_dir}/running" && "$(<"${state_dir}/running")" == "true" ]]; then
    cat "${state_dir}/id"
  fi
  exit 0
fi

if [[ "${1-}" == "exec" ]]; then
  if [[ $# -eq 5 ]]; then
    requested_id="${2-}"
    service="$(container_service_for_id "$requested_id")" || exit 1
    [[ "$service" == "ingestion-service" \
      && "${3-}" == "python" \
      && "${4-}" == "-m" \
      && "${5-}" == "app.readiness_probe" ]] || exit 98
    printf 'docker_exec_readiness:ingestion-service\n' >>"$CALL_LOG"
    [[ "${FAKE_INGESTION_READINESS_FAIL:-false}" != "true" ]] || exit 1
    exit 0
  fi
  if [[ $# -eq 7 \
    && "${2-}" == "--user" \
    && "${3-}" == "nextjs" \
    && "${4-}" == "-i" \
    && "${6-}" == "node" \
    && "${7-}" == "-" ]]; then
    requested_id="${5-}"
    service="$(container_service_for_id "$requested_id")" || exit 1
    [[ "$service" == "web" ]] || exit 98
    printf 'docker_exec_readiness:web-ingestion-transport:nextjs\n' >>"$CALL_LOG"
    [[ "${FAKE_WEB_INGESTION_TRANSPORT_READINESS_FAIL:-false}" != "true" ]] || exit 1
    exit 0
  fi
  exit 98
fi

if [[ "${1-}" == "build" ]]; then
  shift
  pull_seen="false"
  revision_label=""
  project_label=""
  service_label=""
  target_ref=""
  dockerfile=""
  context=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --pull=false)
        pull_seen="true"
        shift
        ;;
      --label)
        case "${2-}" in
          org.opencontainers.image.revision=*) revision_label="${2#*=}" ;;
          cz.zeleznalady.akl.compose-project=*) project_label="${2#*=}" ;;
          cz.zeleznalady.akl.service=*) service_label="${2#*=}" ;;
          *) exit 98 ;;
        esac
        shift 2
        ;;
      --tag)
        target_ref="${2-}"
        shift 2
        ;;
      --file)
        dockerfile="${2-}"
        shift 2
        ;;
      *)
        [[ -z "$context" && $# -eq 1 ]] || exit 98
        context="$1"
        shift
        ;;
    esac
  done
  [[ "$pull_seen" == "true" \
    && "$revision_label" == "$AKL_SERVICE_VERSION" \
    && "$project_label" == "akl-test" \
    && "$service_label" == "ingestion-service" \
    && "$target_ref" == "$INGESTION_SERVICE_IMAGE" \
    && "$dockerfile" == "${context}/Dockerfile" \
    && "$context" == "${AKL_RELEASE_ROOT}/releases/${AKL_SERVICE_VERSION}/services/ingestion-service" \
    && -f "$dockerfile" ]] || exit 98
  printf 'build:ingestion-service\n' >>"$CALL_LOG"
  if [[ "${FAKE_BUILD_FAIL_BEFORE_TAG:-false}" == "true" ]]; then
    printf 'fault:build-before-tag\n' >>"$CALL_LOG"
    exit 84
  fi
  write_image_state ingestion-service
  exit 0
fi

[[ "${1-}" == "compose" ]] || exit 91
shift
[[ "${1-}" == "--project-name" && "${2-}" == "akl-test" ]] || exit 92
shift 2
[[ "${1-}" == "--env-file" && "${2-}" == "$AKL_PROD_ENV_FILE" ]] || {
  printf 'fake compose did not receive the active env snapshot path\n' >&2
  exit 93
}
compose_env_file="$2"
[[ "$compose_env_file" != "$FAKE_PERSISTENT_ENV_FILE" ]] || {
  printf 'fake compose received the mutable persistent env path\n' >&2
  exit 93
}
[[ "$compose_env_file" != /dev/fd/* ]] || {
  printf 'fake compose received a non-reopenable descriptor env path\n' >&2
  exit 93
}
snapshot_identity="$("$REAL_PYTHON3" - "$compose_env_file" <<'PY'
import os
import stat
import sys
from pathlib import Path

path = Path(sys.argv[1])
directory = path.parent
root = directory.parent
path_stat = path.lstat()
directory_stat = directory.lstat()
root_stat = root.lstat()
if (
    path.is_symlink()
    or not stat.S_ISREG(path_stat.st_mode)
    or path_stat.st_nlink != 1
    or path_stat.st_uid != os.geteuid()
    or stat.S_IMODE(path_stat.st_mode) != 0o600
):
    raise SystemExit("fake compose env snapshot file identity is invalid")
if (
    directory.is_symlink()
    or not stat.S_ISDIR(directory_stat.st_mode)
    or directory_stat.st_uid != os.geteuid()
    or stat.S_IMODE(directory_stat.st_mode) != 0o700
):
    raise SystemExit("fake compose env snapshot directory identity is invalid")
if (
    root.is_symlink()
    or not stat.S_ISDIR(root_stat.st_mode)
    or root_stat.st_uid != os.geteuid()
    or stat.S_IMODE(root_stat.st_mode) != 0o700
    or len({path_stat.st_dev, directory_stat.st_dev, root_stat.st_dev}) != 1
):
    raise SystemExit("fake compose env snapshot root identity or filesystem is invalid")
fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
try:
    opened_stat = os.fstat(fd)
finally:
    os.close(fd)
if (opened_stat.st_dev, opened_stat.st_ino) != (path_stat.st_dev, path_stat.st_ino):
    raise SystemExit("fake compose env snapshot changed while opened")
print(f"{stat.S_IMODE(opened_stat.st_mode):03o}:{opened_stat.st_nlink}")
PY
)"
[[ "$snapshot_identity" == "600:1" ]] || {
  printf 'fake compose env snapshot is not linked mode 0600 (identity=%s)\n' "$snapshot_identity" >&2
  exit 93
}
shift 2
[[ "${1-}" == "-f" && "${2-}" == "${AKL_RELEASE_ROOT}/releases/"* ]] || exit 94
compose_file="$2"
shift 2

command_name="${1-}"
shift || true
case "$command_name" in
  config)
    [[ "${1-}" == "--quiet" ]]
    ;;
  build)
    printf 'build:%s\n' "$*" >>"$CALL_LOG"
    if [[ "${FAKE_BUILD_FAIL_BEFORE_TAG:-false}" == "true" ]]; then
      printf 'fault:build-before-tag\n' >>"$CALL_LOG"
      exit 84
    fi
    for service in "$@"; do
      write_image_state "$service"
    done
    ;;
  up)
    [[ " $* " == *" --pull never "* && " $* " == *" --no-build "* ]]
    printf 'up:%s\n' "$*" >>"$CALL_LOG"
    for argument in "$@"; do
      case "$argument" in
        registry-api|ingestion-service|rag-retrieval-service|web|chat-web)
          if [[ "${FAKE_IMAGE_RETARGET_DURING_UP_SERVICE:-}" == "$argument" \
            && ! -e "${FAKE_RUNTIME_DIR}/fault-image-retarget-during-up" ]]; then
            : >"${FAKE_RUNTIME_DIR}/fault-image-retarget-during-up"
            printf 'sha256:%s\n' "$(printf 'd%.0s' {1..64})" \
              >"${FAKE_RUNTIME_DIR}/images/${argument}/id"
            printf 'fault:image-retarget-during-up:%s\n' "$argument" >>"$CALL_LOG"
          fi
          write_container_state "$argument" "$compose_file"
          if [[ "${FAKE_COMPOSE_UP_FAIL_AFTER_SERVICE:-}" == "$argument" ]]; then
            printf 'fault:compose-up-after:%s\n' "$argument" >>"$CALL_LOG"
            exit 83
          fi
          ;;
      esac
    done
    ;;
  stop)
    [[ "${1-}" == "--timeout" && "${2-}" == "30" && "${3-}" == "registry-api" ]]
    printf 'false\n' >"${FAKE_RUNTIME_DIR}/containers/registry-api/running"
    printf 'false\n' >"${FAKE_RUNTIME_DIR}/containers/registry-api/restarting"
    printf 'registry_stop\n' >>"$CALL_LOG"
    if [[ "${FAKE_KILL_DURING_REGISTRY_STOP:-false}" == "true" ]]; then
      printf 'fault:sigkill-during-registry-stop\n' >>"$CALL_LOG"
      kill -KILL "$PPID"
    fi
    ;;
  ps)
    case "$*" in
      '--status running --services')
        for service in registry-api ingestion-service rag-retrieval-service web chat-web; do
          state_dir="${FAKE_RUNTIME_DIR}/containers/${service}"
          if [[ -f "${state_dir}/running" && "$(<"${state_dir}/running")" == "true" ]]; then
            printf '%s\n' "$service"
          fi
        done
        ;;
      '-q registry-api'|'-q ingestion-service'|'-q rag-retrieval-service'|'-q web'|'-q chat-web')
        service="${2-}"
        state_dir="${FAKE_RUNTIME_DIR}/containers/${service}"
        [[ ! -f "${state_dir}/id" ]] || cat "${state_dir}/id"
        ;;
      '--status running -q registry-api')
        state_dir="${FAKE_RUNTIME_DIR}/containers/registry-api"
        if [[ -f "${state_dir}/running" && "$(<"${state_dir}/running")" == "true" ]]; then
          cat "${state_dir}/id"
        fi
        ;;
      *) exit 96 ;;
    esac
    ;;
  run)
    [[ "${1-}" == "--rm" && "${2-}" == "--pull" \
      && "${3-}" == "never" && "${4-}" == "--no-deps" ]]
    shift 4
    [[ "${1-}" == "registry-api" && "${2-}" == "alembic" ]]
    shift 2
    registry_execution_ref="$(image_ref_for_service registry-api)"
    [[ "$registry_execution_ref" == sha256:* ]]
    printf 'compose_run_execution:registry-api:%s:%s\n' \
      "${1-}" "$registry_execution_ref" >>"$CALL_LOG"
    if [[ "${FAKE_IMAGE_RETARGET_BEFORE_COMPOSE_RUN_PHASE:-}" == "${1-}" \
      && ! -e "${FAKE_RUNTIME_DIR}/fault-image-retarget-before-compose-run-${1-}" ]]; then
      : >"${FAKE_RUNTIME_DIR}/fault-image-retarget-before-compose-run-${1-}"
      printf 'sha256:%s\n' "$(printf 'c%.0s' {1..64})" \
        >"${FAKE_RUNTIME_DIR}/images/registry-api/id"
      printf 'fault:image-retarget-before-compose-run:%s:%s\n' \
        "${1-}" "$registry_execution_ref" >>"$CALL_LOG"
    fi
    case "${1-}" in
      heads)
        if [[ "${FAKE_ALEMBIC_MULTI_HEAD_TARGET:-false}" == "true" ]]; then
          printf '0016_public_audit_aggregation (head)\n0017_parallel_branch (head)\n'
        else
          printf '0016_public_audit_aggregation (head)\n'
        fi
        ;;
      upgrade)
        [[ "${2-}" == "head" ]]
        if [[ "${FAKE_REPLACE_PERSISTENT_ENV_BEFORE_ALEMBIC:-false}" == "true" \
          && ! -e "${FAKE_RUNTIME_DIR}/fault-persistent-env-replaced" ]]; then
          : >"${FAKE_RUNTIME_DIR}/fault-persistent-env-replaced"
          "$REAL_PYTHON3" - "$FAKE_PERSISTENT_ENV_FILE" <<'PY'
import os
import sys
from pathlib import Path

path = Path(sys.argv[1])
replacements = {
    "AKL_RELEASE_EXPECTED_REGISTRY_DB_HOST": "wrong-db.internal",
    "AKL_RELEASE_EXPECTED_REGISTRY_DB_PORT": "6432",
    "AKL_RELEASE_EXPECTED_REGISTRY_DB_NAME": "wrong_registry",
    "AKL_RELEASE_EXPECTED_REGISTRY_DB_USER": "wrong_user",
    "AKL_REGISTRY_DATABASE_URL": "postgresql+psycopg://wrong_user:test_secret@wrong-db.internal:6432/wrong_registry",
}
lines = path.read_text(encoding="utf-8").splitlines()
updated = []
seen = set()
for line in lines:
    key = line.split("=", 1)[0] if "=" in line else ""
    if key in replacements:
        updated.append(f"{key}={replacements[key]}")
        seen.add(key)
    else:
        updated.append(line)
if seen != set(replacements):
    raise SystemExit("persistent env replacement fixture did not find every required key")
temporary = path.with_name(path.name + ".fault.tmp")
fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
try:
    os.write(fd, ("\n".join(updated) + "\n").encode())
    os.fsync(fd)
finally:
    os.close(fd)
os.replace(temporary, path)
directory_fd = os.open(path.parent, os.O_RDONLY)
try:
    os.fsync(directory_fd)
finally:
    os.close(directory_fd)
PY
          printf 'fault:persistent-env-replaced-before-alembic\n' >>"$CALL_LOG"
        fi
        grep -Fq 'AKL_REGISTRY_DATABASE_URL=postgresql+psycopg://release_user:test_secret@db.internal:5432/registry' \
          "$compose_env_file"
        printf '0016_public_audit_aggregation\n' >"$FAKE_ALEMBIC_STATE"
        printf 'alembic_upgrade\n' >>"$CALL_LOG"
        ;;
      current)
        if [[ "${FAKE_ALEMBIC_MULTI_HEAD_POST:-false}" == "true" ]]; then
          printf 'alembic_current_multi_head\n' >>"$CALL_LOG"
          printf '0016_public_audit_aggregation (head)\n0017_parallel_branch (head)\n'
        elif [[ -f "$FAKE_ALEMBIC_STATE" ]]; then
          printf '%s (head)\n' "$(tr -d '[:space:]' <"$FAKE_ALEMBIC_STATE")"
        else
          printf '0013_information_policy_v2\n'
        fi
        ;;
      *) exit 95 ;;
    esac
    ;;
  *) exit 96 ;;
esac
SH

cat >"$FAKE_BIN/psql" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'host_postgres_tool_invoked:psql\n' >>"$CALL_LOG"
exit 127
SH

cat >"$FAKE_BIN/pg_dump" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'host_postgres_tool_invoked:pg_dump\n' >>"$CALL_LOG"
exit 127
SH

cat >"$FAKE_BIN/pg_restore" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'host_postgres_tool_invoked:pg_restore\n' >>"$CALL_LOG"
exit 127
SH

cat >"$FAKE_BIN/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1-}" == "--disable" ]]
shift
output_file=""
header_file=""
write_out=""
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      output_file="$2"
      shift 2
      ;;
    --write-out)
      write_out="$2"
      shift 2
      ;;
    --dump-header)
      header_file="$2"
      shift 2
      ;;
    --retry|--retry-delay|--noproxy)
      shift 2
      ;;
    --fail|--silent|--show-error|--retry-all-errors)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done
[[ -n "$url" ]]
printf 'curl\t%s\n' "$url" >>"$CALL_LOG"
if [[ "${FAKE_CURL_FAIL_READY:-false}" == "true" && "$url" == */ready ]]; then
  exit 22
fi
if [[ -n "${FAKE_IMAGE_RETARGET_DURING_SMOKE_SERVICE:-}" \
  && "$url" == */api/public/documents/* \
  && ! -e "${FAKE_RUNTIME_DIR}/fault-image-retarget-during-smoke" ]]; then
  service="$FAKE_IMAGE_RETARGET_DURING_SMOKE_SERVICE"
  case "$service" in
    registry-api|ingestion-service|rag-retrieval-service|web|chat-web) ;;
    *) exit 98 ;;
  esac
  : >"${FAKE_RUNTIME_DIR}/fault-image-retarget-during-smoke"
  replacement_id="sha256:$(printf 'e%.0s' {1..64})"
  printf '%s\n' "$replacement_id" >"${FAKE_RUNTIME_DIR}/images/${service}/id"
  printf 'fault:image-retarget-during-smoke:%s\n' "$service" >>"$CALL_LOG"
fi
if [[ "$url" == */api/public/documents/* ]]; then
  [[ -n "$output_file" && -n "$header_file" && "$write_out" == '%{http_code}' ]]
  printf 'HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n' >"$header_file"
  printf '{"error":{"code":"PUBLIC_DOCUMENT_UNAVAILABLE","message":"The public document is unavailable."}}\n' >"$output_file"
  printf '404'
elif [[ "$url" == */manifest.webmanifest ]]; then
  printf '{"name":"AKB Chat","scope":"/","start_url":"/"}\n' >"$output_file"
elif [[ "$url" == */api/documents ]]; then
  [[ -n "$output_file" && "$write_out" == '%{http_code}' ]]
  printf '{"error":{"code":"CHAT_PROFILE_ROUTE_FORBIDDEN"}}\n' >"$output_file"
  printf '403'
elif [[ "$url" == */health ]]; then
  health_version="$AKL_SERVICE_VERSION"
  if [[ "$url" == */akb/api/health && -f "$FAKE_WEB_STATE" ]]; then
    health_version="$(tr -d '[:space:]' <"$FAKE_WEB_STATE")"
  fi
  printf '{"status":"ok","version":"%s"}\n' "$health_version" >"$output_file"
elif [[ "$url" == */ready ]]; then
  printf '{"status":"ready"}\n' >"$output_file"
else
  exit 97
fi
SH

cat >"$FAKE_BIN/python3" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1-}" != "-" ]]; then
  exec "$REAL_PYTHON3" "$@"
fi

script_file="$(mktemp "${TMPDIR:-/tmp}/akl-fake-python.XXXXXX")"
trap 'rm -f "$script_file"' EXIT
cat >"$script_file"
shift

event=""
if grep -q '# AKL_FSYNC_FILE' "$script_file"; then
  event="fsync_file:${1-}"
elif grep -q '# AKL_FSYNC_DIRECTORY' "$script_file"; then
  event="fsync_directory:${1-}"
elif grep -q '# AKL_FSYNC_TREE' "$script_file"; then
  event="fsync_tree:${1-}"
elif grep -q '# AKL_PUBLISH_DURABLE_FILE' "$script_file"; then
  event="durable_file:${2-}"
elif grep -q '# AKL_WRITE_RUNTIME_MARKER' "$script_file"; then
  event="runtime_marker:${2-}:${3-}:${4-}"
elif grep -q '# AKL_ATOMIC_CURRENT_SYMLINK' "$script_file"; then
  event="atomic_current:${2-}"
fi

if [[ -n "${FAKE_FSYNC_FAIL_MATCH:-}" \
  && "$event" == fsync_* \
  && "$event" == *"$FAKE_FSYNC_FAIL_MATCH"* ]]; then
  printf 'fault:%s\n' "$event" >>"$CALL_LOG"
  exit 88
fi

set +e
"$REAL_PYTHON3" "$script_file" "$@"
status=$?
set -e
[[ $status -eq 0 ]] || exit "$status"
[[ -z "$event" ]] || printf '%s\n' "$event" >>"$CALL_LOG"

if [[ "${FAKE_KILL_AFTER_VERIFIED_MARKER:-false}" == "true" \
  && "$event" == runtime_marker:*:verified:verified ]]; then
  printf 'fault:sigkill-after-verified-marker\n' >>"$CALL_LOG"
  kill -KILL "$PPID"
fi
if [[ "${FAKE_KILL_AFTER_CURRENT_FSYNC:-false}" == "true" \
  && "$event" == atomic_current:* ]]; then
  printf 'fault:sigkill-after-current-fsync\n' >>"$CALL_LOG"
  kill -KILL "$PPID"
fi
if [[ "${FAKE_LOCK_OWNER_MISMATCH_AFTER_CURRENT_FSYNC:-false}" == "true" \
  && "$event" == atomic_current:* ]]; then
  printf 'pid=999999\nhost=fault.invalid\nstarted_utc=2026-01-01T00:00:00Z\n' \
    >"${AKL_RELEASE_ROOT}/.immutable-deploy.lock/owner"
  chmod 0600 "${AKL_RELEASE_ROOT}/.immutable-deploy.lock/owner"
  printf 'fault:lock-owner-mismatch-after-current-fsync\n' >>"$CALL_LOG"
fi
if [[ "${FAKE_LOCK_OWNER_RM_FAIL_AFTER_CURRENT_FSYNC:-false}" == "true" \
  && "$event" == atomic_current:* ]]; then
  chmod 0500 "${AKL_RELEASE_ROOT}/.immutable-deploy.lock"
  printf 'fault:lock-owner-rm-fail-after-current-fsync\n' >>"$CALL_LOG"
fi
if [[ "${FAKE_LOCK_RMDIR_FAIL_AFTER_CURRENT_FSYNC:-false}" == "true" \
  && "$event" == atomic_current:* ]]; then
  printf 'preserve\n' >"${AKL_RELEASE_ROOT}/.immutable-deploy.lock/fault-blocker"
  chmod 0600 "${AKL_RELEASE_ROOT}/.immutable-deploy.lock/fault-blocker"
  printf 'fault:lock-rmdir-fail-after-current-fsync\n' >>"$CALL_LOG"
fi
SH
chmod +x "$FAKE_BIN/"*
export PATH="${FAKE_BIN}:$PATH"

xtrace_output="${TMP_ROOT}/xtrace-output.log"
if ! AKL_RELEASE_EXPECTED_POSTGRES_TOOL_IMAGE_ID="$FAKE_POSTGRES_TOOL_IMAGE_ID" \
  bash -x "$SOURCE_ROOT/scripts/check_registry_writable_primary.sh" \
  --phase pre-stop >"$xtrace_output" 2>&1; then
  sed 's/test_secret/[REDACTED]/g' "$xtrace_output" >&2
  fail 'writable-primary gate failed under direct bash xtrace invocation'
fi
if grep -Fq 'test_secret' "$xtrace_output"; then
  fail 'direct bash xtrace exposed the Registry database password'
fi
if ! AKL_RELEASE_EXPECTED_POSTGRES_TOOL_IMAGE_ID="$FAKE_POSTGRES_TOOL_IMAGE_ID" \
  bash -c '
  set -x
  export SHELLOPTS
  exec bash "$1" --phase pre-quiesce
' _ "$SOURCE_ROOT/scripts/check_registry_writable_primary.sh" \
  >"$xtrace_output" 2>&1; then
  sed 's/test_secret/[REDACTED]/g' "$xtrace_output" >&2
  fail 'writable-primary gate failed with inherited SHELLOPTS=xtrace'
fi
if grep -Fq 'test_secret' "$xtrace_output"; then
  fail 'inherited SHELLOPTS=xtrace exposed the Registry database password'
fi
rm -f "$xtrace_output"

self_bootstrap_deploy() {
  local target_sha="$1"
  local target_release
  target_release="$(
    "${VERIFIED_BOOTSTRAP_RELEASE}/scripts/prepare_docker_home_release.sh" "$target_sha"
  )"
  [[ "$target_release" == "${AKL_RELEASE_ROOT}/releases/${target_sha}" ]] \
    || fail 'verified bootstrap prepare returned an unexpected target release'
  [[ ! -w "${target_release}/scripts/deploy_docker_home_release.sh" ]] \
    || fail 'bootstrap target deploy script is writable'
  printf 'bootstrap_target_deploy:%s\n' "$target_release" >>"$CALL_LOG"
  "${target_release}/scripts/bootstrap_docker_home_target.sh" --sha "$target_sha"
}

resolved_tool_image_id="$(
  bash -c 'source "$1"; akl_resolve_local_exact_image_id "$2"' \
    _ \
    "$SOURCE_ROOT/scripts/lib/immutable_release_common.sh" \
    "$FAKE_POSTGRES_TOOL_IMAGE_ID"
)"
[[ "$resolved_tool_image_id" == "$FAKE_POSTGRES_TOOL_IMAGE_ID" ]] \
  || fail 'exact PostgreSQL tool image ID did not resolve to itself'
resolved_tool_digest_image_id="$(
  bash -c 'source "$1"; akl_resolve_local_exact_image_id "$2"' \
    _ \
    "$SOURCE_ROOT/scripts/lib/immutable_release_common.sh" \
    "$FAKE_POSTGRES_TOOL_IMAGE"
)"
[[ "$resolved_tool_digest_image_id" == "$FAKE_POSTGRES_TOOL_IMAGE_ID" ]] \
  || fail 'tagged configured digest did not match its canonical local RepoDigest'
if FAKE_POSTGRES_TOOL_REPO_MISMATCH=true \
  bash -c 'source "$1"; akl_resolve_local_exact_image_id "$2"' \
    _ \
    "$SOURCE_ROOT/scripts/lib/immutable_release_common.sh" \
    "$FAKE_POSTGRES_TOOL_IMAGE" >/dev/null 2>&1; then
  fail 'PostgreSQL tool image accepted a RepoDigest from a different repository'
fi

legacy_registry_state="${FAKE_RUNTIME_DIR}/containers/registry-api"
mkdir -p "$legacy_registry_state"
printf 'akl-test-registry-api-1\n' >"${legacy_registry_state}/id"
printf 'true\n' >"${legacy_registry_state}/running"
printf 'akl/registry-api:legacy-dirty-predecessor\n' >"${legacy_registry_state}/image_ref"
printf 'sha256:%064d\n' 1 >"${legacy_registry_state}/image_id"
printf 'akl-test\n' >"${legacy_registry_state}/compose_project"
printf 'registry-api\n' >"${legacy_registry_state}/compose_service"
printf 'False\n' >"${legacy_registry_state}/compose_oneoff"
printf '/srv/akl/repo/infra/docker-compose/docker-compose.docker-home.yml\n' \
  >"${legacy_registry_state}/compose_config_files"
printf '%064d\n' 2 >"${legacy_registry_state}/compose_config_hash"
printf 'legacy\n' >"${legacy_registry_state}/revision"
printf 'akl-test\n' >"${legacy_registry_state}/project"

# shellcheck source=scripts/lib/immutable_release_common.sh
source "$SOURCE_ROOT/scripts/lib/immutable_release_common.sh"

pgpass_sigkill_deployment_id="pgpass-sigkill-$$"
pgpass_sigkill_dir="${AKL_RELEASE_ROOT}/state/postgres-credentials/${pgpass_sigkill_deployment_id}--primary-pre-stop"
pgpass_sigkill_output="${TMP_ROOT}/pgpass-sigkill-output.log"
set +e
(
  export FAKE_PRIMARY_GATE_PID="$BASHPID"
  export FAKE_KILL_PRIMARY_GATE_PHASE=pre-stop
  export AKL_RELEASE_DEPLOYMENT_ID="$pgpass_sigkill_deployment_id"
  export AKL_RELEASE_EXPECTED_POSTGRES_TOOL_IMAGE_ID="$FAKE_POSTGRES_TOOL_IMAGE_ID"
  exec "$SOURCE_ROOT/scripts/check_registry_writable_primary.sh" --phase pre-stop
) >"$pgpass_sigkill_output" 2>&1
pgpass_sigkill_status=$?
set -e
[[ "$pgpass_sigkill_status" -ne 0 ]] \
  || fail 'writable-primary gate survived the injected SIGKILL'
[[ -d "$pgpass_sigkill_dir" && -f "${pgpass_sigkill_dir}/pgpass" ]] \
  || fail 'SIGKILL did not leave private PostgreSQL credential recovery evidence'
grep -Fq 'test_secret' "${pgpass_sigkill_dir}/pgpass" \
  || fail 'SIGKILL credential fixture did not contain the expected private pgpass'
if grep -Fq 'test_secret' "$pgpass_sigkill_output"; then
  fail 'SIGKILL credential failure output exposed the database password'
fi

printf 'MARK stale-postgres-credentials-rejected\n' >>"$CALL_LOG"
stale_pgpass_reject_output="${TMP_ROOT}/stale-pgpass-reject-output.log"
if "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SHA_ONE" \
  >"$stale_pgpass_reject_output" 2>&1; then
  fail 'deployment ignored stale private PostgreSQL credentials'
fi
stale_pgpass_reject_log="$(awk '/^MARK stale-postgres-credentials-rejected$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^build:\|^registry_stop$\|^alembic_upgrade$' <<<"$stale_pgpass_reject_log"; then
  fail 'stale private PostgreSQL credentials reached a release side effect'
fi
if grep -Fq 'test_secret' "$stale_pgpass_reject_output"; then
  fail 'stale PostgreSQL credential rejection exposed the database password'
fi

akl_acquire_deploy_lock "$AKL_RELEASE_ROOT"
if "$SOURCE_ROOT/scripts/cleanup_stale_release_postgres_credentials.sh" \
  --credential-dir "$pgpass_sigkill_dir" >/dev/null 2>&1; then
  fail 'stale PostgreSQL credential cleanup ignored an active deployment lock'
fi
akl_release_deploy_lock
pgpass_cleanup_output="${TMP_ROOT}/pgpass-cleanup-output.log"
"$SOURCE_ROOT/scripts/cleanup_stale_release_postgres_credentials.sh" \
  --credential-dir "$pgpass_sigkill_dir" >"$pgpass_cleanup_output" 2>&1
[[ ! -e "$pgpass_sigkill_dir" && ! -L "$pgpass_sigkill_dir" ]] \
  || fail 'strict PostgreSQL credential cleanup retained the stale directory'
if grep -Fq 'test_secret' "$pgpass_cleanup_output"; then
  fail 'strict PostgreSQL credential cleanup exposed the database password'
fi
akl_assert_no_stale_private_postgres_credentials "$AKL_RELEASE_ROOT"
rm -f "$pgpass_sigkill_output" "$stale_pgpass_reject_output" "$pgpass_cleanup_output"

stale_env_snapshot_for_sha() {
  local release_sha="$1"
  "$REAL_PYTHON3" - "${AKL_RELEASE_ROOT}/env" "$release_sha" <<'PY'
import os
import sys
from pathlib import Path

root = Path(sys.argv[1])
prefix = f".akl-release-env.{sys.argv[2]}."
matches = sorted(entry.name for entry in os.scandir(root) if entry.name.startswith(prefix))
if len(matches) != 1:
    raise SystemExit(f"expected exactly one stale env snapshot for {sys.argv[2]}, found {matches}")
print(root / matches[0])
PY
}

cleanup_stale_env_snapshot_for_sha() {
  local release_sha="$1"
  local stale_snapshot_dir
  stale_snapshot_dir="$(stale_env_snapshot_for_sha "$release_sha")"
  "$SOURCE_ROOT/scripts/cleanup_stale_release_env_snapshot.sh" \
    --snapshot-dir "$stale_snapshot_dir" >/dev/null
  [[ ! -e "$stale_snapshot_dir" && ! -L "$stale_snapshot_dir" ]] \
    || fail "stale env snapshot cleanup retained ${stale_snapshot_dir}"
}

BACKUP_GUARD_COUNTER=0
run_guarded_backup() {
  local deployment_id previous_running previous_restarting status
  BACKUP_GUARD_COUNTER=$((BACKUP_GUARD_COUNTER + 1))
  deployment_id="guarded-backup-${BACKUP_GUARD_COUNTER}-$$"
  previous_running="$(<"${legacy_registry_state}/running")"
  if [[ -f "${legacy_registry_state}/restarting" ]]; then
    previous_restarting="$(<"${legacy_registry_state}/restarting")"
  else
    previous_restarting="false"
  fi
  printf 'false\n' >"${legacy_registry_state}/running"
  printf 'false\n' >"${legacy_registry_state}/restarting"
  akl_acquire_deploy_lock "$AKL_RELEASE_ROOT"
  akl_record_registry_quiescence \
    "$AKL_RELEASE_ROOT" \
    "$deployment_id" \
    akl-test \
    akl-test-registry-api-1 \
    "$previous_running"
  set +e
  AKL_RELEASE_DEPLOYMENT_ID="$deployment_id" "$@"
  status=$?
  set -e
  akl_release_deploy_lock
  printf '%s\n' "$previous_running" >"${legacy_registry_state}/running"
  printf '%s\n' "$previous_restarting" >"${legacy_registry_state}/restarting"
  return "$status"
}

if AKL_RELEASE_GIT_URL=https://example.invalid/poisoned.git \
  "$SOURCE_ROOT/scripts/prepare_docker_home_release.sh" "$SHA_ONE" >/dev/null 2>&1; then
  fail 'release preparation accepted an ambient Git origin override'
fi
[[ ! -e "${AKL_RELEASE_ROOT}/git/AI-KnowledgeBase.git" ]] \
  || fail 'ambient Git origin override poisoned the persistent bare mirror before rejection'

if GIT_CONFIG_COUNT=1 \
  GIT_CONFIG_KEY_0=core.repositoryFormatVersion \
  GIT_CONFIG_VALUE_0=1 \
  "$SOURCE_ROOT/scripts/prepare_docker_home_release.sh" "$SHA_ONE" >/dev/null 2>&1; then
  fail 'release preparation accepted ambient Git configuration injection'
fi
[[ ! -e "${AKL_RELEASE_ROOT}/git/AI-KnowledgeBase.git" ]] \
  || fail 'ambient Git configuration reached the persistent mirror'

if DOCKER_HOST=tcp://wrong-daemon.invalid:2376 \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SHA_ONE" >/dev/null 2>&1; then
  fail 'immutable deployment accepted an ambient Docker daemon route'
fi
if grep -q '^build:\|^registry_stop$\|^alembic_upgrade$' "$CALL_LOG"; then
  fail 'ambient Docker daemon route reached a release side effect'
fi

# The literal interpolation token is the malicious fixture.
# shellcheck disable=SC2016
set_env_value AKL_WEB_PUBLIC_BASE_URL 'https://stratos.example.invalid/akb/${POISON}'
if POISON=ambient-route \
  "$SOURCE_ROOT/scripts/prepare_docker_home_release.sh" "$SHA_ONE" >/dev/null 2>&1; then
  fail 'release preparation accepted nested production env interpolation'
fi
set_env_value AKL_WEB_PUBLIC_BASE_URL 'https://stratos.example.invalid/akb'
[[ ! -e "${AKL_RELEASE_ROOT}/git/AI-KnowledgeBase.git" ]] \
  || fail 'nested production env interpolation reached the persistent mirror'

if AKL_REGISTRY_AUTH_MODE=local \
  "$SOURCE_ROOT/scripts/prepare_docker_home_release.sh" "$SHA_ONE" >/dev/null 2>&1; then
  fail 'release preparation accepted ambient target Compose interpolation'
fi
[[ ! -e "${AKL_RELEASE_ROOT}/releases/${SHA_ONE}" ]] \
  || fail 'ambient target Compose interpolation published a prepared release'

if "$SOURCE_ROOT/scripts/backup_registry_release.sh" "$SHA_ONE" >/dev/null 2>&1; then
  fail 'standalone Registry backup accepted an unverified writer state'
fi

printf 'MARK database-query-routing-override\n' >>"$CALL_LOG"
set_env_value AKL_REGISTRY_DATABASE_URL \
  'postgresql+psycopg://release_user:test_secret@db.internal:5432/registry?host=wrong-db.internal'
if "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SHA_ONE" >/dev/null 2>&1; then
  fail 'writable-primary gate accepted a database URL query routing override'
fi
set_env_value AKL_REGISTRY_DATABASE_URL \
  'postgresql+psycopg://release_user:test_secret@db.internal:5432/registry'
database_query_override_log="$(awk '/^MARK database-query-routing-override$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^build:\|^registry_stop$\|^postgres_tool:pg_dump$\|^alembic_upgrade$' <<<"$database_query_override_log"; then
  fail 'database URL query routing override reached build, writer stop, backup, or migration'
fi

printf 'false\n' >"${legacy_registry_state}/running"
printf 'MARK multi-head-before-backup\n' >>"$CALL_LOG"
if FAKE_ALEMBIC_MULTI_HEAD_BEFORE=true \
  run_guarded_backup \
    "$SOURCE_ROOT/scripts/backup_registry_release.sh" "$SHA_ONE" >/dev/null 2>&1; then
  fail 'Registry backup accepted multiple current Alembic revisions'
fi
multi_head_backup_log="$(awk '/^MARK multi-head-before-backup$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^postgres_tool:pg_dump$' <<<"$multi_head_backup_log"; then
  fail 'multi-head Registry database reached pg_dump'
fi
printf 'true\n' >"${legacy_registry_state}/running"

set_release_tool_image() {
  "$REAL_PYTHON3" - "$AKL_PROD_ENV_FILE" "$1" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = "AKL_RELEASE_POSTGRES_TOOL_IMAGE="
lines = path.read_text(encoding="utf-8").splitlines()
path.write_text(
    "\n".join(
        key + sys.argv[2] if line.startswith(key) else line
        for line in lines
    )
    + "\n",
    encoding="utf-8",
)
PY
  chmod 0600 "$AKL_PROD_ENV_FILE"
}

set_release_tool_image 'postgres:17-alpine'
if run_guarded_backup \
  "$SOURCE_ROOT/scripts/backup_registry_release.sh" "$SHA_ONE" >/dev/null 2>&1; then
  fail 'Registry backup accepted a mutable PostgreSQL tool image tag'
fi
missing_tool_image="postgres:17-alpine@sha256:$(printf 'c%.0s' {1..64})"
set_release_tool_image "$missing_tool_image"
if run_guarded_backup \
  "$SOURCE_ROOT/scripts/backup_registry_release.sh" "$SHA_ONE" >/dev/null 2>&1; then
  fail 'Registry backup accepted a missing exact PostgreSQL tool image'
fi
set_release_tool_image "$FAKE_POSTGRES_TOOL_IMAGE"

printf 'MARK persistent-root-fsync-failure\n' >>"$CALL_LOG"
if FAKE_FSYNC_FAIL_MATCH="$AKL_RELEASE_ROOT" \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SHA_ONE"; then
  fail 'deployment continued when persistent-directory parent fsync failed'
fi
root_fsync_failure_log="$(awk '/^MARK persistent-root-fsync-failure$/ {capture=1; next} capture' "$CALL_LOG")"
grep -Fxq "fault:fsync_directory:${AKL_RELEASE_ROOT}" <<<"$root_fsync_failure_log" \
  || fail 'persistent release-root fsync fault was not injected into the workflow'
if grep -q '^build:\|^registry_stop$' <<<"$root_fsync_failure_log"; then
  fail 'persistent release-root fsync failure reached build or writer maintenance'
fi

printf 'MARK sigkill-during-registry-stop\n' >>"$CALL_LOG"
if FAKE_KILL_DURING_REGISTRY_STOP=true \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SHA_ONE"; then
  fail 'deployment survived injected SIGKILL during Registry writer stop'
fi
[[ ! -e "${AKL_RELEASE_ROOT}/current" && ! -L "${AKL_RELEASE_ROOT}/current" ]] \
  || fail 'SIGKILL during Registry stop created current'
[[ ! -e "${AKL_RELEASE_ROOT}/state/applied-runtime.env" ]] \
  || fail 'SIGKILL during Registry stop advanced the runtime marker'
[[ "$(<"${legacy_registry_state}/running")" == "false" ]] \
  || fail 'SIGKILL fixture did not model an ambiguously stopped Registry writer'
sigkill_stop_record="$(find "${AKL_RELEASE_ROOT}/deployments" -type f -name '*.txt' -print | sort | tail -n 1)"
grep -q '^status=registry_stop_may_have_started$' "$sigkill_stop_record" \
  || fail 'durable record did not identify the Registry stop crash boundary'
grep -q '^registry_stop_may_have_started=true$' "$sigkill_stop_record" \
  || fail 'durable record did not conservatively report a possibly stopped writer'
grep -q '^registry_quiesced=false$' "$sigkill_stop_record" \
  || fail 'durable record falsely claimed verified quiescence at the stop boundary'
grep -q '^current_advanced=false$' "$sigkill_stop_record" \
  || fail 'durable record falsely claimed current activation at the stop boundary'
grep -q '^target_build_may_have_started=true$' "$sigkill_stop_record" \
  || fail 'durable stop-boundary record lost the target build side-effect boundary'
grep -q '^retry_requires_descendant_sha=true$' "$sigkill_stop_record" \
  || fail 'SIGKILL stop-boundary record did not require a reviewed descendant SHA'
[[ -d "${AKL_RELEASE_ROOT}/.immutable-deploy.lock" ]] \
  || fail 'SIGKILL did not leave the expected operator-visible deployment lock'
sigkill_stale_snapshot="$(stale_env_snapshot_for_sha "$SHA_ONE")"
if "$SOURCE_ROOT/scripts/cleanup_stale_release_env_snapshot.sh" \
  --snapshot-dir "$sigkill_stale_snapshot" >/dev/null 2>&1; then
  fail 'stale env snapshot recovery ignored an active deployment lock'
fi
rm -f "${AKL_RELEASE_ROOT}/.immutable-deploy.lock/owner"
rmdir "${AKL_RELEASE_ROOT}/.immutable-deploy.lock"
if akl_assert_no_stale_private_env_snapshots "${AKL_RELEASE_ROOT}/env" >/dev/null 2>&1; then
  fail 'SIGKILL did not leave a fail-closed private env snapshot'
fi
cleanup_stale_env_snapshot_for_sha "$SHA_ONE"
printf 'true\n' >"${legacy_registry_state}/running"

printf 'retry after stop-boundary crash\n' >"$WORK_REPO/apps/web/stop-boundary-retry.txt"
git -C "$WORK_REPO" add apps/web/stop-boundary-retry.txt
git -C "$WORK_REPO" commit --quiet -m 'retry after stop-boundary crash'
SHA_ONE="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main

printf 'MARK backup-fsync-failure\n' >>"$CALL_LOG"
if FAKE_FSYNC_FAIL_MATCH='/backups/.registry-' \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SHA_ONE"; then
  fail 'Registry release continued after backup durability failed'
fi
[[ ! -e "${AKL_RELEASE_ROOT}/state/applied-runtime.env" ]] \
  || fail 'backup durability failure advanced the runtime marker'
[[ "$(<"${legacy_registry_state}/running")" == "true" ]] \
  || fail 'backup durability failure did not restore the exact Registry predecessor'
fsync_failure_log="$(awk '/^MARK backup-fsync-failure$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^fault:fsync_file:.*/backups/.registry-' <<<"$fsync_failure_log" \
  || fail 'backup durability fault was not injected into the real workflow'
if grep -q '^runtime_marker:' <<<"$fsync_failure_log"; then
  fail 'runtime marker advanced before backup durability completed'
fi

printf 'retry after backup durability failure\n' >"$WORK_REPO/apps/web/fsync-retry.txt"
git -C "$WORK_REPO" add apps/web/fsync-retry.txt
git -C "$WORK_REPO" commit --quiet -m 'retry after backup durability failure'
SHA_ONE="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main

LEGACY_FAILED_SHA="$SHA_ONE"
printf 'MARK first-immutable-preapply-failure\n' >>"$CALL_LOG"
if FAKE_PG_DUMP_FAIL=true \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$LEGACY_FAILED_SHA"; then
  fail 'first immutable rollout continued after a failed Registry backup'
fi
[[ ! -e "${AKL_RELEASE_ROOT}/current" && ! -L "${AKL_RELEASE_ROOT}/current" ]] \
  || fail 'failed first immutable rollout created current'
[[ ! -e "${AKL_RELEASE_ROOT}/state/applied-runtime.env" ]] \
  || fail 'pre-apply first-rollout failure advanced the runtime marker'
[[ "$(<"${legacy_registry_state}/running")" == "true" ]] \
  || fail 'first rollout did not restore the exact legacy Registry predecessor'
[[ "$(<"${legacy_registry_state}/image_ref")" == "akl/registry-api:legacy-dirty-predecessor" ]] \
  || fail 'first rollout changed the legacy Registry predecessor image'
legacy_failure_log="$(awk '/^MARK first-immutable-preapply-failure$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^registry_stop$' <<<"$legacy_failure_log" \
  || fail 'first rollout did not quiesce the legacy Registry writer'
grep -q '^docker_start:akl-test-registry-api-1$' <<<"$legacy_failure_log" \
  || fail 'first rollout did not restart the exact legacy Registry container'
legacy_deployment_record="$(find "${AKL_RELEASE_ROOT}/deployments" -type f -name '*.txt' -print | sort | tail -n 1)"
grep -q '^old_registry_image_ref=akl/registry-api:legacy-dirty-predecessor$' "$legacy_deployment_record" \
  || fail 'first rollout did not record the legacy Registry image reference'
grep -q '^old_registry_labels_verified=true$' "$legacy_deployment_record" \
  || fail 'first rollout did not record verified predecessor Compose labels'
grep -q '^retry_requires_descendant_sha=true$' "$legacy_deployment_record" \
  || fail 'post-build first-rollout failure did not require a reviewed descendant SHA'

printf 'first immutable retry\n' >"$WORK_REPO/apps/web/first-immutable.txt"
git -C "$WORK_REPO" add apps/web/first-immutable.txt
git -C "$WORK_REPO" commit --quiet -m 'first immutable retry after pre-apply failure'
SHA_ONE="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK first-immutable-success\n' >>"$CALL_LOG"
if "$SOURCE_ROOT/scripts/bootstrap_docker_home_target.sh" --sha "$SHA_ONE" >/dev/null 2>&1; then
  fail 'bootstrap accepted an entry point outside the exact target release'
fi
bootstrap_target="$("${VERIFIED_BOOTSTRAP_RELEASE}/scripts/prepare_docker_home_release.sh" "$SHA_ONE")"
if AKL_REGISTRY_AUTH_MODE=local \
  "${bootstrap_target}/scripts/bootstrap_docker_home_target.sh" --sha "$SHA_ONE" >/dev/null 2>&1; then
  fail 'target bootstrap accepted ambient target Compose interpolation'
fi
self_bootstrap_deploy "$SHA_ONE"
assert_current_sha "$SHA_ONE"
assert_runtime_marker "$SHA_ONE" verified
first_success_record="$(find "${AKL_RELEASE_ROOT}/deployments" -type f -name '*.txt' -print | sort | tail -n 1)"
grep -q '^retry_requires_descendant_sha=false$' "$first_success_record" \
  || fail 'successful immutable rollout retained a descendant-only retry requirement'
for image_field in \
  target_registry_image_id \
  target_ingestion_image_id \
  target_rag_image_id \
  target_web_image_id \
  target_chat_web_image_id; do
  grep -Eq "^${image_field}=sha256:[0-9a-f]{64}$" "$first_success_record" \
    || fail "successful immutable rollout did not durably record ${image_field}"
done
if "${AKL_RELEASE_ROOT}/current/scripts/bootstrap_docker_home_target.sh" --sha "$SHA_ONE" >/dev/null 2>&1; then
  fail 'first-only target bootstrap accepted an already initialized current release'
fi
[[ "$(cat "${AKL_RELEASE_ROOT}/repo/sentinel")" == "must remain untouched" ]] \
  || fail 'legacy dirty checkout was modified'

git --git-dir="${AKL_RELEASE_ROOT}/git/AI-KnowledgeBase.git" \
  update-ref "refs/replace/${SHA_ONE}" "$SHA_ONE"
if "$SOURCE_ROOT/scripts/prepare_docker_home_release.sh" "$SHA_ONE" >/dev/null 2>&1; then
  fail 'release preparation accepted a Git replace ref in the provenance mirror'
fi
git --git-dir="${AKL_RELEASE_ROOT}/git/AI-KnowledgeBase.git" \
  update-ref -d "refs/replace/${SHA_ONE}"
assert_current_sha "$SHA_ONE"
assert_runtime_marker "$SHA_ONE" verified
if python3 - "${AKL_RELEASE_ROOT}/releases/${SHA_ONE}" <<'PY'
import os
import sys
from pathlib import Path

root = Path(sys.argv[1])
for directory, directory_names, file_names in os.walk(root, followlinks=False):
    for name in [*directory_names, *file_names]:
        candidate = Path(directory) / name
        if not candidate.is_symlink() and candidate.lstat().st_mode & 0o222:
            raise SystemExit(1)
raise SystemExit(1 if root.lstat().st_mode & 0o222 else 0)
PY
then
  :
else
  fail 'prepared release is writable'
fi

mapfile -t backup_dirs < <(find "${AKL_RELEASE_ROOT}/backups" -mindepth 1 -maxdepth 1 -type d | sort)
[[ ${#backup_dirs[@]} -eq 1 ]] || fail 'expected exactly one Registry backup'
backup_dir="${backup_dirs[0]}"
(
  cd "$backup_dir"
  sha256sum --check registry.dump.sha256 >/dev/null
)
[[ -s "$backup_dir/pg_restore.list" ]] || fail 'restore inventory is missing'
grep -q '^database_host=db.internal$' "$backup_dir/inventory.txt" \
  || fail 'safe database inventory is incomplete'
grep -q '^actual_database_name=registry$' "$backup_dir/inventory.txt" \
  || fail 'backup inventory lost the actual database identity'
grep -q '^actual_database_user=release_user$' "$backup_dir/inventory.txt" \
  || fail 'backup inventory lost the actual database user identity'
grep -q '^backend_server_address=10.0.0.21$' "$backup_dir/inventory.txt" \
  || fail 'backup inventory lost the actual backend address'
grep -Fq 'host(inet_server_addr())' "$SOURCE_ROOT/scripts/check_registry_writable_primary.sh" \
  || fail 'writable-primary check does not normalize PostgreSQL inet addresses'
grep -Fq 'host(inet_server_addr())' "$SOURCE_ROOT/scripts/backup_registry_release.sh" \
  || fail 'backup does not normalize PostgreSQL inet addresses'
grep -q '^backend_server_port=5432$' "$backup_dir/inventory.txt" \
  || fail 'backup inventory lost the actual backend port'
grep -q '^alembic_before=0013_information_policy_v2$' "$backup_dir/inventory.txt" \
  || fail 'pre-migration revision was not captured'
grep -q '^documents_count=3$' "$backup_dir/inventory.txt" \
  || fail 'backup inventory lost the critical documents row count'
grep -q '^document_versions_count=5$' "$backup_dir/inventory.txt" \
  || fail 'backup inventory lost the critical document_versions row count'
grep -q '^document_files_count=7$' "$backup_dir/inventory.txt" \
  || fail 'backup inventory lost the critical document_files row count'
grep -q '^document_access_policies_count=3$' "$backup_dir/inventory.txt" \
  || fail 'backup inventory lost the critical document_access_policies row count'
grep -q '^audit_events_count=11$' "$backup_dir/inventory.txt" \
  || fail 'backup inventory lost the critical audit_events row count'
grep -q '^registry_writers_quiesced=true$' "$backup_dir/inventory.txt" \
  || fail 'backup inventory did not record the writer quiesce'
grep -Fxq "postgres_tool_image_ref=${FAKE_POSTGRES_TOOL_IMAGE}" "$backup_dir/inventory.txt" \
  || fail 'backup inventory did not record the exact PostgreSQL tool digest'
grep -Fxq "postgres_tool_image_id=${FAKE_POSTGRES_TOOL_IMAGE_ID}" "$backup_dir/inventory.txt" \
  || fail 'backup inventory did not record the exact PostgreSQL tool image ID'
grep -q '^psql_version=psql (PostgreSQL) 17.5$' "$backup_dir/inventory.txt" \
  || fail 'backup inventory did not record the psql version'
if grep -R -F 'test_secret' "$backup_dir" "$CALL_LOG" >/dev/null; then
  fail 'database password leaked to backup metadata or process arguments'
fi
if grep -q '^host_postgres_tool_invoked:' "$CALL_LOG"; then
  fail 'immutable release invoked a host PostgreSQL client'
fi
pg_dump_line="$(grep -n '^postgres_tool:pg_dump$' "$CALL_LOG" | head -n 1 | cut -d: -f1)"
migration_line="$(grep -n '^alembic_upgrade$' "$CALL_LOG" | head -n 1 | cut -d: -f1)"
[[ "$pg_dump_line" -lt "$migration_line" ]] \
  || fail 'Registry migration ran before the verified backup'
first_success_log="$(awk '/^MARK first-immutable-success$/ {capture=1; next} capture' "$CALL_LOG")"
grep -Fxq "bootstrap_target_deploy:${AKL_RELEASE_ROOT}/releases/${SHA_ONE}" <<<"$first_success_log" \
  || fail 'first rollout did not execute the orchestrator from the exact target release'
grep -Fxq 'build:registry-api rag-retrieval-service web chat-web' <<<"$first_success_log" \
  || fail 'first rollout did not Compose-build the immutable Registry, RAG, web, and chat-web images'
grep -Fxq 'build:ingestion-service' <<<"$first_success_log" \
  || fail 'first rollout did not directly build the immutable ingestion image'
grep -Fxq 'docker_exec_readiness:web-ingestion-transport:nextjs' <<<"$first_success_log" \
  || fail 'first rollout did not prove the exact web ingestion transport as the runtime user'
release_fsync_line="$(grep -n "^fsync_tree:${AKL_RELEASE_ROOT}/releases/.${SHA_ONE}.tmp" <<<"$first_success_log" | head -n 1 | cut -d: -f1)"
first_build_line="$(grep -n '^build:' <<<"$first_success_log" | head -n 1 | cut -d: -f1)"
backup_parent_fsync_line="$(grep -n "^fsync_directory:${AKL_RELEASE_ROOT}/backups$" <<<"$first_success_log" | head -n 1 | cut -d: -f1)"
runtime_migrating_line="$(grep -n "^runtime_marker:${SHA_ONE}:applying:migrating$" <<<"$first_success_log" | head -n 1 | cut -d: -f1)"
[[ -n "$release_fsync_line" && "$release_fsync_line" -lt "$first_build_line" ]] \
  || fail 'prepared release tree was not durable before the build phase'
[[ -n "$backup_parent_fsync_line" && "$backup_parent_fsync_line" -lt "$runtime_migrating_line" ]] \
  || fail 'backup directory was not durable before the runtime marker advanced'
[[ "$(grep -c '^postgres_primary_gate:pre-stop:off|f$' <<<"$first_success_log")" -eq 3 ]] \
  || fail 'successful release did not complete three consecutive pre-stop writable-primary checks'
[[ "$(grep -c '^postgres_primary_gate:pre-quiesce:off|f$' <<<"$first_success_log")" -eq 3 ]] \
  || fail 'successful release did not complete three consecutive pre-quiesce writable-primary checks'
[[ "$(grep -c '^postgres_primary_gate:pre-migration:off|f$' <<<"$first_success_log")" -eq 3 ]] \
  || fail 'successful release did not complete three consecutive pre-migration writable-primary checks'

# Exercise the one-time upgrade path from a verified immutable current whose
# deploy entry point predates hardened orchestrator contract 2. The legacy
# script is committed into the exact current release and would leave an
# unmistakable sentinel if any transition or recovery path invoked it.
cp "$SOURCE_ROOT/tests/fixtures/legacy_deploy_orchestrator.sh" \
  "$WORK_REPO/scripts/deploy_docker_home_release.sh"
chmod +x "$WORK_REPO/scripts/deploy_docker_home_release.sh"
git -C "$WORK_REPO" add scripts/deploy_docker_home_release.sh
git -C "$WORK_REPO" commit --quiet -m 'fixture legacy current orchestrator'
TRANSITION_LEGACY_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
"${AKL_RELEASE_ROOT}/current/scripts/deploy_docker_home_release.sh" \
  --sha "$TRANSITION_LEGACY_SHA"
assert_current_sha "$TRANSITION_LEGACY_SHA"
assert_runtime_marker "$TRANSITION_LEGACY_SHA" verified

cp "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" \
  "$WORK_REPO/scripts/deploy_docker_home_release.sh"
chmod +x "$WORK_REPO/scripts/deploy_docker_home_release.sh"
git -C "$WORK_REPO" add scripts/deploy_docker_home_release.sh
git -C "$WORK_REPO" commit --quiet -m 'hardened existing-current transition target'
TRANSITION_VERIFIED_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
TRANSITION_VERIFIED_RELEASE="$(
  "$SOURCE_ROOT/scripts/prepare_docker_home_release.sh" "$TRANSITION_VERIFIED_SHA"
)"
[[ "$TRANSITION_VERIFIED_RELEASE" == \
  "${AKL_RELEASE_ROOT}/releases/${TRANSITION_VERIFIED_SHA}" ]] \
  || fail 'manual transition target preparation returned an unexpected path'

akl_write_runtime_marker \
  "$AKL_RELEASE_ROOT" \
  "$TRANSITION_LEGACY_SHA" \
  verified \
  migrated \
  registry-api,ingestion-service,rag-retrieval-service,web \
  false \
  transition-marker-mismatch
printf 'MARK transition-marker-mismatch\n' >>"$CALL_LOG"
if "${TRANSITION_VERIFIED_RELEASE}/scripts/bootstrap_docker_home_target.sh" \
  --sha "$TRANSITION_VERIFIED_SHA" \
  --transition-existing-current; then
  fail 'existing-current transition accepted a non-verified runtime phase'
fi
transition_marker_mismatch_log="$(
  awk '/^MARK transition-marker-mismatch$/ {capture=1; next} capture' "$CALL_LOG"
)"
if grep -q '^postgres_tool:\|^build:\|^registry_stop$\|^alembic_upgrade$' \
  <<<"$transition_marker_mismatch_log"; then
  fail 'transition marker mismatch reached Docker build, writer stop, or database work'
fi
akl_write_runtime_marker \
  "$AKL_RELEASE_ROOT" \
  "$TRANSITION_LEGACY_SHA" \
  verified \
  verified \
  registry-api,ingestion-service,rag-retrieval-service,web \
  false \
  transition-clean-predecessor

akl_acquire_deploy_lock "$AKL_RELEASE_ROOT"
printf 'MARK transition-active-lock\n' >>"$CALL_LOG"
if "${TRANSITION_VERIFIED_RELEASE}/scripts/bootstrap_docker_home_target.sh" \
  --sha "$TRANSITION_VERIFIED_SHA" \
  --transition-existing-current; then
  fail 'existing-current transition accepted an active deployment lock'
fi
akl_release_deploy_lock
transition_active_lock_log="$(
  awk '/^MARK transition-active-lock$/ {capture=1; next} capture' "$CALL_LOG"
)"
if grep -q '^postgres_tool:\|^build:\|^registry_stop$\|^alembic_upgrade$' \
  <<<"$transition_active_lock_log"; then
  fail 'transition lock rejection reached Docker build, writer stop, or database work'
fi

printf '/tmp/forbidden-akl-object-alternate\n' \
  >"${AKL_RELEASE_ROOT}/git/AI-KnowledgeBase.git/objects/info/alternates"
printf 'MARK transition-git-alternates\n' >>"$CALL_LOG"
if "${TRANSITION_VERIFIED_RELEASE}/scripts/bootstrap_docker_home_target.sh" \
  --sha "$TRANSITION_VERIFIED_SHA" \
  --transition-existing-current; then
  fail 'existing-current transition accepted an external Git object alternate'
fi
rm -f "${AKL_RELEASE_ROOT}/git/AI-KnowledgeBase.git/objects/info/alternates"
transition_git_alternates_log="$(
  awk '/^MARK transition-git-alternates$/ {capture=1; next} capture' "$CALL_LOG"
)"
if grep -q '^postgres_tool:\|^build:\|^registry_stop$\|^alembic_upgrade$' \
  <<<"$transition_git_alternates_log"; then
  fail 'transition Git alternates rejection reached a destructive boundary'
fi

mkdir -p "${AKL_RELEASE_ROOT}/git/AI-KnowledgeBase.git/refs/heads"
ln -s "$REMOTE_REPO/refs/heads/main" \
  "${AKL_RELEASE_ROOT}/git/AI-KnowledgeBase.git/refs/heads/forbidden-transition-link"
printf 'MARK transition-git-symlink-ref\n' >>"$CALL_LOG"
if "${TRANSITION_VERIFIED_RELEASE}/scripts/bootstrap_docker_home_target.sh" \
  --sha "$TRANSITION_VERIFIED_SHA" \
  --transition-existing-current; then
  fail 'existing-current transition accepted a symlinked Git ref'
fi
rm -f "${AKL_RELEASE_ROOT}/git/AI-KnowledgeBase.git/refs/heads/forbidden-transition-link"
transition_git_symlink_log="$(
  awk '/^MARK transition-git-symlink-ref$/ {capture=1; next} capture' "$CALL_LOG"
)"
if grep -q '^postgres_tool:\|^build:\|^registry_stop$\|^alembic_upgrade$' \
  <<<"$transition_git_symlink_log"; then
  fail 'transition Git symlink rejection reached a destructive boundary'
fi

chmod u+w "${TRANSITION_VERIFIED_RELEASE}/scripts/deploy_docker_home_release.sh"
printf '\n# transition target tamper\n' \
  >>"${TRANSITION_VERIFIED_RELEASE}/scripts/deploy_docker_home_release.sh"
chmod a-w "${TRANSITION_VERIFIED_RELEASE}/scripts/deploy_docker_home_release.sh"
printf 'MARK transition-target-tamper\n' >>"$CALL_LOG"
if "${TRANSITION_VERIFIED_RELEASE}/scripts/bootstrap_docker_home_target.sh" \
  --sha "$TRANSITION_VERIFIED_SHA" \
  --transition-existing-current; then
  fail 'existing-current transition accepted a tampered target release'
fi
transition_target_tamper_log="$(
  awk '/^MARK transition-target-tamper$/ {capture=1; next} capture' "$CALL_LOG"
)"
if grep -q '^postgres_tool:\|^build:\|^registry_stop$\|^alembic_upgrade$' \
  <<<"$transition_target_tamper_log"; then
  fail 'transition target tamper reached Docker build, writer stop, or database work'
fi
chmod u+w \
  "${TRANSITION_VERIFIED_RELEASE}/scripts" \
  "${TRANSITION_VERIFIED_RELEASE}/scripts/deploy_docker_home_release.sh"
cp "$WORK_REPO/scripts/deploy_docker_home_release.sh" \
  "${TRANSITION_VERIFIED_RELEASE}/scripts/deploy_docker_home_release.sh"
chmod a-w \
  "${TRANSITION_VERIFIED_RELEASE}/scripts/deploy_docker_home_release.sh" \
  "${TRANSITION_VERIFIED_RELEASE}/scripts"

printf 'MARK transition-power-loss-after-verified-marker\n' >>"$CALL_LOG"
if FAKE_KILL_AFTER_VERIFIED_MARKER=true \
  "${TRANSITION_VERIFIED_RELEASE}/scripts/bootstrap_docker_home_target.sh" \
    --sha "$TRANSITION_VERIFIED_SHA" \
    --transition-existing-current; then
  fail 'existing-current transition survived the verified-marker power-loss fault'
fi
assert_current_sha "$TRANSITION_LEGACY_SHA"
assert_runtime_marker "$TRANSITION_VERIFIED_SHA" verified
[[ -d "${AKL_RELEASE_ROOT}/.immutable-deploy.lock" ]] \
  || fail 'transition verified-marker fault did not retain the deployment lock'
rm -f "${AKL_RELEASE_ROOT}/.immutable-deploy.lock/owner"
rmdir "${AKL_RELEASE_ROOT}/.immutable-deploy.lock"
cleanup_stale_env_snapshot_for_sha "$TRANSITION_VERIFIED_SHA"

printf 'MARK transition-reconcile-verified-marker\n' >>"$CALL_LOG"
"${TRANSITION_VERIFIED_RELEASE}/scripts/bootstrap_docker_home_target.sh" \
  --sha "$TRANSITION_VERIFIED_SHA" \
  --transition-existing-current
assert_current_sha "$TRANSITION_VERIFIED_SHA"
assert_runtime_marker "$TRANSITION_VERIFIED_SHA" verified
transition_verified_reconcile_log="$(
  awk '/^MARK transition-reconcile-verified-marker$/ {capture=1; next} capture' "$CALL_LOG"
)"
if grep -q '^build:\|^registry_stop$\|^alembic_upgrade$' \
  <<<"$transition_verified_reconcile_log"; then
  fail 'transition verified-marker reconciliation repeated build, stop, or migration'
fi
if grep -q '^old_current_orchestrator_called$' "$CALL_LOG"; then
  fail 'existing-current transition invoked the legacy current orchestrator'
fi
SHA_ONE="$TRANSITION_VERIFIED_SHA"

# Repeat the transition with a second legacy-current fixture and crash after
# the durable current symlink fsync. Re-entry must perform only same-SHA
# verified-success reconciliation.
cp "$SOURCE_ROOT/tests/fixtures/legacy_deploy_orchestrator.sh" \
  "$WORK_REPO/scripts/deploy_docker_home_release.sh"
chmod +x "$WORK_REPO/scripts/deploy_docker_home_release.sh"
git -C "$WORK_REPO" add scripts/deploy_docker_home_release.sh
git -C "$WORK_REPO" commit --quiet -m 'fixture legacy current before current-fsync fault'
TRANSITION_FSYNC_LEGACY_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
"${AKL_RELEASE_ROOT}/current/scripts/deploy_docker_home_release.sh" \
  --sha "$TRANSITION_FSYNC_LEGACY_SHA"
assert_current_sha "$TRANSITION_FSYNC_LEGACY_SHA"

cp "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" \
  "$WORK_REPO/scripts/deploy_docker_home_release.sh"
chmod +x "$WORK_REPO/scripts/deploy_docker_home_release.sh"
git -C "$WORK_REPO" add scripts/deploy_docker_home_release.sh
git -C "$WORK_REPO" commit --quiet -m 'transition target for current-fsync fault'
TRANSITION_FSYNC_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
TRANSITION_FSYNC_RELEASE="$(
  "$SOURCE_ROOT/scripts/prepare_docker_home_release.sh" "$TRANSITION_FSYNC_SHA"
)"
printf 'MARK transition-power-loss-after-current-fsync\n' >>"$CALL_LOG"
if FAKE_KILL_AFTER_CURRENT_FSYNC=true \
  "${TRANSITION_FSYNC_RELEASE}/scripts/bootstrap_docker_home_target.sh" \
    --sha "$TRANSITION_FSYNC_SHA" \
    --transition-existing-current; then
  fail 'existing-current transition survived the current-fsync power-loss fault'
fi
assert_current_sha "$TRANSITION_FSYNC_SHA"
assert_runtime_marker "$TRANSITION_FSYNC_SHA" verified
[[ -d "${AKL_RELEASE_ROOT}/.immutable-deploy.lock" ]] \
  || fail 'transition current-fsync fault did not retain the deployment lock'
rm -f "${AKL_RELEASE_ROOT}/.immutable-deploy.lock/owner"
rmdir "${AKL_RELEASE_ROOT}/.immutable-deploy.lock"
cleanup_stale_env_snapshot_for_sha "$TRANSITION_FSYNC_SHA"

printf 'MARK transition-reconcile-current-fsync\n' >>"$CALL_LOG"
"${TRANSITION_FSYNC_RELEASE}/scripts/bootstrap_docker_home_target.sh" \
  --sha "$TRANSITION_FSYNC_SHA" \
  --transition-existing-current
assert_current_sha "$TRANSITION_FSYNC_SHA"
assert_runtime_marker "$TRANSITION_FSYNC_SHA" verified
transition_fsync_reconcile_log="$(
  awk '/^MARK transition-reconcile-current-fsync$/ {capture=1; next} capture' "$CALL_LOG"
)"
if grep -q '^build:\|^registry_stop$\|^alembic_upgrade$\|^atomic_current:' \
  <<<"$transition_fsync_reconcile_log"; then
  fail 'transition current-fsync reconciliation repeated a destructive boundary'
fi
SHA_ONE="$TRANSITION_FSYNC_SHA"

# A post-apply failure must block transition re-entry. Recovery is executed
# from the exact failed hardened target, never through the legacy current.
cp "$SOURCE_ROOT/tests/fixtures/legacy_deploy_orchestrator.sh" \
  "$WORK_REPO/scripts/deploy_docker_home_release.sh"
chmod +x "$WORK_REPO/scripts/deploy_docker_home_release.sh"
git -C "$WORK_REPO" add scripts/deploy_docker_home_release.sh
git -C "$WORK_REPO" commit --quiet -m 'fixture legacy current before transition apply failure'
TRANSITION_FAILED_LEGACY_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
"${AKL_RELEASE_ROOT}/current/scripts/deploy_docker_home_release.sh" \
  --sha "$TRANSITION_FAILED_LEGACY_SHA"
assert_current_sha "$TRANSITION_FAILED_LEGACY_SHA"

cp "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" \
  "$WORK_REPO/scripts/deploy_docker_home_release.sh"
chmod +x "$WORK_REPO/scripts/deploy_docker_home_release.sh"
git -C "$WORK_REPO" add scripts/deploy_docker_home_release.sh
git -C "$WORK_REPO" commit --quiet -m 'transition target with post-apply failure'
TRANSITION_FAILED_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
TRANSITION_FAILED_RELEASE="$(
  "$SOURCE_ROOT/scripts/prepare_docker_home_release.sh" "$TRANSITION_FAILED_SHA"
)"
printf 'MARK transition-post-apply-failure\n' >>"$CALL_LOG"
if FAKE_WEB_INGESTION_TRANSPORT_READINESS_FAIL=true \
  "${TRANSITION_FAILED_RELEASE}/scripts/bootstrap_docker_home_target.sh" \
    --sha "$TRANSITION_FAILED_SHA" \
    --transition-existing-current; then
  fail 'transition web-ingestion-transport readiness fault unexpectedly succeeded'
fi
assert_current_sha "$TRANSITION_FAILED_LEGACY_SHA"
assert_runtime_marker "$TRANSITION_FAILED_SHA" failed
transition_failed_record="$(deployment_record_for_sha "$TRANSITION_FAILED_SHA")"
for service in registry-api ingestion-service rag-retrieval-service web chat-web; do
  [[ ! -e "${FAKE_RUNTIME_DIR}/containers/${service}" ]] \
    || fail "transition verification failure left the unverified ${service} container present"
done
grep -Fxq 'target_services_start_may_have_started=true' "$transition_failed_record" \
  || fail 'transition failure record omitted the target start boundary'
grep -Fxq 'target_registry_quarantined=true' "$transition_failed_record" \
  || fail 'transition failure record omitted Registry quarantine'
grep -Fxq 'target_ingestion_quarantined=true' "$transition_failed_record" \
  || fail 'transition failure record omitted ingestion quarantine'
grep -Fxq 'target_rag_quarantined=true' "$transition_failed_record" \
  || fail 'transition failure record omitted RAG quarantine'
grep -Fxq 'target_web_quarantined=true' "$transition_failed_record" \
  || fail 'transition failure record omitted web quarantine'
grep -Fxq 'target_chat_web_quarantined=true' "$transition_failed_record" \
  || fail 'transition failure record omitted chat web quarantine'
grep -Fxq 'deploy_lock_preserved=false' "$transition_failed_record" \
  || fail 'successful transition quarantine unexpectedly preserved the deployment lock'
transition_failed_log="$(
  awk '/^MARK transition-post-apply-failure$/ {capture=1; next} capture' "$CALL_LOG"
)"
grep -Fxq 'docker_exec_readiness:web-ingestion-transport:nextjs' <<<"$transition_failed_log" \
  || fail 'transition fault did not reach the exact web ingestion transport probe'
[[ ! -e "${AKL_RELEASE_ROOT}/.immutable-deploy.lock" ]] \
  || fail 'successful transition quarantine left a deployment lock'

printf 'MARK transition-failed-reentry-rejected\n' >>"$CALL_LOG"
if "${TRANSITION_FAILED_RELEASE}/scripts/bootstrap_docker_home_target.sh" \
  --sha "$TRANSITION_FAILED_SHA" \
  --transition-existing-current; then
  fail 'failed transition allowed ordinary transition re-entry'
fi
transition_failed_reentry_log="$(
  awk '/^MARK transition-failed-reentry-rejected$/ {capture=1; next} capture' "$CALL_LOG"
)"
if grep -q '^postgres_tool:\|^build:\|^registry_stop$\|^alembic_upgrade$' \
  <<<"$transition_failed_reentry_log"; then
  fail 'failed transition re-entry rejection reached a destructive boundary'
fi

printf 'transition-forward-fix\n' >"$WORK_REPO/apps/web/transition-forward-fix.txt"
git -C "$WORK_REPO" add apps/web/transition-forward-fix.txt
git -C "$WORK_REPO" commit --quiet -m 'forward fix after transition apply failure'
TRANSITION_FORWARD_FIX_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
"${TRANSITION_FAILED_RELEASE}/scripts/rollback_docker_home_release.sh" \
  --failed-sha "$TRANSITION_FAILED_SHA" \
  --forward-fix-sha "$TRANSITION_FORWARD_FIX_SHA"
assert_current_sha "$TRANSITION_FORWARD_FIX_SHA"
assert_runtime_marker "$TRANSITION_FORWARD_FIX_SHA" verified
if grep -q '^old_current_orchestrator_called$' "$CALL_LOG"; then
  fail 'transition fault recovery invoked the legacy current orchestrator'
fi
SHA_ONE="$TRANSITION_FORWARD_FIX_SHA"

# Once contract 2 is current, a descendant must use the normal current entry
# point. Transition mode is no longer a general-purpose prepare bypass.
printf 'post-transition-standard-release\n' \
  >"$WORK_REPO/apps/web/post-transition-standard-release.txt"
git -C "$WORK_REPO" add apps/web/post-transition-standard-release.txt
git -C "$WORK_REPO" commit --quiet -m 'post-transition standard release'
POST_TRANSITION_STANDARD_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
POST_TRANSITION_STANDARD_RELEASE="$(
  "$SOURCE_ROOT/scripts/prepare_docker_home_release.sh" "$POST_TRANSITION_STANDARD_SHA"
)"
printf 'MARK transition-one-time-rejection\n' >>"$CALL_LOG"
if "${POST_TRANSITION_STANDARD_RELEASE}/scripts/bootstrap_docker_home_target.sh" \
  --sha "$POST_TRANSITION_STANDARD_SHA" \
  --transition-existing-current; then
  fail 'transition mode accepted a descendant after contract 2 became current'
fi
transition_one_time_log="$(
  awk '/^MARK transition-one-time-rejection$/ {capture=1; next} capture' "$CALL_LOG"
)"
if grep -q '^postgres_tool:\|^build:\|^registry_stop$\|^alembic_upgrade$' \
  <<<"$transition_one_time_log"; then
  fail 'one-time transition rejection reached a destructive boundary'
fi
"${AKL_RELEASE_ROOT}/current/scripts/deploy_docker_home_release.sh" \
  --sha "$POST_TRANSITION_STANDARD_SHA"
assert_current_sha "$POST_TRANSITION_STANDARD_SHA"
assert_runtime_marker "$POST_TRANSITION_STANDARD_SHA" verified
SHA_ONE="$POST_TRANSITION_STANDARD_SHA"

printf 'registry-primary-gate-retry\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'registry release for retryable pre-stop primary gate'
PRE_STOP_GATE_RETRY_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main

printf 'MARK ambient-database-url-override\n' >>"$CALL_LOG"
if AKL_REGISTRY_DATABASE_URL='postgresql+psycopg://ambient_user:ambient_secret@wrong-db.internal:5432/wrong_registry' \
  "${AKL_RELEASE_ROOT}/current/scripts/deploy_docker_home_release.sh" --sha "$PRE_STOP_GATE_RETRY_SHA"; then
  fail 'deployment accepted an ambient override of the production database URL'
fi
ambient_database_log="$(awk '/^MARK ambient-database-url-override$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^postgres_primary_gate:\|^build:\|^registry_stop$\|^alembic_upgrade$' <<<"$ambient_database_log"; then
  fail 'ambient database URL override reached a database gate, build, writer stop, or migration'
fi
assert_current_sha "$SHA_ONE"
assert_runtime_marker "$SHA_ONE" verified

printf 'MARK ambient-compose-auth-override\n' >>"$CALL_LOG"
if AKL_REGISTRY_AUTH_MODE=local \
  "${AKL_RELEASE_ROOT}/current/scripts/deploy_docker_home_release.sh" --sha "$PRE_STOP_GATE_RETRY_SHA"; then
  fail 'deployment accepted an ambient override absent from the production env file'
fi
ambient_auth_log="$(awk '/^MARK ambient-compose-auth-override$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^postgres_primary_gate:\|^build:\|^registry_stop$\|^alembic_upgrade$' <<<"$ambient_auth_log"; then
  fail 'ambient Compose auth override reached a database gate, build, writer stop, or migration'
fi
assert_current_sha "$SHA_ONE"
assert_runtime_marker "$SHA_ONE" verified

printf 'MARK pre-stop-wrong-database-identity\n' >>"$CALL_LOG"
if FAKE_POSTGRES_ACTUAL_DATABASE=wrong_registry \
  "${AKL_RELEASE_ROOT}/current/scripts/deploy_docker_home_release.sh" --sha "$PRE_STOP_GATE_RETRY_SHA"; then
  fail 'deployment accepted the wrong Registry database identity'
fi
wrong_database_log="$(awk '/^MARK pre-stop-wrong-database-identity$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^build:\|^registry_stop$\|^alembic_upgrade$' <<<"$wrong_database_log"; then
  fail 'wrong Registry database identity reached build, writer stop, or migration'
fi
assert_current_sha "$SHA_ONE"
assert_runtime_marker "$SHA_ONE" verified

printf 'MARK pre-stop-wrong-user-identity\n' >>"$CALL_LOG"
if FAKE_POSTGRES_ACTUAL_USER=wrong_release_user \
  "${AKL_RELEASE_ROOT}/current/scripts/deploy_docker_home_release.sh" --sha "$PRE_STOP_GATE_RETRY_SHA"; then
  fail 'deployment accepted the wrong Registry database user identity'
fi
wrong_user_log="$(awk '/^MARK pre-stop-wrong-user-identity$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^build:\|^registry_stop$\|^alembic_upgrade$' <<<"$wrong_user_log"; then
  fail 'wrong Registry database user identity reached build, writer stop, or migration'
fi
assert_current_sha "$SHA_ONE"
assert_runtime_marker "$SHA_ONE" verified

printf 'MARK pre-stop-read-only-primary-gate\n' >>"$CALL_LOG"
if FAKE_POSTGRES_PRIMARY_GATE_PHASE=pre-stop \
  FAKE_POSTGRES_PRIMARY_GATE_MODE=read-only \
  "${AKL_RELEASE_ROOT}/current/scripts/deploy_docker_home_release.sh" --sha "$PRE_STOP_GATE_RETRY_SHA"; then
  fail 'deployment continued when the HA endpoint was transaction read-only'
fi
pre_stop_read_only_log="$(awk '/^MARK pre-stop-read-only-primary-gate$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^postgres_primary_gate:pre-stop:on|f$' <<<"$pre_stop_read_only_log" \
  || fail 'read-only primary-gate fault was not injected'
if grep -q '^build:\|^registry_stop$\|^alembic_upgrade$' <<<"$pre_stop_read_only_log"; then
  fail 'read-only pre-stop gate reached target build, writer stop, or migration'
fi
assert_current_sha "$SHA_ONE"
assert_runtime_marker "$SHA_ONE" verified
pre_stop_failure_record="$(find "${AKL_RELEASE_ROOT}/deployments" -type f -name '*.txt' -print | sort | tail -n 1)"
grep -q '^target_build_may_have_started=false$' "$pre_stop_failure_record" \
  || fail 'pre-stop gate failure falsely crossed the target build boundary'
grep -q '^retry_requires_descendant_sha=false$' "$pre_stop_failure_record" \
  || fail 'pre-stop gate failure incorrectly required a descendant SHA'

printf 'MARK pre-stop-recovery-primary-gate\n' >>"$CALL_LOG"
if FAKE_POSTGRES_PRIMARY_GATE_PHASE=pre-stop \
  FAKE_POSTGRES_PRIMARY_GATE_MODE=recovery \
  "${AKL_RELEASE_ROOT}/current/scripts/deploy_docker_home_release.sh" --sha "$PRE_STOP_GATE_RETRY_SHA"; then
  fail 'deployment continued when the HA endpoint was in recovery'
fi
pre_stop_recovery_log="$(awk '/^MARK pre-stop-recovery-primary-gate$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^postgres_primary_gate:pre-stop:off|t$' <<<"$pre_stop_recovery_log" \
  || fail 'recovery primary-gate fault was not injected'
if grep -q '^build:\|^registry_stop$\|^alembic_upgrade$' <<<"$pre_stop_recovery_log"; then
  fail 'recovery pre-stop gate reached target build, writer stop, or migration'
fi
assert_current_sha "$SHA_ONE"
assert_runtime_marker "$SHA_ONE" verified

printf 'MARK same-sha-primary-gate-retry-success\n' >>"$CALL_LOG"
"${AKL_RELEASE_ROOT}/current/scripts/deploy_docker_home_release.sh" --sha "$PRE_STOP_GATE_RETRY_SHA"
assert_current_sha "$PRE_STOP_GATE_RETRY_SHA"
assert_runtime_marker "$PRE_STOP_GATE_RETRY_SHA" verified
same_sha_primary_retry_log="$(awk '/^MARK same-sha-primary-gate-retry-success$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^build:registry-api$' <<<"$same_sha_primary_retry_log" \
  || fail 'same approved SHA did not build after the transient pre-stop gate recovered'
pre_stop_gate_line="$(grep -n '^postgres_primary_gate:pre-stop:off|f$' <<<"$same_sha_primary_retry_log" | tail -n 1 | cut -d: -f1)"
same_sha_build_line="$(grep -n '^build:registry-api$' <<<"$same_sha_primary_retry_log" | head -n 1 | cut -d: -f1)"
[[ "$pre_stop_gate_line" -lt "$same_sha_build_line" ]] \
  || fail 'pre-stop writable-primary gate did not finish before target image build'
SHA_ONE="$PRE_STOP_GATE_RETRY_SHA"

printf 'release-control-only\n' >"$WORK_REPO/scripts/release-control-marker.txt"
git -C "$WORK_REPO" add scripts/release-control-marker.txt
git -C "$WORK_REPO" commit --quiet -m 'scripts-only immutable release control change'
SCRIPTS_ONLY_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK scripts-only-release\n' >>"$CALL_LOG"
"${AKL_RELEASE_ROOT}/current/scripts/deploy_docker_home_release.sh" --sha "$SCRIPTS_ONLY_SHA"
assert_current_sha "$SCRIPTS_ONLY_SHA"
assert_runtime_marker "$SCRIPTS_ONLY_SHA" verified
scripts_only_log="$(awk '/^MARK scripts-only-release$/ {capture=1; next} capture' "$CALL_LOG")"
grep -Fxq 'build:registry-api rag-retrieval-service web chat-web' <<<"$scripts_only_log" \
  || fail 'scripts-only release did not Compose-build every supported non-ingestion service'
grep -Fxq 'build:ingestion-service' <<<"$scripts_only_log" \
  || fail 'scripts-only release did not build ingestion-service'
SHA_ONE="$SCRIPTS_ONLY_SHA"

printf 'build-before-tag-fault\n' >"$WORK_REPO/apps/web/build-before-tag.txt"
git -C "$WORK_REPO" add apps/web/build-before-tag.txt
git -C "$WORK_REPO" commit --quiet -m 'web release for build-before-tag fault'
BUILD_BEFORE_TAG_FAILED_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK build-before-tag-fault\n' >>"$CALL_LOG"
if FAKE_BUILD_FAIL_BEFORE_TAG=true \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$BUILD_BEFORE_TAG_FAILED_SHA"; then
  fail 'deployment survived a target build failure before image tag creation'
fi
assert_current_sha "$SHA_ONE"
assert_runtime_marker "$SHA_ONE" verified
assert_burned_sha "$BUILD_BEFORE_TAG_FAILED_SHA" build_may_have_started
build_before_tag_log="$(awk '/^MARK build-before-tag-fault$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^build:web chat-web$' <<<"$build_before_tag_log" \
  || fail 'build-before-tag fixture did not reach the target image build'
grep -q '^fault:build-before-tag$' <<<"$build_before_tag_log" \
  || fail 'build-before-tag fault was not injected'
if grep -q '^up:\|^registry_stop$\|^alembic_upgrade$' <<<"$build_before_tag_log"; then
  fail 'build-before-tag failure reached restart, writer stop, or migration'
fi
[[ "$(<"${FAKE_RUNTIME_DIR}/images/web/ref")" != "akl/web:${BUILD_BEFORE_TAG_FAILED_SHA}" ]] \
  || fail 'build-before-tag fixture unexpectedly created the target image tag'
[[ "$(<"${FAKE_RUNTIME_DIR}/images/chat-web/ref")" != "akl/chat-web:${BUILD_BEFORE_TAG_FAILED_SHA}" ]] \
  || fail 'build-before-tag fixture unexpectedly created the chat target image tag'
build_before_tag_record="$(find "${AKL_RELEASE_ROOT}/deployments" -type f -name '*.txt' -print | sort | tail -n 1)"
grep -q '^target_build_may_have_started=true$' "$build_before_tag_record" \
  || fail 'build-before-tag failure record lost the possible build boundary'
grep -q '^retry_requires_descendant_sha=true$' "$build_before_tag_record" \
  || fail 'build-before-tag failure did not require a reviewed descendant SHA'

printf 'MARK build-before-tag-same-sha-rejected\n' >>"$CALL_LOG"
if "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$BUILD_BEFORE_TAG_FAILED_SHA"; then
  fail 'durably burned build-before-tag SHA was accepted for retry'
fi
build_before_tag_retry_log="$(awk '/^MARK build-before-tag-same-sha-rejected$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^build:\|^registry_stop$\|^alembic_upgrade$' <<<"$build_before_tag_retry_log"; then
  fail 'burned build-before-tag SHA retry reached build, writer stop, or migration'
fi
burned_build_retry_record="$(find "${AKL_RELEASE_ROOT}/deployments" -type f -name '*.txt' -print | sort | tail -n 1)"
grep -q '^target_build_may_have_started=true$' "$burned_build_retry_record" \
  || fail 'burned-SHA retry record lost historical build evidence'
grep -q '^retry_requires_descendant_sha=true$' "$burned_build_retry_record" \
  || fail 'burned-SHA retry record did not preserve the descendant requirement'

printf 'build-before-tag-descendant\n' >"$WORK_REPO/apps/web/build-before-tag.txt"
git -C "$WORK_REPO" add apps/web/build-before-tag.txt
git -C "$WORK_REPO" commit --quiet -m 'reviewed descendant after build-before-tag fault'
BUILD_BEFORE_TAG_DESCENDANT_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK build-before-tag-descendant-success\n' >>"$CALL_LOG"
"$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$BUILD_BEFORE_TAG_DESCENDANT_SHA"
assert_current_sha "$BUILD_BEFORE_TAG_DESCENDANT_SHA"
assert_runtime_marker "$BUILD_BEFORE_TAG_DESCENDANT_SHA" verified
SHA_ONE="$BUILD_BEFORE_TAG_DESCENDANT_SHA"

printf 'registry-pre-quiesce-gate-fault\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'registry release for pre-quiesce primary gate fault'
PRE_QUIESCE_FAILED_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK pre-quiesce-recovery-primary-gate\n' >>"$CALL_LOG"
if FAKE_POSTGRES_PRIMARY_GATE_PHASE=pre-quiesce \
  FAKE_POSTGRES_PRIMARY_GATE_MODE=recovery \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$PRE_QUIESCE_FAILED_SHA"; then
  fail 'deployment stopped the Registry writer after the post-build HA endpoint entered recovery'
fi
assert_current_sha "$SHA_ONE"
assert_runtime_marker "$SHA_ONE" verified
assert_burned_sha "$PRE_QUIESCE_FAILED_SHA" build_may_have_started
pre_quiesce_recovery_log="$(awk '/^MARK pre-quiesce-recovery-primary-gate$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^build:registry-api$' <<<"$pre_quiesce_recovery_log" \
  || fail 'pre-quiesce primary-gate fixture did not reach the target build'
grep -q '^postgres_primary_gate:pre-quiesce:off|t$' <<<"$pre_quiesce_recovery_log" \
  || fail 'pre-quiesce recovery primary-gate fault was not injected'
if grep -q '^registry_stop$\|^postgres_tool:pg_dump$\|^alembic_upgrade$' <<<"$pre_quiesce_recovery_log"; then
  fail 'pre-quiesce recovery primary gate allowed writer stop, backup, or migration'
fi
pre_quiesce_failure_record="$(find "${AKL_RELEASE_ROOT}/deployments" -type f -name '*.txt' -print | sort | tail -n 1)"
grep -q '^writable_primary_pre_stop_checked=true$' "$pre_quiesce_failure_record" \
  || fail 'pre-quiesce failure record lost the successful pre-stop primary gate'
grep -q '^writable_primary_pre_quiesce_checked=false$' "$pre_quiesce_failure_record" \
  || fail 'pre-quiesce failure record falsely claimed the final primary gate'
grep -q '^registry_stop_may_have_started=false$' "$pre_quiesce_failure_record" \
  || fail 'pre-quiesce failure record falsely crossed the durable stop boundary'
grep -q '^retry_requires_descendant_sha=true$' "$pre_quiesce_failure_record" \
  || fail 'pre-quiesce post-build failure did not require a reviewed descendant SHA'

rm -rf "${FAKE_RUNTIME_DIR}/images/registry-api"
printf 'MARK pre-quiesce-same-sha-rejected-without-tag\n' >>"$CALL_LOG"
if "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$PRE_QUIESCE_FAILED_SHA"; then
  fail 'burned pre-quiesce SHA was accepted after its target image tag disappeared'
fi
pre_quiesce_same_sha_log="$(awk '/^MARK pre-quiesce-same-sha-rejected-without-tag$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^build:\|^registry_stop$\|^alembic_upgrade$' <<<"$pre_quiesce_same_sha_log"; then
  fail 'burned pre-quiesce SHA retry reached build, writer stop, or migration after tag removal'
fi
burned_pre_quiesce_retry_record="$(find "${AKL_RELEASE_ROOT}/deployments" -type f -name '*.txt' -print | sort | tail -n 1)"
grep -q '^retry_requires_descendant_sha=true$' "$burned_pre_quiesce_retry_record" \
  || fail 'tagless burned-SHA retry record did not preserve the descendant requirement'

printf 'registry-pre-quiesce-descendant\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'reviewed descendant after pre-quiesce primary gate fault'
PRE_QUIESCE_DESCENDANT_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK pre-quiesce-descendant-success\n' >>"$CALL_LOG"
"$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$PRE_QUIESCE_DESCENDANT_SHA"
assert_current_sha "$PRE_QUIESCE_DESCENDANT_SHA"
assert_runtime_marker "$PRE_QUIESCE_DESCENDANT_SHA" verified
SHA_ONE="$PRE_QUIESCE_DESCENDANT_SHA"

printf 'registry-external-restart-race\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'registry release for external restart race'
EXTERNAL_RESTART_FAILED_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK external-restart-before-dump\n' >>"$CALL_LOG"
if FAKE_EXTERNAL_REGISTRY_RESTART_PHASE=backup-pre-dump \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$EXTERNAL_RESTART_FAILED_SHA"; then
  fail 'Registry release continued after an external writer restart before pg_dump'
fi
assert_current_sha "$SHA_ONE"
assert_runtime_marker "$SHA_ONE" verified
assert_burned_sha "$EXTERNAL_RESTART_FAILED_SHA" build_may_have_started
external_restart_log="$(awk '/^MARK external-restart-before-dump$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^fault:external-registry-restart:backup-pre-dump$' <<<"$external_restart_log" \
  || fail 'external Registry restart fault was not injected before pg_dump'
if grep -q '^postgres_tool:pg_dump$\|^alembic_upgrade$' <<<"$external_restart_log"; then
  fail 'external Registry restart reached backup or migration'
fi
if grep -q '^docker_start:' <<<"$external_restart_log"; then
  fail 'failure recovery restarted a predecessor that had already externally restarted'
fi
[[ "$(<"${FAKE_RUNTIME_DIR}/containers/registry-api/running")" == "true" ]] \
  || fail 'external restart race did not leave the exact predecessor available'

printf 'registry-external-restart-descendant\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'reviewed descendant after external restart race'
EXTERNAL_RESTART_DESCENDANT_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
"$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$EXTERNAL_RESTART_DESCENDANT_SHA"
assert_current_sha "$EXTERNAL_RESTART_DESCENDANT_SHA"
assert_runtime_marker "$EXTERNAL_RESTART_DESCENDANT_SHA" verified
SHA_ONE="$EXTERNAL_RESTART_DESCENDANT_SHA"

printf 'registry-restarting-predecessor\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'registry release for restarting predecessor state'
RESTARTING_PREDECESSOR_FAILED_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'false\n' >"${FAKE_RUNTIME_DIR}/containers/registry-api/running"
printf 'true\n' >"${FAKE_RUNTIME_DIR}/containers/registry-api/restarting"
printf 'MARK restarting-predecessor-preapply-failure\n' >>"$CALL_LOG"
if FAKE_PG_DUMP_FAIL=true \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$RESTARTING_PREDECESSOR_FAILED_SHA"; then
  fail 'restarting-predecessor release continued after backup failure'
fi
assert_current_sha "$SHA_ONE"
assert_runtime_marker "$SHA_ONE" verified
restarting_predecessor_log="$(awk '/^MARK restarting-predecessor-preapply-failure$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^docker_start:akl-test-registry-api-1$' <<<"$restarting_predecessor_log" \
  || fail 'pre-apply recovery did not restart the exact previously restarting predecessor'
[[ "$(<"${FAKE_RUNTIME_DIR}/containers/registry-api/running")" == "true" ]] \
  || fail 'previously restarting Registry predecessor was not restored'
restarting_predecessor_record="$(find "${AKL_RELEASE_ROOT}/deployments" -type f -name '*.txt' -print | sort | tail -n 1)"
grep -q '^old_registry_was_restarting=true$' "$restarting_predecessor_record" \
  || fail 'deployment record lost the predecessor restarting state'
grep -q '^old_registry_was_running=true$' "$restarting_predecessor_record" \
  || fail 'restarting predecessor was not classified as previously active'

printf 'registry-restarting-predecessor-descendant\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'reviewed descendant after restarting predecessor fault'
RESTARTING_PREDECESSOR_DESCENDANT_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
"$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$RESTARTING_PREDECESSOR_DESCENDANT_SHA"
assert_current_sha "$RESTARTING_PREDECESSOR_DESCENDANT_SHA"
assert_runtime_marker "$RESTARTING_PREDECESSOR_DESCENDANT_SHA" verified
SHA_ONE="$RESTARTING_PREDECESSOR_DESCENDANT_SHA"

printf 'registry-restart-gap-fault\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'registry release for predecessor restart-gap fault'
RESTART_GAP_FAILED_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'false\n' >"${FAKE_RUNTIME_DIR}/containers/registry-api/running"
printf 'MARK stopped-predecessor-restart-gap\n' >>"$CALL_LOG"
if FAKE_PG_DUMP_FAIL=true \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$RESTART_GAP_FAILED_SHA"; then
  fail 'restart-gap Registry release continued after backup failure'
fi
assert_current_sha "$SHA_ONE"
assert_runtime_marker "$SHA_ONE" verified
restart_gap_log="$(awk '/^MARK stopped-predecessor-restart-gap$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^registry_stop$' <<<"$restart_gap_log" \
  || fail 'stopped predecessor from docker ps -a was not explicitly stopped'
if grep -q '^docker_start:' <<<"$restart_gap_log"; then
  fail 'pre-apply failure restarted a predecessor that was already stopped'
fi
[[ "$(<"${FAKE_RUNTIME_DIR}/containers/registry-api/running")" == "false" ]] \
  || fail 'restart-gap predecessor did not remain stopped after pre-apply failure'
restart_gap_record="$(find "${AKL_RELEASE_ROOT}/deployments" -type f -name '*.txt' -print | sort | tail -n 1)"
grep -q '^old_registry_was_running=false$' "$restart_gap_record" \
  || fail 'restart-gap deployment record lost the predecessor running state'
grep -q '^registry_stop_may_have_started=false$' "$restart_gap_record" \
  || fail 'restart-gap failure retained an unresolved stop boundary after safe handling'

printf 'registry-restart-gap-descendant\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'reviewed descendant after predecessor restart-gap fault'
RESTART_GAP_DESCENDANT_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK restart-gap-descendant-success\n' >>"$CALL_LOG"
"$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$RESTART_GAP_DESCENDANT_SHA"
assert_current_sha "$RESTART_GAP_DESCENDANT_SHA"
assert_runtime_marker "$RESTART_GAP_DESCENDANT_SHA" verified
[[ "$(<"${FAKE_RUNTIME_DIR}/containers/registry-api/running")" == "true" ]] \
  || fail 'restart-gap descendant did not start the new Registry writer'
SHA_ONE="$RESTART_GAP_DESCENDANT_SHA"

printf 'registry-image-retarget-fault\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'registry release for image retarget fault'
IMAGE_RETARGET_FAILED_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK image-retarget-before-alembic\n' >>"$CALL_LOG"
if FAKE_IMAGE_RETARGET_PHASE=pre-alembic-heads \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$IMAGE_RETARGET_FAILED_SHA"; then
  fail 'Registry release accepted a retargeted image before Alembic inspection'
fi
assert_current_sha "$SHA_ONE"
assert_runtime_marker "$SHA_ONE" verified
image_retarget_log="$(awk '/^MARK image-retarget-before-alembic$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^fault:image-retarget:pre-alembic-heads:registry-api$' <<<"$image_retarget_log" \
  || fail 'Registry image retarget fault was not injected'
if grep -q '^alembic_upgrade$\|^runtime_marker:' <<<"$image_retarget_log"; then
  fail 'retargeted Registry image reached migration or runtime marker'
fi
grep -q '^docker_start:akl-test-registry-api-1$' <<<"$image_retarget_log" \
  || fail 'image-retarget pre-apply failure did not restore the exact predecessor'

printf 'registry-image-retarget-descendant\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'reviewed descendant after image retarget fault'
IMAGE_RETARGET_DESCENDANT_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
"$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$IMAGE_RETARGET_DESCENDANT_SHA"
assert_current_sha "$IMAGE_RETARGET_DESCENDANT_SHA"
assert_runtime_marker "$IMAGE_RETARGET_DESCENDANT_SHA" verified
SHA_ONE="$IMAGE_RETARGET_DESCENDANT_SHA"

printf 'registry-image-missing-fault\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'registry release for missing image fault'
IMAGE_MISSING_FAILED_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK image-missing-before-alembic\n' >>"$CALL_LOG"
if FAKE_IMAGE_MISSING_PHASE=pre-alembic-heads \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$IMAGE_MISSING_FAILED_SHA"; then
  fail 'Registry release continued after its exact target image tag disappeared'
fi
assert_current_sha "$SHA_ONE"
assert_runtime_marker "$SHA_ONE" verified
image_missing_log="$(awk '/^MARK image-missing-before-alembic$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^fault:image-missing:pre-alembic-heads:registry-api$' <<<"$image_missing_log" \
  || fail 'Registry missing-image fault was not injected'
if grep -q '^alembic_upgrade$\|^runtime_marker:' <<<"$image_missing_log"; then
  fail 'missing Registry target image reached migration or runtime marker'
fi

printf 'registry-image-missing-descendant\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'reviewed descendant after missing image fault'
IMAGE_MISSING_DESCENDANT_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
"$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$IMAGE_MISSING_DESCENDANT_SHA"
assert_current_sha "$IMAGE_MISSING_DESCENDANT_SHA"
assert_runtime_marker "$IMAGE_MISSING_DESCENDANT_SHA" verified
SHA_ONE="$IMAGE_MISSING_DESCENDANT_SHA"

printf 'registry-primary-gate-fault\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'registry release for post-backup primary gate fault'
PRIMARY_GATE_FAILED_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK pre-migration-recovery-primary-gate\n' >>"$CALL_LOG"
if FAKE_POSTGRES_PRIMARY_GATE_PHASE=pre-migration \
  FAKE_POSTGRES_PRIMARY_GATE_MODE=recovery \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$PRIMARY_GATE_FAILED_SHA"; then
  fail 'deployment migrated after the post-backup HA endpoint entered recovery'
fi
assert_current_sha "$SHA_ONE"
assert_runtime_marker "$SHA_ONE" verified
pre_migration_recovery_log="$(awk '/^MARK pre-migration-recovery-primary-gate$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^registry_stop$' <<<"$pre_migration_recovery_log" \
  || fail 'post-backup primary-gate fixture did not reach the verified writer stop'
grep -q '^postgres_tool:pg_dump$' <<<"$pre_migration_recovery_log" \
  || fail 'post-backup primary-gate fixture did not complete the verified backup'
grep -q '^postgres_primary_gate:pre-migration:off|t$' <<<"$pre_migration_recovery_log" \
  || fail 'post-backup recovery primary-gate fault was not injected'
if grep -q '^alembic_upgrade$' <<<"$pre_migration_recovery_log"; then
  fail 'post-backup recovery primary gate allowed migration'
fi
grep -q '^docker_start:akl-test-registry-api-1$' <<<"$pre_migration_recovery_log" \
  || fail 'post-backup primary-gate failure did not restore the exact Registry predecessor'
[[ "$(<"${FAKE_RUNTIME_DIR}/containers/registry-api/running")" == "true" ]] \
  || fail 'post-backup primary-gate failure left the Registry writer stopped'
primary_gate_failure_record="$(find "${AKL_RELEASE_ROOT}/deployments" -type f -name '*.txt' -print | sort | tail -n 1)"
grep -q '^writable_primary_pre_stop_checked=true$' "$primary_gate_failure_record" \
  || fail 'post-backup failure record lost the successful pre-stop primary gate'
grep -q '^writable_primary_pre_quiesce_checked=true$' "$primary_gate_failure_record" \
  || fail 'post-backup failure record lost the successful pre-quiesce primary gate'
grep -q '^writable_primary_pre_migration_checked=false$' "$primary_gate_failure_record" \
  || fail 'post-backup failure record falsely claimed the pre-migration gate'
grep -q '^migration_started=false$' "$primary_gate_failure_record" \
  || fail 'post-backup failure record falsely claimed migration start'
grep -q '^target_build_may_have_started=true$' "$primary_gate_failure_record" \
  || fail 'post-backup failure record lost the immutable target build boundary'
grep -q '^retry_requires_descendant_sha=true$' "$primary_gate_failure_record" \
  || fail 'post-backup failure record did not require a reviewed descendant SHA'

printf 'MARK post-build-same-sha-rejected\n' >>"$CALL_LOG"
if "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$PRIMARY_GATE_FAILED_SHA"; then
  fail 'post-build failure allowed the same immutable SHA to be retried'
fi
same_sha_post_build_log="$(awk '/^MARK post-build-same-sha-rejected$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^build:\|^registry_stop$\|^alembic_upgrade$' <<<"$same_sha_post_build_log"; then
  fail 'same-SHA post-build retry reached a build, writer stop, or migration'
fi
assert_current_sha "$SHA_ONE"
assert_runtime_marker "$SHA_ONE" verified

printf 'registry-primary-gate-descendant\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'reviewed descendant after primary gate fault'
PRIMARY_GATE_DESCENDANT_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK post-build-descendant-success\n' >>"$CALL_LOG"
"$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$PRIMARY_GATE_DESCENDANT_SHA"
assert_current_sha "$PRIMARY_GATE_DESCENDANT_SHA"
assert_runtime_marker "$PRIMARY_GATE_DESCENDANT_SHA" verified
descendant_retry_log="$(awk '/^MARK post-build-descendant-success$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^build:registry-api$' <<<"$descendant_retry_log" \
  || fail 'reviewed descendant did not build Registry after the post-build failure'
SHA_ONE="$PRIMARY_GATE_DESCENDANT_SHA"

metadata_release_dir="${AKL_RELEASE_ROOT}/releases/${SHA_ONE}"
metadata_backup_dir="${TMP_ROOT}/release-metadata-backup"
mkdir -p "$metadata_backup_dir"
cp "${metadata_release_dir}/.akl-release-sha" "${metadata_backup_dir}/release-sha"
cp "${metadata_release_dir}/.akl-release-manifest" "${metadata_backup_dir}/release-manifest"

restore_release_metadata() {
  chmod u+w "$metadata_release_dir"
  rm -f \
    "${metadata_release_dir}/.akl-release-sha" \
    "${metadata_release_dir}/.akl-release-manifest"
  cp "${metadata_backup_dir}/release-sha" "${metadata_release_dir}/.akl-release-sha"
  cp "${metadata_backup_dir}/release-manifest" "${metadata_release_dir}/.akl-release-manifest"
  chmod a-w \
    "${metadata_release_dir}/.akl-release-sha" \
    "${metadata_release_dir}/.akl-release-manifest" \
    "$metadata_release_dir"
}

expect_release_metadata_rejected() {
  local reason="$1"
  if "$SOURCE_ROOT/scripts/prepare_docker_home_release.sh" "$SHA_ONE" >/dev/null 2>&1; then
    fail "existing release accepted invalid metadata: ${reason}"
  fi
  restore_release_metadata
}

chmod u+w "$metadata_release_dir"
rm -f "${metadata_release_dir}/.akl-release-manifest"
chmod a-w "$metadata_release_dir"
expect_release_metadata_rejected 'missing manifest'

chmod u+w "${metadata_release_dir}/.akl-release-manifest"
printf 'git_sha=%s\ntrusted_ref=refs/remotes/origin/not-main\nprepared_utc=2026-01-01T00:00:00Z\n' \
  "$SHA_ONE" >"${metadata_release_dir}/.akl-release-manifest"
chmod a-w "${metadata_release_dir}/.akl-release-manifest"
expect_release_metadata_rejected 'manifest trusted ref mismatch'

chmod u+w "${metadata_release_dir}/.akl-release-manifest"
printf 'git_sha=%s\ntrusted_ref=refs/remotes/origin/main\nprepared_utc=2026-01-01T00:00:00Z\n' \
  '0000000000000000000000000000000000000000' >"${metadata_release_dir}/.akl-release-manifest"
chmod a-w "${metadata_release_dir}/.akl-release-manifest"
expect_release_metadata_rejected 'manifest target SHA mismatch'

chmod u+w "${metadata_release_dir}/.akl-release-manifest"
printf 'git_sha=%s\ntrusted_ref=refs/remotes/origin/main\nprepared_utc=2026-02-30T00:00:00Z\n' \
  "$SHA_ONE" >"${metadata_release_dir}/.akl-release-manifest"
chmod a-w "${metadata_release_dir}/.akl-release-manifest"
expect_release_metadata_rejected 'manifest invalid timestamp'

chmod u+w "${metadata_release_dir}/.akl-release-manifest"
printf 'git_sha=%s\ntrusted_ref=refs/remotes/origin/main\nprepared_utc=2026-01-01T00:00:00Z\nextra=forbidden\n' \
  "$SHA_ONE" >"${metadata_release_dir}/.akl-release-manifest"
chmod a-w "${metadata_release_dir}/.akl-release-manifest"
expect_release_metadata_rejected 'manifest extra key'

chmod u+w "$metadata_release_dir"
rm -f "${metadata_release_dir}/.akl-release-manifest"
ln -s "${metadata_backup_dir}/release-manifest" "${metadata_release_dir}/.akl-release-manifest"
chmod a-w "$metadata_release_dir"
expect_release_metadata_rejected 'manifest symlink'

chmod u+w "$metadata_release_dir"
rm -f "${metadata_release_dir}/.akl-release-manifest"
ln "${metadata_backup_dir}/release-manifest" "${metadata_release_dir}/.akl-release-manifest"
chmod a-w "$metadata_release_dir"
expect_release_metadata_rejected 'manifest hardlink'

chmod u+w "$metadata_release_dir"
rm -f "${metadata_release_dir}/.akl-release-sha"
chmod a-w "$metadata_release_dir"
expect_release_metadata_rejected 'missing SHA marker'

chmod u+w "${metadata_release_dir}/.akl-release-sha"
printf '%s\n\n' "$SHA_ONE" >"${metadata_release_dir}/.akl-release-sha"
chmod a-w "${metadata_release_dir}/.akl-release-sha"
expect_release_metadata_rejected 'non-exact SHA marker content'

chmod u+w "$metadata_release_dir"
rm -f "${metadata_release_dir}/.akl-release-sha"
ln -s "${metadata_backup_dir}/release-sha" "${metadata_release_dir}/.akl-release-sha"
chmod a-w "$metadata_release_dir"
expect_release_metadata_rejected 'SHA marker symlink'

chmod u+w "$metadata_release_dir"
rm -f "${metadata_release_dir}/.akl-release-sha"
ln "${metadata_backup_dir}/release-sha" "${metadata_release_dir}/.akl-release-sha"
chmod a-w "$metadata_release_dir"
expect_release_metadata_rejected 'SHA marker hardlink'

"$SOURCE_ROOT/scripts/prepare_docker_home_release.sh" "$SHA_ONE" >/dev/null

release_file="${AKL_RELEASE_ROOT}/releases/${SHA_ONE}/apps/web/release.txt"
chmod u+w "$release_file"
printf 'tampered\n' >"$release_file"
chmod a-w "$release_file"
if "$SOURCE_ROOT/scripts/prepare_docker_home_release.sh" "$SHA_ONE" >/dev/null 2>&1; then
  fail 'tampered immutable release was accepted'
fi
chmod u+w "$release_file"
printf 'web-v1\n' >"$release_file"
chmod a-w "$release_file"
"$SOURCE_ROOT/scripts/prepare_docker_home_release.sh" "$SHA_ONE" >/dev/null

printf 'web-v2\n' >"$WORK_REPO/apps/web/release.txt"
git -C "$WORK_REPO" add apps/web/release.txt
git -C "$WORK_REPO" commit --quiet -m 'web release that fails readiness'
SHA_TWO="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK second-release\n' >>"$CALL_LOG"
if FAKE_CURL_FAIL_READY=true \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SHA_TWO"; then
  fail 'release with failed readiness was activated'
fi
assert_current_sha "$SHA_ONE"
assert_runtime_marker "$SHA_TWO" failed
second_log="$(awk '/^MARK second-release$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^build:web chat-web$' <<<"$second_log" \
  || fail 'web source release did not build both web profiles'
if grep -q '^build:.*registry-api\|^build:ingestion-service\|^build:.*rag-retrieval-service' <<<"$second_log"; then
  fail 'web-only release built an unaffected service'
fi
[[ ! -e "${FAKE_RUNTIME_DIR}/containers/web" ]] \
  || fail 'failed web readiness left the unverified target container present'
[[ ! -e "${FAKE_RUNTIME_DIR}/containers/chat-web" ]] \
  || fail 'failed web readiness left the unverified chat target container present'
grep -q '^docker_rm:web:akl-test-web-1$' <<<"$second_log" \
  || fail 'failed web readiness did not force-remove the exact target container'
grep -q '^docker_rm:chat-web:akl-test-chat-web-1$' <<<"$second_log" \
  || fail 'failed web readiness did not force-remove the exact chat target container'
second_record="$(deployment_record_for_sha "$SHA_TWO")"
grep -Fxq 'target_web_quarantined=true' "$second_record" \
  || fail 'failed web readiness record omitted the successful quarantine'
grep -Fxq 'target_web_quarantine_failed=false' "$second_record" \
  || fail 'failed web readiness recorded a spurious quarantine failure'
grep -Fxq 'target_chat_web_quarantined=true' "$second_record" \
  || fail 'failed web readiness record omitted the successful chat quarantine'
grep -Fxq 'target_chat_web_quarantine_failed=false' "$second_record" \
  || fail 'failed web readiness recorded a spurious chat quarantine failure'
grep -Fxq 'deploy_lock_preserved=false' "$second_record" \
  || fail 'successful web quarantine unexpectedly preserved the deployment lock'
[[ ! -e "${AKL_RELEASE_ROOT}/.immutable-deploy.lock" ]] \
  || fail 'successful web quarantine left a deployment lock'

git -C "$WORK_REPO" switch --quiet -c side-release "$SHA_ONE"
printf 'side-release\n' >"$WORK_REPO/apps/web/side-release.txt"
git -C "$WORK_REPO" add apps/web/side-release.txt
git -C "$WORK_REPO" commit --quiet -m 'non-descendant reachable release'
SIDE_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" switch --quiet main
git -C "$WORK_REPO" merge --quiet --no-ff side-release -m 'merge reachable side release'
MERGED_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main

printf 'MARK non-descendant\n' >>"$CALL_LOG"
if "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SIDE_SHA"; then
  fail 'release not descending from the applied runtime marker was accepted'
fi
assert_current_sha "$SHA_ONE"
assert_runtime_marker "$SHA_TWO" failed
non_descendant_log="$(awk '/^MARK non-descendant$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^build:' <<<"$non_descendant_log"; then
  fail 'non-descendant runtime release reached the build phase'
fi

printf 'MARK ordinary-recovery-bypass\n' >>"$CALL_LOG"
if "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$MERGED_SHA"; then
  fail 'ordinary deployment bypassed the forward-fix recovery entry point'
fi
assert_current_sha "$SHA_ONE"
assert_runtime_marker "$SHA_TWO" failed
ordinary_bypass_log="$(awk '/^MARK ordinary-recovery-bypass$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^build:' <<<"$ordinary_bypass_log"; then
  fail 'ordinary recovery bypass reached the build phase'
fi

if "$SOURCE_ROOT/scripts/rollback_docker_home_release.sh" \
  --failed-sha "$SHA_TWO" \
  --forward-fix-sha "$SHA_ONE"; then
  fail 'backward rollback was accepted'
fi
assert_current_sha "$SHA_ONE"

printf 'web-v3-forward-fix\n' >"$WORK_REPO/apps/web/release.txt"
git -C "$WORK_REPO" add apps/web/release.txt
git -C "$WORK_REPO" commit --quiet -m 'forward fix readiness'
SHA_THREE="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK forward-fix\n' >>"$CALL_LOG"
"$SOURCE_ROOT/scripts/rollback_docker_home_release.sh" \
  --failed-sha "$SHA_TWO" \
  --forward-fix-sha "$SHA_THREE"
assert_current_sha "$SHA_THREE"
assert_runtime_marker "$SHA_THREE" verified
forward_log="$(awk '/^MARK forward-fix$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^build:web chat-web$' <<<"$forward_log" \
  || fail 'forward fix did not build both web profiles'
if grep -q '^build:.*registry-api\|^build:ingestion-service\|^build:.*rag-retrieval-service' <<<"$forward_log"; then
  fail 'forward fix built an unaffected service'
fi
[[ "$(cat "${AKL_RELEASE_ROOT}/repo/sentinel")" == "must remain untouched" ]] \
  || fail 'legacy dirty checkout was modified during recovery'

printf 'web-quarantine-failure\n' >"$WORK_REPO/apps/web/release.txt"
git -C "$WORK_REPO" add apps/web/release.txt
git -C "$WORK_REPO" commit --quiet -m 'web release with quarantine failure fixture'
QUARANTINE_FAILED_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK quarantine-failure\n' >>"$CALL_LOG"
if FAKE_CURL_FAIL_READY=true \
  FAKE_DOCKER_RM_FAIL_SERVICE=web \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$QUARANTINE_FAILED_SHA"; then
  fail 'release with a failed target quarantine unexpectedly succeeded'
fi
assert_current_sha "$SHA_THREE"
assert_runtime_marker "$QUARANTINE_FAILED_SHA" failed
quarantine_failure_record="$(deployment_record_for_sha "$QUARANTINE_FAILED_SHA")"
grep -Fxq 'target_web_quarantined=false' "$quarantine_failure_record" \
  || fail 'failed quarantine recorded a successful web quarantine'
grep -Fxq 'target_web_quarantine_failed=true' "$quarantine_failure_record" \
  || fail 'failed quarantine record omitted the web quarantine failure'
grep -Fxq 'target_chat_web_quarantined=true' "$quarantine_failure_record" \
  || fail 'failed quarantine did not remove the unverified chat target'
grep -Fxq 'target_chat_web_quarantine_failed=false' "$quarantine_failure_record" \
  || fail 'failed quarantine recorded a spurious chat quarantine failure'
grep -Fxq 'deploy_lock_preserved=true' "$quarantine_failure_record" \
  || fail 'failed quarantine record did not require lock preservation'
[[ -d "${AKL_RELEASE_ROOT}/.immutable-deploy.lock" ]] \
  || fail 'failed quarantine released the recovery lock'
[[ -d "${FAKE_RUNTIME_DIR}/containers/web" ]] \
  || fail 'failed quarantine fixture unexpectedly removed the target container'
quarantine_failure_log="$(awk '/^MARK quarantine-failure$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^fault:docker-rm:web:akl-test-web-1$' <<<"$quarantine_failure_log" \
  || fail 'failed quarantine fixture did not reach exact target removal'
if "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$QUARANTINE_FAILED_SHA" >/dev/null 2>&1; then
  fail 'preserved recovery lock allowed an ordinary deployment re-entry'
fi

# Simulate the documented operator investigation: prove and remove the exact
# unverified target, then clear only the stale lock owned by the exited process.
docker rm --force akl-test-web-1 >/dev/null
rm -f "${AKL_RELEASE_ROOT}/.immutable-deploy.lock/owner"
rmdir "${AKL_RELEASE_ROOT}/.immutable-deploy.lock"

printf 'web-quarantine-forward-fix\n' >"$WORK_REPO/apps/web/release.txt"
git -C "$WORK_REPO" add apps/web/release.txt
git -C "$WORK_REPO" commit --quiet -m 'web forward fix after quarantine failure'
QUARANTINE_FIX_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
"$SOURCE_ROOT/scripts/rollback_docker_home_release.sh" \
  --failed-sha "$QUARANTINE_FAILED_SHA" \
  --forward-fix-sha "$QUARANTINE_FIX_SHA"
assert_current_sha "$QUARANTINE_FIX_SHA"
assert_runtime_marker "$QUARANTINE_FIX_SHA" verified
SHA_THREE="$QUARANTINE_FIX_SHA"

printf 'registry-v2-backup-failure\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'registry backup failure release'
SHA_FOUR="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK registry-backup-failure\n' >>"$CALL_LOG"
if FAKE_PG_DUMP_FAIL=true \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SHA_FOUR"; then
  fail 'Registry release continued after a failed verified backup'
fi
assert_current_sha "$SHA_THREE"
assert_runtime_marker "$SHA_THREE" verified
[[ "$(<"${FAKE_RUNTIME_DIR}/containers/registry-api/running")" == "true" ]] \
  || fail 'pre-apply failure did not restore the exact old Registry container'
[[ "$(<"${FAKE_RUNTIME_DIR}/containers/registry-api/image_ref")" \
  == "$(<"${FAKE_RUNTIME_DIR}/containers/registry-api/image_id")" ]] \
  || fail 'pre-apply failure restored a Registry container not pinned by durable image ID'
backup_failure_log="$(awk '/^MARK registry-backup-failure$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^registry_stop$' <<<"$backup_failure_log" \
  || fail 'Registry writer was not stopped before the failed backup'
grep -q '^docker_start:akl-test-registry-api-1$' <<<"$backup_failure_log" \
  || fail 'the exact old Registry container was not restarted after a pre-apply failure'
if grep -q '^alembic_upgrade$' <<<"$backup_failure_log"; then
  fail 'migration started after the Registry backup failed'
fi

printf 'registry-target-multi-head\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'registry release with multiple target heads'
TARGET_HEAD_FAILED_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK target-multi-head\n' >>"$CALL_LOG"
if FAKE_ALEMBIC_MULTI_HEAD_TARGET=true \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$TARGET_HEAD_FAILED_SHA"; then
  fail 'Registry release accepted multiple target Alembic heads'
fi
assert_current_sha "$SHA_THREE"
assert_runtime_marker "$SHA_THREE" verified
target_multi_head_log="$(awk '/^MARK target-multi-head$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^postgres_tool:pg_dump$' <<<"$target_multi_head_log" \
  || fail 'target-head fixture did not reach the verified backup'
if grep -q '^alembic_upgrade$\|^runtime_marker:' <<<"$target_multi_head_log"; then
  fail 'multiple target Alembic heads reached migration or runtime marker'
fi
grep -q '^docker_start:akl-test-registry-api-1$' <<<"$target_multi_head_log" \
  || fail 'target-head pre-apply failure did not restore the exact predecessor'

printf 'registry-v3-multi-head\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'registry release with post-upgrade multi-head ambiguity'
SHA_FIVE="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK registry-ambiguous\n' >>"$CALL_LOG"
if FAKE_ALEMBIC_MULTI_HEAD_POST=true \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SHA_FIVE"; then
  fail 'Registry release accepted multiple post-upgrade Alembic heads'
fi
assert_current_sha "$SHA_THREE"
assert_runtime_marker "$SHA_FIVE" failed
registry_ambiguous_log="$(awk '/^MARK registry-ambiguous$/ {capture=1; next} capture' "$CALL_LOG")"
registry_stop_line="$(grep -n '^registry_stop$' <<<"$registry_ambiguous_log" | head -n 1 | cut -d: -f1)"
registry_dump_line="$(grep -n '^postgres_tool:pg_dump$' <<<"$registry_ambiguous_log" | head -n 1 | cut -d: -f1)"
registry_migration_line="$(grep -n '^alembic_upgrade$' <<<"$registry_ambiguous_log" | head -n 1 | cut -d: -f1)"
[[ "$registry_stop_line" -lt "$registry_dump_line" && "$registry_dump_line" -lt "$registry_migration_line" ]] \
  || fail 'Registry writer quiesce, backup and migration ordering is unsafe'
grep -q '^alembic_current_multi_head$' <<<"$registry_ambiguous_log" \
  || fail 'post-upgrade multi-head fault was not injected'
if grep -q '^up:' <<<"$registry_ambiguous_log"; then
  fail 'post-upgrade multi-head ambiguity reached Registry restart'
fi
if grep -q '^docker_start:' <<<"$registry_ambiguous_log"; then
  fail 'old Registry container was restored after a possibly applied migration'
fi

printf 'registry-v4-forward-fix\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'registry forward fix'
SHA_SIX="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
if "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SHA_SIX"; then
  fail 'ordinary Registry deploy bypassed recovery after migration ambiguity'
fi
printf 'MARK registry-forward-fix\n' >>"$CALL_LOG"
"$SOURCE_ROOT/scripts/rollback_docker_home_release.sh" \
  --failed-sha "$SHA_FIVE" \
  --forward-fix-sha "$SHA_SIX"
assert_current_sha "$SHA_SIX"
assert_runtime_marker "$SHA_SIX" verified
registry_log="$(awk '/^MARK registry-forward-fix$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^build:registry-api$' <<<"$registry_log" \
  || fail 'Registry forward-fix did not build Registry'
if grep -q '^build:ingestion-service\|^build:.*web\|^build:.*rag-retrieval-service' <<<"$registry_log"; then
  fail 'Registry forward-fix built an unaffected service'
fi
[[ "$(tr -d '[:space:]' <"$FAKE_WEB_STATE")" == "$SHA_THREE" ]] \
  || fail 'Registry-only release unexpectedly replaced the web image'

printf 'registry-env-snapshot-binding\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'registry env snapshot binding'
ENV_SNAPSHOT_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK persistent-env-swap-before-alembic\n' >>"$CALL_LOG"
FAKE_REPLACE_PERSISTENT_ENV_BEFORE_ALEMBIC=true \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$ENV_SNAPSHOT_SHA"
assert_current_sha "$ENV_SNAPSHOT_SHA"
assert_runtime_marker "$ENV_SNAPSHOT_SHA" verified
env_swap_log="$(awk '/^MARK persistent-env-swap-before-alembic$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^fault:persistent-env-replaced-before-alembic$' <<<"$env_swap_log" \
  || fail 'persistent production env replacement fault was not injected before Alembic'
grep -q '^alembic_upgrade$' <<<"$env_swap_log" \
  || fail 'env snapshot binding fixture did not reach Alembic on the original gated configuration'
if grep -F -- "--env-file\t${FAKE_PERSISTENT_ENV_FILE}" <<<"$env_swap_log" >/dev/null; then
  fail 'deployment reused the mutable persistent env path after snapshot creation'
fi
set_env_value AKL_RELEASE_EXPECTED_REGISTRY_DB_HOST db.internal
set_env_value AKL_RELEASE_EXPECTED_REGISTRY_DB_PORT 5432
set_env_value AKL_RELEASE_EXPECTED_REGISTRY_DB_NAME registry
set_env_value AKL_RELEASE_EXPECTED_REGISTRY_DB_USER release_user
set_env_value AKL_REGISTRY_DATABASE_URL \
  postgresql+psycopg://release_user:test_secret@db.internal:5432/registry
SHA_SIX="$ENV_SNAPSHOT_SHA"

printf 'registry-retarget-immediately-before-upgrade\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'Registry pre-execution retarget fault'
PRE_EXEC_RETARGET_FAILED_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK image-retarget-before-alembic-upgrade\n' >>"$CALL_LOG"
if FAKE_IMAGE_RETARGET_BEFORE_COMPOSE_RUN_PHASE=upgrade \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$PRE_EXEC_RETARGET_FAILED_SHA"; then
  fail 'release accepted a Registry tag retarget immediately before Alembic execution'
fi
assert_current_sha "$SHA_SIX"
assert_runtime_marker "$PRE_EXEC_RETARGET_FAILED_SHA" failed
pre_exec_retarget_record="$(deployment_record_for_sha "$PRE_EXEC_RETARGET_FAILED_SHA")"
pre_exec_registry_image_id="$(awk -F= '$1 == "target_registry_image_id" {print $2}' "$pre_exec_retarget_record")"
[[ "$pre_exec_registry_image_id" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || fail 'pre-execution retarget record lost the durable Registry image ID'
pre_exec_retarget_log="$(awk '/^MARK image-retarget-before-alembic-upgrade$/ {capture=1; next} capture' "$CALL_LOG")"
grep -Fxq "fault:image-retarget-before-compose-run:upgrade:${pre_exec_registry_image_id}" \
  <<<"$pre_exec_retarget_log" \
  || fail 'pre-execution Registry retarget fault did not run at the upgrade boundary'
grep -Fxq "compose_run_execution:registry-api:upgrade:${pre_exec_registry_image_id}" \
  <<<"$pre_exec_retarget_log" \
  || fail 'Alembic upgrade was not executed from the durable Registry image ID'
grep -Fxq 'alembic_upgrade' <<<"$pre_exec_retarget_log" \
  || fail 'pre-execution retarget fixture did not reach Alembic upgrade'
retargeted_registry_image_id="sha256:$(printf 'c%.0s' {1..64})"
if grep -Fq "compose_run_execution:registry-api:upgrade:${retargeted_registry_image_id}" \
  <<<"$pre_exec_retarget_log"; then
  fail 'Alembic upgrade followed the concurrently retargeted full-SHA tag'
fi

printf 'registry-forward-fix-after-pre-exec-retarget\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'Registry forward fix after pre-execution retarget'
PRE_EXEC_RETARGET_FIX_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
"$SOURCE_ROOT/scripts/rollback_docker_home_release.sh" \
  --failed-sha "$PRE_EXEC_RETARGET_FAILED_SHA" \
  --forward-fix-sha "$PRE_EXEC_RETARGET_FIX_SHA"
assert_current_sha "$PRE_EXEC_RETARGET_FIX_SHA"
assert_runtime_marker "$PRE_EXEC_RETARGET_FIX_SHA" verified
SHA_SIX="$PRE_EXEC_RETARGET_FIX_SHA"

printf 'web-retag-during-compose-up\n' >"$WORK_REPO/apps/web/release.txt"
git -C "$WORK_REPO" add apps/web/release.txt
git -C "$WORK_REPO" commit --quiet -m 'web retag during compose up fault'
UP_RETAG_FAILED_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK image-retarget-during-up\n' >>"$CALL_LOG"
if FAKE_IMAGE_RETARGET_DURING_UP_SERVICE=web \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$UP_RETAG_FAILED_SHA"; then
  fail 'release accepted a retagged image recreated by Compose up'
fi
assert_current_sha "$SHA_SIX"
assert_runtime_marker "$UP_RETAG_FAILED_SHA" failed
up_retag_log="$(awk '/^MARK image-retarget-during-up$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^fault:image-retarget-during-up:web$' <<<"$up_retag_log" \
  || fail 'compose-up image retarget fault was not injected'
if grep -q 'runtime_marker:.*:verified:verified\|^atomic_current:' <<<"$up_retag_log"; then
  fail 'compose-up image retarget reached verified activation'
fi

printf 'web-retag-during-compose-up-forward-fix\n' >"$WORK_REPO/apps/web/release.txt"
git -C "$WORK_REPO" add apps/web/release.txt
git -C "$WORK_REPO" commit --quiet -m 'web forward fix after compose up retag'
UP_RETAG_FIX_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
"$SOURCE_ROOT/scripts/rollback_docker_home_release.sh" \
  --failed-sha "$UP_RETAG_FAILED_SHA" \
  --forward-fix-sha "$UP_RETAG_FIX_SHA"
assert_current_sha "$UP_RETAG_FIX_SHA"
assert_runtime_marker "$UP_RETAG_FIX_SHA" verified
SHA_SIX="$UP_RETAG_FIX_SHA"

printf 'partial-multi-service-up\n' >"$WORK_REPO/scripts/partial-up-release.txt"
git -C "$WORK_REPO" add scripts/partial-up-release.txt
git -C "$WORK_REPO" commit --quiet -m 'partial multi-service Compose up fault'
PARTIAL_UP_FAILED_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK partial-multi-service-up\n' >>"$CALL_LOG"
if FAKE_COMPOSE_UP_FAIL_AFTER_SERVICE=registry-api \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$PARTIAL_UP_FAILED_SHA"; then
  fail 'release accepted a partial multi-service Compose up'
fi
assert_current_sha "$SHA_SIX"
assert_runtime_marker "$PARTIAL_UP_FAILED_SHA" failed
partial_up_record="$(deployment_record_for_sha "$PARTIAL_UP_FAILED_SHA")"
grep -Fxq 'services=registry-api,ingestion-service,rag-retrieval-service,web,chat-web' "$partial_up_record" \
  || fail 'partial-up fixture did not select every release service'
grep -Fxq 'migration_started=true' "$partial_up_record" \
  || fail 'partial-up fixture did not cross the forward-only migration boundary'
grep -Fxq 'target_registry_quarantined=true' "$partial_up_record" \
  || fail 'partial-up failure did not quarantine the created Registry target'
grep -Fxq 'target_ingestion_quarantine_failed=true' "$partial_up_record" \
  || fail 'partial-up failure did not preserve the unmatched ingestion predecessor'
grep -Fxq 'target_rag_quarantine_failed=true' "$partial_up_record" \
  || fail 'partial-up failure did not preserve the unmatched RAG predecessor'
grep -Fxq 'target_web_quarantine_failed=true' "$partial_up_record" \
  || fail 'partial-up failure did not preserve the unmatched web predecessor'
grep -Fxq 'target_chat_web_quarantine_failed=true' "$partial_up_record" \
  || fail 'partial-up failure did not preserve the unmatched chat web predecessor'
grep -Fxq 'deploy_lock_preserved=true' "$partial_up_record" \
  || fail 'partial-up failure did not durably preserve the incident lock'
partial_up_registry_image_id="$(awk -F= '$1 == "target_registry_image_id" {print $2}' "$partial_up_record")"
partial_up_log="$(awk '/^MARK partial-multi-service-up$/ {capture=1; next} capture' "$CALL_LOG")"
grep -Fxq 'fault:compose-up-after:registry-api' <<<"$partial_up_log" \
  || fail 'partial multi-service Compose-up fault was not injected'
grep -Fxq "container_execution:registry-api:${partial_up_registry_image_id}:${partial_up_registry_image_id}" \
  <<<"$partial_up_log" \
  || fail 'partial Compose up did not create Registry from its durable image ID'
grep -q '^docker_rm:registry-api:' <<<"$partial_up_log" \
  || fail 'partial Compose up did not remove the proven Registry target'
if grep -q '^docker_rm:ingestion-service:\|^docker_rm:rag-retrieval-service:\|^docker_rm:web:\|^docker_rm:chat-web:' <<<"$partial_up_log"; then
  fail 'partial Compose up removed unmatched predecessor containers'
fi
[[ ! -e "${FAKE_RUNTIME_DIR}/containers/registry-api" ]] \
  || fail 'partial Compose-up quarantine retained the Registry target'
[[ -d "${FAKE_RUNTIME_DIR}/containers/ingestion-service" \
  && -d "${FAKE_RUNTIME_DIR}/containers/rag-retrieval-service" \
  && -d "${FAKE_RUNTIME_DIR}/containers/web" \
  && -d "${FAKE_RUNTIME_DIR}/containers/chat-web" ]] \
  || fail 'partial Compose-up recovery lost an unmatched predecessor container'
[[ -d "${AKL_RELEASE_ROOT}/.immutable-deploy.lock" ]] \
  || fail 'partial Compose-up failure lost the preserved deployment lock'
rm -f "${AKL_RELEASE_ROOT}/.immutable-deploy.lock/owner"
rmdir "${AKL_RELEASE_ROOT}/.immutable-deploy.lock"

printf 'partial-multi-service-up-forward-fix\n' >"$WORK_REPO/scripts/partial-up-release.txt"
git -C "$WORK_REPO" add scripts/partial-up-release.txt
git -C "$WORK_REPO" commit --quiet -m 'forward fix after partial multi-service up'
PARTIAL_UP_FIX_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
"$SOURCE_ROOT/scripts/rollback_docker_home_release.sh" \
  --failed-sha "$PARTIAL_UP_FAILED_SHA" \
  --forward-fix-sha "$PARTIAL_UP_FIX_SHA"
assert_current_sha "$PARTIAL_UP_FIX_SHA"
assert_runtime_marker "$PARTIAL_UP_FIX_SHA" verified
SHA_SIX="$PARTIAL_UP_FIX_SHA"

printf 'web-v4-image-mismatch\n' >"$WORK_REPO/apps/web/release.txt"
git -C "$WORK_REPO" add apps/web/release.txt
git -C "$WORK_REPO" commit --quiet -m 'web runtime image mismatch'
SHA_SEVEN="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK image-mismatch\n' >>"$CALL_LOG"
if FAKE_CONTAINER_IMAGE_MISMATCH_SERVICE=web \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SHA_SEVEN"; then
  fail 'container with a mismatched image ID passed verification'
fi
assert_current_sha "$SHA_SIX"
assert_runtime_marker "$SHA_SEVEN" failed
image_mismatch_record="$(deployment_record_for_sha "$SHA_SEVEN")"
grep -Fxq 'target_web_quarantine_failed=true' "$image_mismatch_record" \
  || fail 'unprovable runtime image mismatch did not record quarantine failure'
grep -Fxq 'deploy_lock_preserved=true' "$image_mismatch_record" \
  || fail 'unprovable runtime image mismatch did not preserve the deployment lock'
[[ -d "${AKL_RELEASE_ROOT}/.immutable-deploy.lock" ]] \
  || fail 'unprovable runtime image mismatch lost the incident lock'
rm -rf "${FAKE_RUNTIME_DIR}/containers/web"
rm -f "${AKL_RELEASE_ROOT}/.immutable-deploy.lock/owner"
rmdir "${AKL_RELEASE_ROOT}/.immutable-deploy.lock"

printf 'web-v5-image-forward-fix\n' >"$WORK_REPO/apps/web/release.txt"
git -C "$WORK_REPO" add apps/web/release.txt
git -C "$WORK_REPO" commit --quiet -m 'web image identity forward fix'
SHA_EIGHT="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
if "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SHA_EIGHT"; then
  fail 'ordinary deploy bypassed recovery after image identity ambiguity'
fi
"$SOURCE_ROOT/scripts/rollback_docker_home_release.sh" \
  --failed-sha "$SHA_SEVEN" \
  --forward-fix-sha "$SHA_EIGHT"
assert_current_sha "$SHA_EIGHT"
assert_runtime_marker "$SHA_EIGHT" verified

printf 'rag-v2-label-mismatch\n' >"$WORK_REPO/services/rag-retrieval-service/release.txt"
git -C "$WORK_REPO" add services/rag-retrieval-service/release.txt
git -C "$WORK_REPO" commit --quiet -m 'RAG image label mismatch'
SHA_NINE="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK label-mismatch\n' >>"$CALL_LOG"
if FAKE_IMAGE_LABEL_MISMATCH_SERVICE=rag-retrieval-service \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SHA_NINE"; then
  fail 'image with a mismatched revision label passed verification'
fi
assert_current_sha "$SHA_EIGHT"
assert_runtime_marker "$SHA_EIGHT" verified
label_mismatch_log="$(awk '/^MARK label-mismatch$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^up:\|^runtime_marker:' <<<"$label_mismatch_log"; then
  fail 'image with mismatched provenance labels reached restart or runtime marker'
fi

printf 'rag-v3-label-forward-fix\n' >"$WORK_REPO/services/rag-retrieval-service/release.txt"
git -C "$WORK_REPO" add services/rag-retrieval-service/release.txt
git -C "$WORK_REPO" commit --quiet -m 'RAG label forward fix'
SHA_TEN="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
"$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SHA_TEN"
assert_current_sha "$SHA_TEN"
assert_runtime_marker "$SHA_TEN" verified

printf 'web-retag-during-smoke\n' >"$WORK_REPO/apps/web/release.txt"
git -C "$WORK_REPO" add apps/web/release.txt
git -C "$WORK_REPO" commit --quiet -m 'web retag during smoke fault'
SMOKE_RETAG_FAILED_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK image-retarget-during-smoke\n' >>"$CALL_LOG"
if FAKE_IMAGE_RETARGET_DURING_SMOKE_SERVICE=web \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SMOKE_RETAG_FAILED_SHA"; then
  fail 'release accepted an image retag and container recreate during smoke verification'
fi
assert_current_sha "$SHA_TEN"
assert_runtime_marker "$SMOKE_RETAG_FAILED_SHA" failed
smoke_retag_log="$(awk '/^MARK image-retarget-during-smoke$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^fault:image-retarget-during-smoke:web$' <<<"$smoke_retag_log" \
  || fail 'smoke-time image retarget fault was not injected'
if grep -q 'runtime_marker:.*:verified:verified\|^atomic_current:' <<<"$smoke_retag_log"; then
  fail 'smoke-time image retarget reached verified activation'
fi

printf 'web-retag-during-smoke-forward-fix\n' >"$WORK_REPO/apps/web/release.txt"
git -C "$WORK_REPO" add apps/web/release.txt
git -C "$WORK_REPO" commit --quiet -m 'web forward fix after smoke retag'
SMOKE_RETAG_FIX_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
"$SOURCE_ROOT/scripts/rollback_docker_home_release.sh" \
  --failed-sha "$SMOKE_RETAG_FAILED_SHA" \
  --forward-fix-sha "$SMOKE_RETAG_FIX_SHA"
assert_current_sha "$SMOKE_RETAG_FIX_SHA"
assert_runtime_marker "$SMOKE_RETAG_FIX_SHA" verified
SHA_TEN="$SMOKE_RETAG_FIX_SHA"

printf 'web-power-loss-boundary\n' >"$WORK_REPO/apps/web/release.txt"
git -C "$WORK_REPO" add apps/web/release.txt
git -C "$WORK_REPO" commit --quiet -m 'web activation power-loss boundary'
POWER_LOSS_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK power-loss-after-verified-marker\n' >>"$CALL_LOG"
if FAKE_KILL_AFTER_VERIFIED_MARKER=true \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$POWER_LOSS_SHA"; then
  fail 'deployment survived injected power loss after the verified marker'
fi
assert_current_sha "$SHA_TEN"
assert_runtime_marker "$POWER_LOSS_SHA" verified
power_loss_record="$(find "${AKL_RELEASE_ROOT}/deployments" -type f -name '*.txt' -print | sort | tail -n 1)"
grep -q '^status=activation_pending$' "$power_loss_record" \
  || fail 'power-loss record did not preserve the activation-pending boundary'
grep -q '^current_advanced=false$' "$power_loss_record" \
  || fail 'power-loss record falsely claimed current activation'
grep -q '^retry_requires_descendant_sha=true$' "$power_loss_record" \
  || fail 'marker-publish crash cleared the descendant requirement before durable verification returned'
[[ -d "${AKL_RELEASE_ROOT}/.immutable-deploy.lock" ]] \
  || fail 'power-loss fixture did not leave an operator-visible deployment lock'
rm -f "${AKL_RELEASE_ROOT}/.immutable-deploy.lock/owner"
rmdir "${AKL_RELEASE_ROOT}/.immutable-deploy.lock"
cleanup_stale_env_snapshot_for_sha "$POWER_LOSS_SHA"

durable_power_loss_web_id="$(awk -F= '$1 == "target_web_image_id" {print $2}' "$power_loss_record")"
[[ "$durable_power_loss_web_id" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || fail 'power-loss record did not retain a valid durable web image ID'
replacement_reconciliation_id="sha256:$(printf 'f%.0s' {1..64})"
printf '%s\n' "$replacement_reconciliation_id" >"${FAKE_RUNTIME_DIR}/images/web/id"
printf '%s\n' "$replacement_reconciliation_id" >"${FAKE_RUNTIME_DIR}/containers/web/image_id"
printf 'MARK reconcile-retagged-runtime-rejected\n' >>"$CALL_LOG"
if "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$POWER_LOSS_SHA"; then
  fail 'verified reconciliation trusted a retagged runtime instead of durable image evidence'
fi
assert_current_sha "$SHA_TEN"
assert_runtime_marker "$POWER_LOSS_SHA" verified
reconcile_retag_log="$(awk '/^MARK reconcile-retagged-runtime-rejected$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^build:\|^atomic_current:' <<<"$reconcile_retag_log"; then
  fail 'rejected retagged reconciliation rebuilt or activated the target'
fi
printf '%s\n' "$durable_power_loss_web_id" >"${FAKE_RUNTIME_DIR}/images/web/id"
printf '%s\n' "$durable_power_loss_web_id" >"${FAKE_RUNTIME_DIR}/containers/web/image_id"

printf 'MARK reconcile-verified-activation\n' >>"$CALL_LOG"
"$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$POWER_LOSS_SHA"
assert_current_sha "$POWER_LOSS_SHA"
assert_runtime_marker "$POWER_LOSS_SHA" verified
reconcile_log="$(awk '/^MARK reconcile-verified-activation$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^build:' <<<"$reconcile_log"; then
  fail 'verified activation reconciliation rebuilt an immutable target image'
fi
grep -q '^atomic_current:' <<<"$reconcile_log" \
  || fail 'verified activation reconciliation did not durably advance current'
reconciled_record="$(find "${AKL_RELEASE_ROOT}/deployments" -type f -name '*.txt' -print | sort | tail -n 1)"
grep -q '^status=reconciled_verified_activation$' "$reconciled_record" \
  || fail 'verified activation reconciliation was not durably recorded'

printf 'MARK mismatched-forward-fix-current\n' >>"$CALL_LOG"
if "$SOURCE_ROOT/scripts/rollback_docker_home_release.sh" \
  --failed-sha "$SHA_TEN" \
  --forward-fix-sha "$POWER_LOSS_SHA"; then
  fail 'mismatched forward-fix context reconciled an already-current verified target'
fi
assert_current_sha "$POWER_LOSS_SHA"
assert_runtime_marker "$POWER_LOSS_SHA" verified
mismatched_forward_fix_log="$(awk '/^MARK mismatched-forward-fix-current$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^build:\|^atomic_current:' <<<"$mismatched_forward_fix_log"; then
  fail 'mismatched forward-fix context reached build or activation'
fi

printf 'web-current-fsync-boundary\n' >"$WORK_REPO/apps/web/release.txt"
git -C "$WORK_REPO" add apps/web/release.txt
git -C "$WORK_REPO" commit --quiet -m 'web current fsync power-loss boundary'
CURRENT_FSYNC_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK power-loss-after-current-fsync\n' >>"$CALL_LOG"
if FAKE_KILL_AFTER_CURRENT_FSYNC=true \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$CURRENT_FSYNC_SHA"; then
  fail 'deployment survived injected power loss after current symlink fsync'
fi
assert_current_sha "$CURRENT_FSYNC_SHA"
assert_runtime_marker "$CURRENT_FSYNC_SHA" verified
current_fsync_record="$(find "${AKL_RELEASE_ROOT}/deployments" -type f -name '*.txt' -print | sort | tail -n 1)"
grep -q '^status=activating_current$' "$current_fsync_record" \
  || fail 'current-fsync crash record did not preserve the activating-current boundary'
grep -q '^current_advanced=false$' "$current_fsync_record" \
  || fail 'current-fsync crash record falsely claimed completed activation bookkeeping'
grep -q '^retry_requires_descendant_sha=false$' "$current_fsync_record" \
  || fail 'verified current-fsync boundary retained a descendant-only retry requirement'
[[ -d "${AKL_RELEASE_ROOT}/.immutable-deploy.lock" ]] \
  || fail 'current-fsync crash fixture did not leave an operator-visible deployment lock'
rm -f "${AKL_RELEASE_ROOT}/.immutable-deploy.lock/owner"
rmdir "${AKL_RELEASE_ROOT}/.immutable-deploy.lock"
cleanup_stale_env_snapshot_for_sha "$CURRENT_FSYNC_SHA"

printf 'MARK reconcile-current-fsync-success\n' >>"$CALL_LOG"
"$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$CURRENT_FSYNC_SHA"
assert_current_sha "$CURRENT_FSYNC_SHA"
assert_runtime_marker "$CURRENT_FSYNC_SHA" verified
current_fsync_reconcile_log="$(awk '/^MARK reconcile-current-fsync-success$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^build:\|^registry_stop$\|^alembic_upgrade$\|^atomic_current:' <<<"$current_fsync_reconcile_log"; then
  fail 'current-fsync success reconciliation repeated a build, writer stop, migration, or activation'
fi
current_fsync_reconciled_record="$(find "${AKL_RELEASE_ROOT}/deployments" -type f -name '*.txt' -print | sort | tail -n 1)"
grep -q '^status=reconciled_verified_success$' "$current_fsync_reconciled_record" \
  || fail 'current-fsync crash was not durably reconciled as verified success'
grep -q '^current_advanced=true$' "$current_fsync_reconciled_record" \
  || fail 'current-fsync reconciliation did not record the already-current activation'
POWER_LOSS_SHA="$CURRENT_FSYNC_SHA"

printf 'web-lock-owner-mismatch\n' >"$WORK_REPO/apps/web/release.txt"
git -C "$WORK_REPO" add apps/web/release.txt
git -C "$WORK_REPO" commit --quiet -m 'activation lock owner mismatch fault'
LOCK_OWNER_MISMATCH_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK lock-owner-mismatch-after-current\n' >>"$CALL_LOG"
if FAKE_LOCK_OWNER_MISMATCH_AFTER_CURRENT_FSYNC=true \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$LOCK_OWNER_MISMATCH_SHA"; then
  fail 'activation reported success after deployment lock ownership changed'
fi
assert_current_sha "$LOCK_OWNER_MISMATCH_SHA"
assert_runtime_marker "$LOCK_OWNER_MISMATCH_SHA" verified
lock_owner_mismatch_record="$(deployment_record_for_sha "$LOCK_OWNER_MISMATCH_SHA")"
grep -Fxq 'status=activated_recording_failed' "$lock_owner_mismatch_record" \
  || fail 'lock owner mismatch did not write activated-recording-failed evidence'
grep -Fxq 'current_advanced=true' "$lock_owner_mismatch_record" \
  || fail 'lock owner mismatch record lost the already-durable activation'
grep -Fxq 'deploy_lock_preserved=true' "$lock_owner_mismatch_record" \
  || fail 'lock owner mismatch record falsely claimed lock release'
lock_owner_mismatch_log="$(awk '/^MARK lock-owner-mismatch-after-current$/ {capture=1; next} capture' "$CALL_LOG")"
grep -Fxq 'fault:lock-owner-mismatch-after-current-fsync' <<<"$lock_owner_mismatch_log" \
  || fail 'lock owner mismatch fault was not injected'
[[ -f "${AKL_RELEASE_ROOT}/.immutable-deploy.lock/owner" ]] \
  || fail 'lock owner mismatch did not retain owner evidence'
rm -f "${AKL_RELEASE_ROOT}/.immutable-deploy.lock/owner"
rmdir "${AKL_RELEASE_ROOT}/.immutable-deploy.lock"
POWER_LOSS_SHA="$LOCK_OWNER_MISMATCH_SHA"

printf 'web-lock-owner-unlink-failure\n' >"$WORK_REPO/apps/web/release.txt"
git -C "$WORK_REPO" add apps/web/release.txt
git -C "$WORK_REPO" commit --quiet -m 'activation lock owner unlink fault'
LOCK_OWNER_RM_FAIL_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK lock-owner-rm-failure-after-current\n' >>"$CALL_LOG"
if FAKE_LOCK_OWNER_RM_FAIL_AFTER_CURRENT_FSYNC=true \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$LOCK_OWNER_RM_FAIL_SHA"; then
  fail 'activation reported success after deployment lock owner unlink failed'
fi
assert_current_sha "$LOCK_OWNER_RM_FAIL_SHA"
assert_runtime_marker "$LOCK_OWNER_RM_FAIL_SHA" verified
lock_owner_rm_record="$(deployment_record_for_sha "$LOCK_OWNER_RM_FAIL_SHA")"
grep -Fxq 'status=activated_recording_failed' "$lock_owner_rm_record" \
  || fail 'lock owner unlink failure did not write activated-recording-failed evidence'
grep -Fxq 'deploy_lock_preserved=true' "$lock_owner_rm_record" \
  || fail 'lock owner unlink failure record falsely claimed lock release'
lock_owner_rm_log="$(awk '/^MARK lock-owner-rm-failure-after-current$/ {capture=1; next} capture' "$CALL_LOG")"
grep -Fxq 'fault:lock-owner-rm-fail-after-current-fsync' <<<"$lock_owner_rm_log" \
  || fail 'lock owner unlink fault was not injected'
[[ -f "${AKL_RELEASE_ROOT}/.immutable-deploy.lock/owner" ]] \
  || fail 'failed owner unlink did not retain owner evidence'
chmod 0700 "${AKL_RELEASE_ROOT}/.immutable-deploy.lock"
rm -f "${AKL_RELEASE_ROOT}/.immutable-deploy.lock/owner"
rmdir "${AKL_RELEASE_ROOT}/.immutable-deploy.lock"
POWER_LOSS_SHA="$LOCK_OWNER_RM_FAIL_SHA"

printf 'web-lock-rmdir-failure\n' >"$WORK_REPO/apps/web/release.txt"
git -C "$WORK_REPO" add apps/web/release.txt
git -C "$WORK_REPO" commit --quiet -m 'activation lock directory removal fault'
LOCK_RMDIR_FAIL_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK lock-rmdir-failure-after-current\n' >>"$CALL_LOG"
if FAKE_LOCK_RMDIR_FAIL_AFTER_CURRENT_FSYNC=true \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$LOCK_RMDIR_FAIL_SHA"; then
  fail 'activation reported success after deployment lock directory removal failed'
fi
assert_current_sha "$LOCK_RMDIR_FAIL_SHA"
assert_runtime_marker "$LOCK_RMDIR_FAIL_SHA" verified
lock_rmdir_record="$(deployment_record_for_sha "$LOCK_RMDIR_FAIL_SHA")"
grep -Fxq 'status=activated_recording_failed' "$lock_rmdir_record" \
  || fail 'lock rmdir failure did not write activated-recording-failed evidence'
grep -Fxq 'deploy_lock_preserved=true' "$lock_rmdir_record" \
  || fail 'lock rmdir failure record falsely claimed lock release'
lock_rmdir_log="$(awk '/^MARK lock-rmdir-failure-after-current$/ {capture=1; next} capture' "$CALL_LOG")"
grep -Fxq 'fault:lock-rmdir-fail-after-current-fsync' <<<"$lock_rmdir_log" \
  || fail 'lock rmdir fault was not injected'
[[ ! -e "${AKL_RELEASE_ROOT}/.immutable-deploy.lock/owner" \
  && -f "${AKL_RELEASE_ROOT}/.immutable-deploy.lock/fault-blocker" ]] \
  || fail 'lock rmdir failure did not preserve truthful remaining lock state'
rm -f "${AKL_RELEASE_ROOT}/.immutable-deploy.lock/fault-blocker"
rmdir "${AKL_RELEASE_ROOT}/.immutable-deploy.lock"
  POWER_LOSS_SHA="$LOCK_RMDIR_FAIL_SHA"

printf 'web-secret-preflight\n' >"$WORK_REPO/apps/web/release.txt"
git -C "$WORK_REPO" add apps/web/release.txt
git -C "$WORK_REPO" commit --quiet -m 'web secret preflight fixture'
WEB_SECRET_PREFLIGHT_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
chmod 0640 "$WEB_INGESTION_CLIENT_SECRET_FILE"
printf 'MARK web-secret-preflight\n' >>"$CALL_LOG"
if "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$WEB_SECRET_PREFLIGHT_SHA"; then
  fail 'web release accepted a non-private web-to-ingestion client secret'
fi
chmod 0600 "$WEB_INGESTION_CLIENT_SECRET_FILE"
assert_current_sha "$POWER_LOSS_SHA"
assert_runtime_marker "$POWER_LOSS_SHA" verified
web_secret_preflight_log="$(awk '/^MARK web-secret-preflight$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^build:\|^registry_stop$\|^alembic_upgrade$' <<<"$web_secret_preflight_log"; then
  fail 'web secret preflight failure crossed the build or migration boundary'
fi
[[ ! -e "${AKL_RELEASE_ROOT}/state/burned-shas/${WEB_SECRET_PREFLIGHT_SHA}" ]] \
  || fail 'web secret preflight failure burned the target SHA'

printf 'ingestion-secret-preflight\n' >"$WORK_REPO/services/ingestion-service/release.txt"
git -C "$WORK_REPO" add services/ingestion-service/release.txt
git -C "$WORK_REPO" commit --quiet -m 'ingestion secret preflight fixture'
INGESTION_SECRET_PREFLIGHT_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
chmod 0640 "$INGESTION_REGISTRY_CLIENT_SECRET_FILE"
printf 'MARK ingestion-secret-preflight\n' >>"$CALL_LOG"
if "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$INGESTION_SECRET_PREFLIGHT_SHA"; then
  fail 'ingestion release accepted a non-private Registry client secret'
fi
chmod 0600 "$INGESTION_REGISTRY_CLIENT_SECRET_FILE"
assert_current_sha "$POWER_LOSS_SHA"
assert_runtime_marker "$POWER_LOSS_SHA" verified
ingestion_secret_preflight_log="$(awk '/^MARK ingestion-secret-preflight$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^build:\|^registry_stop$\|^alembic_upgrade$' <<<"$ingestion_secret_preflight_log"; then
  fail 'ingestion secret preflight failure crossed the build or migration boundary'
fi
[[ ! -e "${AKL_RELEASE_ROOT}/state/burned-shas/${INGESTION_SECRET_PREFLIGHT_SHA}" ]] \
  || fail 'ingestion secret preflight failure burned the target SHA'

printf 'rag-secret-preflight\n' >"$WORK_REPO/services/rag-retrieval-service/release.txt"
git -C "$WORK_REPO" add services/rag-retrieval-service/release.txt
git -C "$WORK_REPO" commit --quiet -m 'RAG secret preflight fixture'
RAG_SECRET_PREFLIGHT_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
chmod 0640 "$RAG_REGISTRY_CLIENT_SECRET_FILE"
printf 'MARK rag-secret-preflight\n' >>"$CALL_LOG"
if "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$RAG_SECRET_PREFLIGHT_SHA"; then
  fail 'RAG release accepted a non-private Registry client secret'
fi
chmod 0600 "$RAG_REGISTRY_CLIENT_SECRET_FILE"
assert_current_sha "$POWER_LOSS_SHA"
assert_runtime_marker "$POWER_LOSS_SHA" verified
rag_secret_preflight_log="$(awk '/^MARK rag-secret-preflight$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^build:\|^registry_stop$\|^alembic_upgrade$' <<<"$rag_secret_preflight_log"; then
  fail 'RAG secret preflight failure crossed the build or migration boundary'
fi
[[ ! -e "${AKL_RELEASE_ROOT}/state/burned-shas/${RAG_SECRET_PREFLIGHT_SHA}" ]] \
  || fail 'RAG secret preflight failure burned the target SHA'

printf 'registry-secret-preflight\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'Registry secret preflight fixture'
REGISTRY_SECRET_PREFLIGHT_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
chmod 0640 "$INGESTION_AUTHORIZATION_SECRET_FILE"
printf 'MARK registry-secret-preflight\n' >>"$CALL_LOG"
if "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$REGISTRY_SECRET_PREFLIGHT_SHA"; then
  fail 'Registry release accepted a non-private ingestion authorization secret'
fi
chmod 0600 "$INGESTION_AUTHORIZATION_SECRET_FILE"
assert_current_sha "$POWER_LOSS_SHA"
assert_runtime_marker "$POWER_LOSS_SHA" verified
registry_secret_preflight_log="$(awk '/^MARK registry-secret-preflight$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^build:\|^registry_stop$\|^alembic_upgrade$' <<<"$registry_secret_preflight_log"; then
  fail 'Registry secret preflight failure crossed the build or migration boundary'
fi
[[ ! -e "${AKL_RELEASE_ROOT}/state/burned-shas/${REGISTRY_SECRET_PREFLIGHT_SHA}" ]] \
  || fail 'Registry secret preflight failure burned the target SHA'

git -C "$WORK_REPO" show "${POWER_LOSS_SHA}:apps/web/release.txt" \
  >"$WORK_REPO/apps/web/release.txt"
git -C "$WORK_REPO" show "${POWER_LOSS_SHA}:services/ingestion-service/release.txt" \
  >"$WORK_REPO/services/ingestion-service/release.txt"
git -C "$WORK_REPO" show "${POWER_LOSS_SHA}:services/rag-retrieval-service/release.txt" \
  >"$WORK_REPO/services/rag-retrieval-service/release.txt"
git -C "$WORK_REPO" show "${POWER_LOSS_SHA}:services/registry-api/release.txt" \
  >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add \
  apps/web/release.txt \
  services/ingestion-service/release.txt \
  services/rag-retrieval-service/release.txt \
  services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'restore release fixture after secret preflights'

"$REAL_PYTHON3" - "$WORK_REPO/infra/docker-compose/docker-compose.docker-home.yml" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
content = path.read_text(encoding="utf-8")
needle = "  web:\n    image: ${WEB_IMAGE}\n"
replacement = (
    "  web:\n"
    "    image: ${WEB_IMAGE}\n"
    "    labels:\n"
    "      akl.test.coordinated-compose: managed-web\n"
)
if content.count(needle) != 1:
    raise SystemExit("coordinated Compose fixture could not select the web service")
path.write_text(content.replace(needle, replacement), encoding="utf-8")
PY
git -C "$WORK_REPO" add infra/docker-compose/docker-compose.docker-home.yml
git -C "$WORK_REPO" commit --quiet -m 'coordinated managed web Compose change'
MANAGED_COMPOSE_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK managed-shared-compose\n' >>"$CALL_LOG"
"$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$MANAGED_COMPOSE_SHA"
assert_current_sha "$MANAGED_COMPOSE_SHA"
assert_runtime_marker "$MANAGED_COMPOSE_SHA" verified
managed_compose_log="$(awk '/^MARK managed-shared-compose$/ {capture=1; next} capture' "$CALL_LOG")"
grep -Fxq 'build:web' <<<"$managed_compose_log" \
  || fail 'managed web Compose change did not rebuild web'
if grep -q '^build:registry-api\|^build:ingestion-service\|^build:rag-retrieval-service' <<<"$managed_compose_log"; then
  fail 'managed web Compose change rebuilt an unaffected service'
fi
POWER_LOSS_SHA="$MANAGED_COMPOSE_SHA"

  printf 'web-v6-existing-tag\n' >"$WORK_REPO/apps/web/release.txt"
git -C "$WORK_REPO" add apps/web/release.txt
git -C "$WORK_REPO" commit --quiet -m 'web release with pre-existing image tag'
SHA_ELEVEN="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK existing-image\n' >>"$CALL_LOG"
if FAKE_EXISTING_IMAGE="akl/web:${SHA_ELEVEN}" \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SHA_ELEVEN"; then
  fail 'release overwrote a pre-existing immutable image tag'
fi
assert_current_sha "$POWER_LOSS_SHA"
assert_runtime_marker "$POWER_LOSS_SHA" verified
existing_image_log="$(awk '/^MARK existing-image$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^build:' <<<"$existing_image_log"; then
  fail 'release with a pre-existing image tag reached the build phase'
fi
existing_image_record="$(find "${AKL_RELEASE_ROOT}/deployments" -type f -name '*.txt' -print | sort | tail -n 1)"
grep -q '^target_build_may_have_started=true$' "$existing_image_record" \
  || fail 'pre-existing immutable tag was not recorded as a possible build side effect'
grep -q '^retry_requires_descendant_sha=true$' "$existing_image_record" \
  || fail 'pre-existing immutable tag did not require a reviewed descendant SHA'
assert_burned_sha "$SHA_ELEVEN" immutable_target_tag_exists

printf '\n# unsupported shared production change\n' \
  >>"$WORK_REPO/infra/docker-compose/docker-compose.docker-home.yml"
git -C "$WORK_REPO" add infra/docker-compose/docker-compose.docker-home.yml
git -C "$WORK_REPO" commit --quiet -m 'unsupported shared production Compose change'
SHARED_COMPOSE_SHA="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
  printf 'MARK unsupported-shared-compose\n' >>"$CALL_LOG"
  if "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SHARED_COMPOSE_SHA"; then
    fail 'managed-service workflow accepted a production Compose change outside managed service blocks'
  fi
assert_current_sha "$POWER_LOSS_SHA"
assert_runtime_marker "$POWER_LOSS_SHA" verified
unsupported_compose_log="$(awk '/^MARK unsupported-shared-compose$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^build:\|^registry_stop$\|^alembic_upgrade$' <<<"$unsupported_compose_log"; then
  fail 'unsupported shared Compose release reached build, writer stop, or migration'
fi
git -C "$WORK_REPO" revert --quiet --no-edit "$SHARED_COMPOSE_SHA"

git -C "$WORK_REPO" show "${POWER_LOSS_SHA}:apps/web/release.txt" \
  >"$WORK_REPO/apps/web/release.txt"
printf 'ingestion-v2-immutable-release\n' >"$WORK_REPO/services/ingestion-service/release.txt"
git -C "$WORK_REPO" add apps/web/release.txt services/ingestion-service/release.txt
git -C "$WORK_REPO" commit --quiet -m 'ingestion-only immutable release'
SHA_TWELVE="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK ingestion-only-release\n' >>"$CALL_LOG"
"$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SHA_TWELVE"
assert_current_sha "$SHA_TWELVE"
assert_runtime_marker "$SHA_TWELVE" verified
ingestion_only_log="$(awk '/^MARK ingestion-only-release$/ {capture=1; next} capture' "$CALL_LOG")"
grep -Fxq 'build:ingestion-service' <<<"$ingestion_only_log" \
  || fail 'ingestion-only release did not build ingestion-service'
if grep -q '^build:registry-api\|^build:rag-retrieval-service\|^build:web' <<<"$ingestion_only_log"; then
  fail 'ingestion-only release rebuilt an unaffected service'
fi
grep -q '^up:.*ingestion-service$' <<<"$ingestion_only_log" \
  || fail 'ingestion-only release did not restart ingestion-service'
grep -Fq $'curl\thttp://127.0.0.1:18080/ingestion/health' <<<"$ingestion_only_log" \
  || fail 'ingestion-only release did not verify the ingestion health route'
grep -Fxq 'docker_exec_readiness:ingestion-service' <<<"$ingestion_only_log" \
  || fail 'ingestion-only release did not run authenticated in-container readiness'
grep -Fxq 'docker_exec_readiness:web-ingestion-transport:nextjs' <<<"$ingestion_only_log" \
  || fail 'ingestion-only release did not prove the existing web transport against the new ingestion runtime'
if grep -Fq $'curl\thttp://127.0.0.1:18080/ingestion/ready' <<<"$ingestion_only_log"; then
  fail 'ingestion-only release probed protected readiness anonymously'
fi
ingestion_only_record="$(deployment_record_for_sha "$SHA_TWELVE")"
grep -Fxq 'services=ingestion-service' "$ingestion_only_record" \
  || fail 'ingestion-only deployment record selected the wrong service set'
grep -Eq '^target_ingestion_image_id=sha256:[0-9a-f]{64}$' "$ingestion_only_record" \
  || fail 'ingestion-only deployment record lacks the durable ingestion image ID'
grep -Fxq 'target_registry_image_id=not-affected' "$ingestion_only_record" \
  || fail 'ingestion-only deployment record assigned a Registry image ID'
grep -Fxq 'target_rag_image_id=not-affected' "$ingestion_only_record" \
  || fail 'ingestion-only deployment record assigned a RAG image ID'
grep -Fxq 'target_web_image_id=not-affected' "$ingestion_only_record" \
  || fail 'ingestion-only deployment record assigned a web image ID'
grep -Fxq 'target_chat_web_image_id=not-affected' "$ingestion_only_record" \
  || fail 'ingestion-only deployment record assigned a chat web image ID'
akl_assert_no_stale_private_env_snapshots "${AKL_RELEASE_ROOT}/env" \
  || fail 'successful and trapped releases left a private env snapshot behind'

printf 'Immutable docker.home.cz release workflow test passed.\n'
