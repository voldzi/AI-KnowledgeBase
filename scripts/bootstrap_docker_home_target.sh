#!/usr/bin/env bash
set +x
set -Eeuo pipefail

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
ENV_FILE="${AKL_PROD_ENV_FILE:-${RELEASE_ROOT}/env/akl.prod.env}"
GIT_DIR="${AKL_RELEASE_GIT_DIR:-${RELEASE_ROOT}/git/AI-KnowledgeBase.git}"
TARGET_RELEASE="${RELEASE_ROOT}/releases/${TARGET_SHA}"
TARGET_COMPOSE_FILE="${TARGET_RELEASE}/infra/docker-compose/docker-compose.docker-home.yml"
akl_require_command python3
resolved_script_dir="$(python3 - "$SCRIPT_DIR" <<'PY'
import os
import sys
print(os.path.realpath(sys.argv[1]))
PY
)"
[[ "$resolved_script_dir" == "${TARGET_RELEASE}/scripts" ]] \
  || akl_fail "Bootstrap entry point must run from the exact target immutable release"
akl_require_private_env_file "$ENV_FILE"
akl_assert_no_ambient_env_file_overrides "$ENV_FILE"
akl_require_read_only_release_tree "$TARGET_RELEASE"
akl_require_file "$TARGET_COMPOSE_FILE"
akl_assert_no_ambient_compose_overrides "$TARGET_COMPOSE_FILE"

if [[ "$TRANSITION_EXISTING_CURRENT" == "true" ]]; then
  for command_name in docker git python3; do
    akl_require_command "$command_name"
  done
  transition_mode="$(
    akl_assert_existing_current_transition_state \
      "$RELEASE_ROOT" \
      "$ENV_FILE" \
      "$ENV_FILE" \
      "$GIT_DIR" \
      "$TARGET_SHA" \
      preflight
  )"
  printf 'Existing-current transition preflight passed (%s).\n' "$transition_mode" >&2
  printf 'Executing hardened orchestrator from exact target release %s.\n' "$TARGET_SHA" >&2
  exec "${TARGET_RELEASE}/scripts/deploy_docker_home_release.sh" \
    --sha "$TARGET_SHA" \
    --transition-existing-current
fi

[[ ! -e "${RELEASE_ROOT}/current" && ! -L "${RELEASE_ROOT}/current" ]] \
  || akl_fail "Target bootstrap without transition mode is only valid before the first current activation"
prepared_release="$(
  AKL_RELEASE_ROOT="$RELEASE_ROOT" \
  AKL_PROD_ENV_FILE="$ENV_FILE" \
  AKL_RELEASE_GIT_DIR="$GIT_DIR" \
    "${SCRIPT_DIR}/prepare_docker_home_release.sh" "$TARGET_SHA"
)"
[[ "$prepared_release" == "$TARGET_RELEASE" ]] \
  || akl_fail "Target prepare did not return the exact bootstrap release"
akl_require_read_only_release_tree "$prepared_release"

printf 'Executing the deployment orchestrator from exact target release %s.\n' "$TARGET_SHA" >&2
exec "${prepared_release}/scripts/deploy_docker_home_release.sh" --sha "$TARGET_SHA"
