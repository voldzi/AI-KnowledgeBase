#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/immutable_release_common.sh
source "${SCRIPT_DIR}/lib/immutable_release_common.sh"

usage() {
  printf 'Usage: %s --failed-sha <full-git-sha> --forward-fix-sha <full-git-sha>\n' "$0" >&2
  exit 2
}

FAILED_SHA=""
FORWARD_FIX_SHA=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --failed-sha)
      [[ $# -ge 2 ]] || usage
      FAILED_SHA="$2"
      shift 2
      ;;
    --forward-fix-sha)
      [[ $# -ge 2 ]] || usage
      FORWARD_FIX_SHA="$2"
      shift 2
      ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done

[[ -n "$FAILED_SHA" && -n "$FORWARD_FIX_SHA" ]] || usage
akl_validate_full_sha "$FAILED_SHA"
akl_validate_full_sha "$FORWARD_FIX_SHA"
[[ "$FAILED_SHA" != "$FORWARD_FIX_SHA" ]] || akl_fail "Forward-fix SHA must differ from failed SHA"

printf 'Forward-fix recovery only: no Alembic downgrade, in-place restore, reset, or volume deletion.\n'
AKL_FORWARD_FIX_FROM_SHA="$FAILED_SHA" \
  "${SCRIPT_DIR}/deploy_docker_home_release.sh" --sha "$FORWARD_FIX_SHA"
