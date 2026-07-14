#!/usr/bin/env bash
set +x
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/immutable_release_common.sh
source "${SCRIPT_DIR}/lib/immutable_release_common.sh"

usage() {
  printf 'Usage: %s --snapshot-dir <exact-stale-snapshot-directory>\n' "$0" >&2
  exit 2
}

SNAPSHOT_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --snapshot-dir)
      [[ $# -ge 2 ]] || usage
      SNAPSHOT_DIR="$2"
      shift 2
      ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done
[[ -n "$SNAPSHOT_DIR" ]] || usage

RELEASE_ROOT="${AKL_RELEASE_ROOT:-/srv/akl}"
SNAPSHOT_ROOT="${RELEASE_ROOT}/env"

akl_require_command python3
akl_assert_no_active_deploy_lock "$RELEASE_ROOT"
akl_assert_private_env_snapshot_root "$SNAPSHOT_ROOT"
akl_cleanup_stale_private_env_snapshot "$SNAPSHOT_ROOT" "$SNAPSHOT_DIR"
printf 'Removed one strictly validated stale release env snapshot: %s\n' "$SNAPSHOT_DIR"
