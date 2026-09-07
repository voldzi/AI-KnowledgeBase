#!/usr/bin/env bash
set +x
set -Eeuo pipefail
umask 077

RELEASE_ROOT="${AKB_RELEASE_ROOT:-${AKL_RELEASE_ROOT:-/srv/akb}}"
if [[ -n "${AKB_RELEASE_ROOT:-}" && -n "${AKL_RELEASE_ROOT:-}" && "${AKB_RELEASE_ROOT}" != "${AKL_RELEASE_ROOT}" ]]; then
  printf 'AKB deployment gateway rejected the request.\n' >&2
  exit 1
fi
OPERATIONS_ROOT="${AKB_GITEA_DEPLOY_OPERATIONS_ROOT:-${RELEASE_ROOT}/ci-deployments}"
GIT_DIR="${AKB_RELEASE_GIT_DIR:-${RELEASE_ROOT}/git/AI-KnowledgeBase.git}"
CURRENT_LINK="${RELEASE_ROOT}/current"

fail() {
  printf 'AKB deployment gateway rejected the request.\n' >&2
  exit 1
}

parse_command() {
  local command_string="${SSH_ORIGINAL_COMMAND:-}"
  if [[ -n "$command_string" ]]; then
    read -r ACTION ARGUMENT EXTRA <<<"$command_string"
  else
    [[ $# -ge 2 && $# -le 3 ]] || fail
    ACTION="$1"
    ARGUMENT="$2"
    EXTRA="${3:-}"
  fi
  if [[ "$ACTION" == "import" ]]; then
    [[ -n "${EXTRA:-}" ]] || fail
  else
    [[ -z "${EXTRA:-}" ]] || fail
  fi
}

import_images() {
  validate_sha "$ARGUMENT"
  local release_sha="$ARGUMENT" archive_sha="$EXTRA"
  [[ "$archive_sha" =~ ^[0-9a-f]{64}$ ]] || fail
  local prebuilt_root="${RELEASE_ROOT}/prebuilt" archive marker
  install -d -m 0700 "$prebuilt_root"
  archive="$(mktemp "${prebuilt_root}/.${release_sha}.XXXXXX.tgz")"
  marker="${prebuilt_root}/${release_sha}.env"
  [[ ! -e "$marker" ]] || fail
  chmod 0600 "$archive"
  # The immutable archive includes the Docling-enabled ingestion image.  On the
  # production link it can legitimately take longer than the former 15-minute
  # ceiling.  Keep a finite bound so a broken sender cannot retain disk space.
  timeout 3600 dd bs=1M of="$archive" status=none
  [[ "$(sha256sum "$archive" | awk '{print $1}')" == "$archive_sha" ]] || {
    rm -f "$archive"
    fail
  }
  gzip -t "$archive" || { rm -f "$archive"; fail; }
  local archive_manifest="${archive}.manifest.json"
  tar -xOzf "$archive" manifest.json >"$archive_manifest" \
    || { rm -f "$archive" "$archive_manifest"; fail; }
  chmod 0600 "$archive_manifest"
  python3 - "$release_sha" "$archive_manifest" <<'PY' \
    || { rm -f "$archive" "$archive_manifest"; fail; }
import json, sys
with open(sys.argv[2], encoding="utf-8") as source:
    value = json.load(source)
expected = {
    f"akb/{service}:{sys.argv[1]}"
    for service in (
        "registry-api", "ingestion-service", "rag-retrieval-service",
        "evaluation-service", "governance-service", "llm-gateway-service",
        "web", "chat-web",
    )
}
if not isinstance(value, list) or not value:
    raise SystemExit("archive manifest invalid")
actual = []
for item in value:
    if not isinstance(item, dict) or not isinstance(item.get("RepoTags"), list):
        raise SystemExit("archive manifest entry invalid")
    actual.extend(item["RepoTags"])
if set(actual) != expected or len(actual) != len(expected):
    raise SystemExit("archive image set invalid")
PY
  rm -f "$archive_manifest"
  local service image revision project owner
  for service in registry-api ingestion-service rag-retrieval-service evaluation-service \
    governance-service llm-gateway-service web chat-web; do
    image="akb/${service}:${release_sha}"
    docker image inspect "$image" >/dev/null 2>&1 && { rm -f "$archive"; fail; }
  done
  gzip -dc "$archive" | docker load >/dev/null || { rm -f "$archive"; fail; }
  rm -f "$archive"

  for service in registry-api ingestion-service rag-retrieval-service evaluation-service \
    governance-service llm-gateway-service web chat-web; do
    image="akb/${service}:${release_sha}"
    docker image inspect "$image" >/dev/null 2>&1 || fail
    revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")"
    project="$(docker image inspect --format '{{index .Config.Labels "cz.zeleznalady.akl.compose-project"}}' "$image")"
    owner="$(docker image inspect --format '{{index .Config.Labels "cz.zeleznalady.akl.service"}}' "$image")"
    [[ "$revision" == "$release_sha" && "$project" == "akb" && "$owner" == "$service" ]] || fail
  done
  local temporary="${marker}.${BASHPID}.tmp"
  printf 'schema=akb-prebuilt-image-import-1\nrelease_sha=%s\narchive_sha256=%s\n' \
    "$release_sha" "$archive_sha" >"$temporary"
  chmod 0600 "$temporary"
  mv "$temporary" "$marker"
  sync -f "$marker"
  sync -f "$prebuilt_root"
  printf 'import=passed\nrelease_sha=%s\n' "$release_sha"
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

bootstrap_target_release() {
  local release_sha="$1" release_dir stage_dir trusted_ref
  release_dir="${RELEASE_ROOT}/releases/${release_sha}"
  [[ -d "$GIT_DIR" && ! -L "$GIT_DIR" ]] || fail
  trusted_ref="refs/remotes/origin/main"
  git --no-replace-objects --git-dir="$GIT_DIR" rev-parse --verify "${release_sha}^{commit}" >/dev/null 2>&1 || fail
  git --no-replace-objects --git-dir="$GIT_DIR" show-ref --verify --quiet "$trusted_ref" || fail
  git --no-replace-objects --git-dir="$GIT_DIR" merge-base --is-ancestor "$release_sha" "$trusted_ref" || fail
  if [[ -e "$release_dir" || -L "$release_dir" ]]; then
    [[ -d "$release_dir" && ! -L "$release_dir" && -x "${release_dir}/scripts/bootstrap_docker_home_target.sh" ]] || fail
    printf '%s\n' "$release_dir"
    return
  fi
  install -d -m 0700 "${RELEASE_ROOT}/releases"
  stage_dir="${RELEASE_ROOT}/releases/.${release_sha}.gateway-${BASHPID}"
  (umask 077; mkdir "$stage_dir") || fail
  if ! git --no-replace-objects --git-dir="$GIT_DIR" archive --format=tar "$release_sha" | tar -xf - -C "$stage_dir"; then
    rm -rf "$stage_dir"; fail
  fi
  [[ -x "${stage_dir}/scripts/bootstrap_docker_home_target.sh" ]] || { rm -rf "$stage_dir"; fail; }
  printf '%s\n' "$release_sha" >"${stage_dir}/.akl-release-sha"
  printf 'git_sha=%s\ntrusted_ref=%s\nprepared_utc=%s\n' "$release_sha" "$trusted_ref" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"${stage_dir}/.akl-release-manifest"
  chmod -R a-w "$stage_dir"
  mv "$stage_dir" "$release_dir" || { chmod -R u+w "$stage_dir"; rm -rf "$stage_dir"; fail; }
  sync -f "$release_dir"; sync -f "${RELEASE_ROOT}/releases"
  printf '%s\n' "$release_dir"
}

deploy_entrypoint() {
  local release_sha="$1" deploy_script
  if [[ -L "$CURRENT_LINK" ]]; then
    deploy_script="${CURRENT_LINK}/scripts/deploy_docker_home_release.sh"
  else
    local bootstrap_release
    bootstrap_release="$(bootstrap_target_release "$release_sha")"
    deploy_script="${bootstrap_release}/scripts/bootstrap_docker_home_target.sh"
  fi
  [[ -x "$deploy_script" ]] || fail
  printf '%s\n' "$deploy_script"
}

start_deploy() {
  validate_sha "$ARGUMENT"
  RELEASE_SHA="$ARGUMENT"
  local deploy_script
  deploy_script="$(deploy_entrypoint "$RELEASE_SHA")"
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
  local deploy_script
  deploy_script="$(deploy_entrypoint "$RELEASE_SHA")"
  local deploy_pid="$BASHPID"
  atomic_status "$operation_dir" running -1 "$deploy_pid"
  set +e
  AKB_RELEASE_ROOT="$RELEASE_ROOT" \
  AKB_RELEASE_GIT_DIR="$GIT_DIR" \
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
  import) import_images ;;
  deploy) start_deploy ;;
  status) show_status ;;
  verify) verify_release ;;
  *) fail ;;
esac
