#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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

WORK_REPO="${TMP_ROOT}/work"
REMOTE_REPO="${TMP_ROOT}/remote.git"
FAKE_BIN="${TMP_ROOT}/fake-bin"
CALL_LOG="${TMP_ROOT}/calls.log"
FAKE_ALEMBIC_STATE="${TMP_ROOT}/alembic-head"
FAKE_WEB_STATE="${TMP_ROOT}/web-release"
FAKE_RUNTIME_DIR="${TMP_ROOT}/fake-runtime"
AKL_RELEASE_ROOT="${TMP_ROOT}/srv/akl"
AKL_PROD_ENV_FILE="${AKL_RELEASE_ROOT}/env/akl.prod.env"
export CALL_LOG FAKE_ALEMBIC_STATE FAKE_WEB_STATE FAKE_RUNTIME_DIR AKL_RELEASE_ROOT AKL_PROD_ENV_FILE
export AKL_RELEASE_VERIFY_ATTEMPTS=1
export AKL_RELEASE_VERIFY_DELAY_SECONDS=0

mkdir -p \
  "$WORK_REPO/scripts/lib" \
  "$WORK_REPO/infra/docker-compose" \
  "$WORK_REPO/services/registry-api" \
  "$WORK_REPO/services/rag-retrieval-service" \
  "$WORK_REPO/apps/web" \
  "$FAKE_BIN" \
  "${FAKE_RUNTIME_DIR}/images" \
  "${FAKE_RUNTIME_DIR}/containers" \
  "${AKL_RELEASE_ROOT}/env" \
  "${AKL_RELEASE_ROOT}/repo"

cp \
  "$SOURCE_ROOT/scripts/backup_registry_release.sh" \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" \
  "$SOURCE_ROOT/scripts/prepare_docker_home_release.sh" \
  "$SOURCE_ROOT/scripts/rollback_docker_home_release.sh" \
  "$SOURCE_ROOT/scripts/verify_docker_home_release.sh" \
  "$WORK_REPO/scripts/"
cp "$SOURCE_ROOT/scripts/lib/immutable_release_common.sh" "$WORK_REPO/scripts/lib/"
chmod +x "$WORK_REPO/scripts/"*.sh

cat >"$WORK_REPO/infra/docker-compose/docker-compose.docker-home.yml" <<'YAML'
name: akl-test
services: {}
YAML
printf 'registry-v1\n' >"$WORK_REPO/services/registry-api/release.txt"
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
AKL_REGISTRY_DATABASE_URL=postgresql+psycopg://release_user:test_secret@db.internal:5432/registry
AKL_WEB_PUBLIC_BASE_URL=https://stratos.example.invalid/akb
AKL_PROXY_HTTP_PORT=18080
ENV
chmod 0600 "$AKL_PROD_ENV_FILE"
printf 'must remain untouched\n' >"${AKL_RELEASE_ROOT}/repo/sentinel"

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
    rag-retrieval-service) printf '%s\n' "$RAG_RETRIEVAL_SERVICE_IMAGE" ;;
    web) printf '%s\n' "$WEB_IMAGE" ;;
    *) return 1 ;;
  esac
}

service_for_image_ref() {
  local ref="$1"
  local service
  for service in registry-api rag-retrieval-service web; do
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
  project="$AKL_RELEASE_COMPOSE_PROJECT"
  if [[ "${FAKE_IMAGE_LABEL_MISMATCH_SERVICE:-}" == "$service" ]]; then
    revision="mismatched-revision"
  fi
  mkdir -p "$state_dir"
  printf '%s\n' "$ref" >"${state_dir}/ref"
  printf 'sha256:%s\n' "$digest" >"${state_dir}/id"
  printf '%s\n' "$revision" >"${state_dir}/revision"
  printf '%s\n' "$project" >"${state_dir}/project"
}

