#!/usr/bin/env bash
set +x
set -Eeuo pipefail
umask 077

RELEASE_ROOT="/srv/akl"
OPERATIONS_ROOT="${RELEASE_ROOT}/ci-deployments"
if [[ "${AKB_GATEWAY_TEST_MODE:-}" == "1" && -z "${SSH_ORIGINAL_COMMAND:-}" ]]; then
  RELEASE_ROOT="${AKL_RELEASE_ROOT:-$RELEASE_ROOT}"
  OPERATIONS_ROOT="${AKB_GITEA_DEPLOY_OPERATIONS_ROOT:-${RELEASE_ROOT}/ci-deployments}"
fi
CURRENT_LINK="${RELEASE_ROOT}/current"

fail() {
  printf 'AKB deployment gateway rejected the request.\n' >&2
  exit 1
}

parse_command() {
  local command_string="${SSH_ORIGINAL_COMMAND:-}"
  if [[ -n "$command_string" ]]; then
    read -r ACTION ARGUMENT EXTRA <<<"$command_string"
    [[ -z "${EXTRA:-}" ]] || fail
  else
    [[ $# -eq 2 ]] || fail
    ACTION="$1"
    ARGUMENT="$2"
  fi
}

validate_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || fail
}

validate_operation_id() {
  [[ "$1" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}-[0-9]+$ ]] || fail
}

atomic_status() {
  local operation_dir="$1"
  local state="$2"
  local exit_code="$3"
  local pid="$4"
  local temporary="${operation_dir}/.status.${BASHPID}.tmp"
  printf 'state=%s\nexit_code=%s\npid=%s\nrelease_sha=%s\noperator_log=%s\n' \
    "$state" "$exit_code" "$pid" "$RELEASE_SHA" "${operation_dir}/operator.log" \
    >"$temporary"
  chmod 0600 "$temporary"
  mv -f "$temporary" "${operation_dir}/status"
  sync -f "${operation_dir}/status"
  sync -f "$operation_dir"
}

start_deploy() {
  validate_sha "$ARGUMENT"
  RELEASE_SHA="$ARGUMENT"
  [[ -L "$CURRENT_LINK" ]] || fail
  local deploy_script="${CURRENT_LINK}/scripts/deploy_docker_home_release.sh"
  [[ -x "$deploy_script" ]] || fail
  install -d -m 0700 "$OPERATIONS_ROOT"
  local operation_id
  operation_id="$(date -u +%Y%m%dT%H%M%SZ)-${RELEASE_SHA:0:12}-$$"
  local operation_dir="${OPERATIONS_ROOT}/${operation_id}"
  mkdir -m 0700 "$operation_dir"
  printf '%s\n' "$RELEASE_SHA" >"${operation_dir}/release-sha"
  chmod 0600 "${operation_dir}/release-sha"

  command -v nohup >/dev/null || fail
  command -v setsid >/dev/null || fail
  nohup env -u SSH_ORIGINAL_COMMAND setsid "$0" --internal-run \
    "$operation_id" "$RELEASE_SHA" \
    </dev/null >/dev/null 2>&1 &

  local status_file="${operation_dir}/status"
  for _ in $(seq 1 50); do
    [[ -f "$status_file" ]] && break
    sleep 0.1
  done
  [[ -f "$status_file" ]] || fail

  printf 'operation_id=%s\n' "$operation_id"
}

run_deploy() {
  local operation_id="$1"
  RELEASE_SHA="$2"
  validate_operation_id "$operation_id"
  validate_sha "$RELEASE_SHA"
  local operation_dir="${OPERATIONS_ROOT}/${operation_id}"
  local release_sha_file="${operation_dir}/release-sha"
  [[ -d "$operation_dir" && ! -L "$operation_dir" ]] || fail
  [[ -f "$release_sha_file" && ! -L "$release_sha_file" ]] || fail
  [[ "$(cat "$release_sha_file")" == "$RELEASE_SHA" ]] || fail
  local deploy_script="${CURRENT_LINK}/scripts/deploy_docker_home_release.sh"
  [[ -x "$deploy_script" ]] || fail
  local deploy_pid="$BASHPID"
  atomic_status "$operation_dir" running -1 "$deploy_pid"
  set +e
  "$deploy_script" --sha "$RELEASE_SHA" >>"${operation_dir}/operator.log" 2>&1
  local deploy_status=$?
  set -e
  if [[ $deploy_status -eq 0 ]]; then
    atomic_status "$operation_dir" succeeded 0 "$deploy_pid"
  else
    atomic_status "$operation_dir" failed "$deploy_status" "$deploy_pid"
  fi
}

show_status() {
  validate_operation_id "$ARGUMENT"
  local operation_dir="${OPERATIONS_ROOT}/${ARGUMENT}"
  local status_file="${operation_dir}/status"
  [[ -d "$operation_dir" && ! -L "$operation_dir" ]] || fail
  [[ -f "$status_file" && ! -L "$status_file" ]] || fail
  local owner_mode
  owner_mode="$(stat -c '%U:%G:%a' "$status_file")"
  [[ "$owner_mode" == "$(id -un):$(id -gn):600" ]] || fail
  cat "$status_file"
}

verify_release() {
  validate_sha "$ARGUMENT"
  local expected_sha="$ARGUMENT"
  [[ -L "$CURRENT_LINK" ]] || fail
  local current_release
  current_release="$(readlink -f "$CURRENT_LINK")"
  [[ "$current_release" == "${RELEASE_ROOT}/releases/${expected_sha}" ]] || fail
  [[ "$(cat "${current_release}/.akl-release-sha")" == "$expected_sha" ]] || fail
  curl --disable --fail --silent --show-error --max-time 15 \
    https://stratos.zeleznalady.cz/akb/api/health >/dev/null
  curl --disable --fail --silent --show-error --max-time 30 \
    https://stratos.zeleznalady.cz/akb/api/ready >/dev/null
  printf 'verification=passed\nrelease_sha=%s\n' "$expected_sha"
}

if [[ -z "${SSH_ORIGINAL_COMMAND:-}" && "${1:-}" == "--internal-run" ]]; then
  [[ $# -eq 3 ]] || fail
  run_deploy "$2" "$3"
  exit 0
fi

parse_command "$@"
case "$ACTION" in
  deploy) start_deploy ;;
  status) show_status ;;
  verify) verify_release ;;
  *) fail ;;
esac
