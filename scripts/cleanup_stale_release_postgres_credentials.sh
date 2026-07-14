#!/usr/bin/env bash
set +x
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/immutable_release_common.sh
source "${SCRIPT_DIR}/lib/immutable_release_common.sh"

usage() {
  printf 'Usage: %s --credential-dir <exact-stale-private-directory>\n' "$0" >&2
  exit 2
}

CREDENTIAL_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --credential-dir)
      [[ $# -ge 2 ]] || usage
      CREDENTIAL_DIR="$2"
      shift 2
      ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done
[[ -n "$CREDENTIAL_DIR" ]] || usage

RELEASE_ROOT="${AKL_RELEASE_ROOT:-/srv/akl}"

akl_require_command python3
akl_assert_no_active_deploy_lock "$RELEASE_ROOT"
akl_cleanup_private_postgres_credentials_dir "$RELEASE_ROOT" "$CREDENTIAL_DIR"
printf 'Removed one strictly validated stale PostgreSQL credential directory: %s\n' \
  "$CREDENTIAL_DIR"