container_service_for_id() {
  local requested_id="$1"
  local service state_dir
  for service in registry-api rag-retrieval-service web; do
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
  local image_id revision project
  [[ -d "$image_dir" ]]
  image_id="$(<"${image_dir}/id")"
  revision="$AKL_SERVICE_VERSION"
  project="$AKL_RELEASE_COMPOSE_PROJECT"
  if [[ "${FAKE_CONTAINER_IMAGE_MISMATCH_SERVICE:-}" == "$service" ]]; then
    image_id="sha256:$(printf '0%.0s' {1..64})"
  fi
  if [[ "${FAKE_CONTAINER_LABEL_MISMATCH_SERVICE:-}" == "$service" ]]; then
    revision="mismatched-revision"
  fi
  mkdir -p "$state_dir"
  printf 'akl-test-%s-1\n' "$service" >"${state_dir}/id"
  printf 'true\n' >"${state_dir}/running"
  cp "${image_dir}/ref" "${state_dir}/image_ref"
  printf '%s\n' "$image_id" >"${state_dir}/image_id"
  printf 'akl-test\n' >"${state_dir}/compose_project"
  printf '%s\n' "$service" >"${state_dir}/compose_service"
  printf 'False\n' >"${state_dir}/compose_oneoff"
  printf '%s\n' "$compose_file" >"${state_dir}/compose_config_files"
  printf '%s' "$service" | sha256sum | awk '{print $1}' >"${state_dir}/compose_config_hash"
  printf '%s\n' "$revision" >"${state_dir}/revision"
  printf '%s\n' "$project" >"${state_dir}/project"
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
  if [[ -z "$format" && "${FAKE_EXISTING_IMAGE:-}" == "$ref" ]]; then
    exit 0
  fi
  service="$(service_for_image_ref "$ref")" || exit 1
  state_dir="${FAKE_RUNTIME_DIR}/images/${service}"
  [[ -d "$state_dir" && "$(<"${state_dir}/ref")" == "$ref" ]] || exit 1
  case "$format" in
    '') printf '{}\n' ;;
    '{{.Id}}') cat "${state_dir}/id" ;;
    '{{json .RepoTags}}') printf '["%s"]\n' "$ref" ;;
    '{{index .Config.Labels "org.opencontainers.image.revision"}}') cat "${state_dir}/revision" ;;
    '{{index .Config.Labels "cz.zeleznalady.akl.compose-project"}}') cat "${state_dir}/project" ;;
    *) exit 90 ;;
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
    '{{.Config.Image}}') cat "${state_dir}/image_ref" ;;
    '{{.Image}}') cat "${state_dir}/image_id" ;;
    '{{index .Config.Labels "com.docker.compose.project"}}') cat "${state_dir}/compose_project" ;;
    '{{index .Config.Labels "com.docker.compose.service"}}') cat "${state_dir}/compose_service" ;;
    '{{index .Config.Labels "com.docker.compose.oneoff"}}') cat "${state_dir}/compose_oneoff" ;;
    '{{index .Config.Labels "com.docker.compose.project.config_files"}}') cat "${state_dir}/compose_config_files" ;;
    '{{index .Config.Labels "com.docker.compose.config-hash"}}') cat "${state_dir}/compose_config_hash" ;;
    '{{index .Config.Labels "org.opencontainers.image.revision"}}') cat "${state_dir}/revision" ;;
    '{{index .Config.Labels "cz.zeleznalady.akl.compose-project"}}') cat "${state_dir}/project" ;;
    *) exit 90 ;;
  esac
  exit 0
fi

if [[ "${1-}" == "start" ]]; then
  service="$(container_service_for_id "${2-}")" || exit 1
  printf 'true\n' >"${FAKE_RUNTIME_DIR}/containers/${service}/running"
  printf 'docker_start:%s\n' "${2-}" >>"$CALL_LOG"
  printf '%s\n' "${2-}"
  exit 0
fi

if [[ "${1-}" == "ps" ]]; then
  [[ "$*" == "ps --no-trunc --filter label=com.docker.compose.project=akl-test --filter label=com.docker.compose.service=registry-api --format {{.ID}}" ]]
  state_dir="${FAKE_RUNTIME_DIR}/containers/registry-api"
  if [[ -f "${state_dir}/running" && "$(<"${state_dir}/running")" == "true" ]]; then
    cat "${state_dir}/id"
  fi
  exit 0
fi

[[ "${1-}" == "compose" ]] || exit 91
shift
[[ "${1-}" == "--project-name" && "${2-}" == "akl-test" ]] || exit 92
shift 2
[[ "${1-}" == "--env-file" && "${2-}" == "$AKL_PROD_ENV_FILE" ]] || exit 93
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
    for service in "$@"; do
      write_image_state "$service"
    done
    ;;
  up)
    printf 'up:%s\n' "$*" >>"$CALL_LOG"
    for argument in "$@"; do
      case "$argument" in
        registry-api|rag-retrieval-service|web)
          write_container_state "$argument" "$compose_file"
          ;;
      esac
    done
    ;;
  stop)
    [[ "${1-}" == "--timeout" && "${2-}" == "30" && "${3-}" == "registry-api" ]]
    printf 'false\n' >"${FAKE_RUNTIME_DIR}/containers/registry-api/running"
    printf 'registry_stop\n' >>"$CALL_LOG"
    ;;
  ps)
    case "$*" in
      '--status running --services')
        for service in registry-api rag-retrieval-service web; do
          state_dir="${FAKE_RUNTIME_DIR}/containers/${service}"
          if [[ -f "${state_dir}/running" && "$(<"${state_dir}/running")" == "true" ]]; then
            printf '%s\n' "$service"
          fi
        done
        ;;
      '-q registry-api'|'-q rag-retrieval-service'|'-q web')
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
    [[ "${1-}" == "--rm" && "${2-}" == "--no-deps" ]]
    shift 2
    [[ "${1-}" == "registry-api" && "${2-}" == "alembic" ]]
    shift 2
    case "${1-}" in
      heads)
        printf '0016_public_audit_aggregation (head)\n'
        ;;
      upgrade)
        [[ "${2-}" == "head" ]]
        printf '0016_public_audit_aggregation\n' >"$FAKE_ALEMBIC_STATE"
        printf 'alembic_upgrade\n' >>"$CALL_LOG"
        ;;
      current)
        if [[ -f "$FAKE_ALEMBIC_STATE" ]]; then
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
printf 'psql' >>"$CALL_LOG"
printf '\t%s' "$@" >>"$CALL_LOG"
printf '\n' >>"$CALL_LOG"
if [[ -f "$FAKE_ALEMBIC_STATE" ]]; then
  cat "$FAKE_ALEMBIC_STATE"
else
  printf '0013_information_policy_v2\n'
fi
SH

cat >"$FAKE_BIN/pg_dump" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1-}" == "--version" ]]; then
  printf 'pg_dump (PostgreSQL) 17.5\n'
  exit 0
fi
printf 'pg_dump' >>"$CALL_LOG"
printf '\t%s' "$@" >>"$CALL_LOG"
printf '\n' >>"$CALL_LOG"
registry_running="${FAKE_RUNTIME_DIR}/containers/registry-api/running"
if [[ -f "$registry_running" && "$(<"$registry_running")" == "true" ]]; then
  printf 'Registry writer was not quiesced before pg_dump.\n' >&2
  exit 98
fi
if [[ "${FAKE_PG_DUMP_FAIL:-false}" == "true" ]]; then
  exit 99
fi
dump_file=""
for argument in "$@"; do
  case "$argument" in
    --file=*) dump_file="${argument#--file=}" ;;
  esac
done
[[ -n "$dump_file" ]]
printf 'PGDMPmock-registry-backup\n' >"$dump_file"
SH

cat >"$FAKE_BIN/pg_restore" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1-}" == "--version" ]]; then
  printf 'pg_restore (PostgreSQL) 17.5\n'
  exit 0
fi
[[ "${1-}" == "--list" && -s "${2-}" ]]
printf '; mock custom archive\n1; 0 0 TABLE public documents release_user\n'
SH

cat >"$FAKE_BIN/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
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
    --retry|--retry-delay)
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
if [[ "$url" == */api/public/documents/* ]]; then
  [[ -n "$output_file" && -n "$header_file" && "$write_out" == '%{http_code}' ]]
  printf 'HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n' >"$header_file"
  printf '{"error":{"code":"PUBLIC_DOCUMENT_UNAVAILABLE","message":"The public document is unavailable."}}\n' >"$output_file"
  printf '404'
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
chmod +x "$FAKE_BIN/"*
export PATH="${FAKE_BIN}:$PATH"

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

if "$SOURCE_ROOT/scripts/backup_registry_release.sh" "$SHA_ONE" >/dev/null 2>&1; then
  fail 'standalone Registry backup accepted an unverified writer state'
fi

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

printf 'first immutable retry\n' >"$WORK_REPO/apps/web/first-immutable.txt"
git -C "$WORK_REPO" add apps/web/first-immutable.txt
git -C "$WORK_REPO" commit --quiet -m 'first immutable retry after pre-apply failure'
SHA_ONE="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
"$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SHA_ONE"
assert_current_sha "$SHA_ONE"
assert_runtime_marker "$SHA_ONE" verified
[[ "$(cat "${AKL_RELEASE_ROOT}/repo/sentinel")" == "must remain untouched" ]] \
  || fail 'legacy dirty checkout was modified'
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
grep -q '^alembic_before=0013_information_policy_v2$' "$backup_dir/inventory.txt" \
  || fail 'pre-migration revision was not captured'
grep -q '^registry_writers_quiesced=true$' "$backup_dir/inventory.txt" \
  || fail 'backup inventory did not record the writer quiesce'
if grep -R -F 'test_secret' "$backup_dir" "$CALL_LOG" >/dev/null; then
  fail 'database password leaked to backup metadata or process arguments'
fi
pg_dump_line="$(grep -n '^pg_dump' "$CALL_LOG" | head -n 1 | cut -d: -f1)"
migration_line="$(grep -n '^alembic_upgrade$' "$CALL_LOG" | head -n 1 | cut -d: -f1)"
[[ "$pg_dump_line" -lt "$migration_line" ]] \
  || fail 'Registry migration ran before the verified backup'

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
grep -q '^build:web$' <<<"$second_log" || fail 'web-only release did not build web'
if grep -q '^build:.*registry-api\|^build:.*rag-retrieval-service' <<<"$second_log"; then
  fail 'web-only release built an unaffected service'
fi

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
grep -q '^build:web$' <<<"$forward_log" || fail 'forward fix did not build web'
if grep -q '^build:.*registry-api\|^build:.*rag-retrieval-service' <<<"$forward_log"; then
  fail 'forward fix built an unaffected service'
fi
[[ "$(cat "${AKL_RELEASE_ROOT}/repo/sentinel")" == "must remain untouched" ]] \
  || fail 'legacy dirty checkout was modified during recovery'

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
[[ "$(<"${FAKE_RUNTIME_DIR}/containers/registry-api/image_ref")" == "akl/registry-api:${SHA_ONE}" ]] \
  || fail 'pre-apply failure restored a different Registry image'
backup_failure_log="$(awk '/^MARK registry-backup-failure$/ {capture=1; next} capture' "$CALL_LOG")"
grep -q '^registry_stop$' <<<"$backup_failure_log" \
  || fail 'Registry writer was not stopped before the failed backup'
grep -q '^docker_start:akl-test-registry-api-1$' <<<"$backup_failure_log" \
  || fail 'the exact old Registry container was not restarted after a pre-apply failure'
if grep -q '^alembic_upgrade$' <<<"$backup_failure_log"; then
  fail 'migration started after the Registry backup failed'
fi

printf 'registry-v3-ambiguous\n' >"$WORK_REPO/services/registry-api/release.txt"
git -C "$WORK_REPO" add services/registry-api/release.txt
git -C "$WORK_REPO" commit --quiet -m 'registry release that fails readiness'
SHA_FIVE="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK registry-ambiguous\n' >>"$CALL_LOG"
if FAKE_CURL_FAIL_READY=true \
  "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SHA_FIVE"; then
  fail 'Registry release with failed readiness was activated'
fi
assert_current_sha "$SHA_THREE"
assert_runtime_marker "$SHA_FIVE" failed
registry_ambiguous_log="$(awk '/^MARK registry-ambiguous$/ {capture=1; next} capture' "$CALL_LOG")"
registry_stop_line="$(grep -n '^registry_stop$' <<<"$registry_ambiguous_log" | head -n 1 | cut -d: -f1)"
registry_dump_line="$(grep -n '^pg_dump' <<<"$registry_ambiguous_log" | head -n 1 | cut -d: -f1)"
registry_migration_line="$(grep -n '^alembic_upgrade$' <<<"$registry_ambiguous_log" | head -n 1 | cut -d: -f1)"
[[ "$registry_stop_line" -lt "$registry_dump_line" && "$registry_dump_line" -lt "$registry_migration_line" ]] \
  || fail 'Registry writer quiesce, backup and migration ordering is unsafe'
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
if grep -q '^build:.*web\|^build:.*rag-retrieval-service' <<<"$registry_log"; then
  fail 'Registry forward-fix built an unaffected service'
fi
[[ "$(tr -d '[:space:]' <"$FAKE_WEB_STATE")" == "$SHA_THREE" ]] \
  || fail 'Registry-only release unexpectedly replaced the web image'

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
assert_runtime_marker "$SHA_NINE" failed

printf 'rag-v3-label-forward-fix\n' >"$WORK_REPO/services/rag-retrieval-service/release.txt"
git -C "$WORK_REPO" add services/rag-retrieval-service/release.txt
git -C "$WORK_REPO" commit --quiet -m 'RAG label forward fix'
SHA_TEN="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
"$SOURCE_ROOT/scripts/rollback_docker_home_release.sh" \
  --failed-sha "$SHA_NINE" \
  --forward-fix-sha "$SHA_TEN"
assert_current_sha "$SHA_TEN"
assert_runtime_marker "$SHA_TEN" verified

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
assert_current_sha "$SHA_TEN"
assert_runtime_marker "$SHA_TEN" verified
existing_image_log="$(awk '/^MARK existing-image$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^build:' <<<"$existing_image_log"; then
  fail 'release with a pre-existing image tag reached the build phase'
fi

mkdir -p "$WORK_REPO/services/ingestion-service"
printf 'unsupported-runtime-change\n' >"$WORK_REPO/services/ingestion-service/release.txt"
git -C "$WORK_REPO" add services/ingestion-service/release.txt
git -C "$WORK_REPO" commit --quiet -m 'unsupported runtime release'
SHA_TWELVE="$(git -C "$WORK_REPO" rev-parse HEAD)"
git -C "$WORK_REPO" push --quiet origin main
printf 'MARK unsupported-runtime\n' >>"$CALL_LOG"
if "$SOURCE_ROOT/scripts/deploy_docker_home_release.sh" --sha "$SHA_TWELVE"; then
  fail 'release touching an unsupported runtime service was accepted'
fi
assert_current_sha "$SHA_TEN"
assert_runtime_marker "$SHA_TEN" verified
unsupported_log="$(awk '/^MARK unsupported-runtime$/ {capture=1; next} capture' "$CALL_LOG")"
if grep -q '^build:' <<<"$unsupported_log"; then
  fail 'unsupported runtime release reached the build phase'
fi

printf 'Immutable docker.home.cz release workflow test passed.\n'
