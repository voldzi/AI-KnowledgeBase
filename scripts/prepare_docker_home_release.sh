#!/usr/bin/env bash
set +x
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/immutable_release_common.sh
source "${SCRIPT_DIR}/lib/immutable_release_common.sh"

usage() {
  printf 'Usage: %s <full-git-sha>\n' "$0" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
TARGET_SHA="$1"
akl_validate_full_sha "$TARGET_SHA"

RELEASE_ROOT="${AKL_RELEASE_ROOT:-/srv/akl}"
ENV_FILE="${AKL_PROD_ENV_FILE:-${RELEASE_ROOT}/env/akl.prod.env}"
RELEASES_DIR="${RELEASE_ROOT}/releases"
GIT_DIR="${AKL_RELEASE_GIT_DIR:-${RELEASE_ROOT}/git/AI-KnowledgeBase.git}"
COMPOSE_RELATIVE_PATH="infra/docker-compose/docker-compose.docker-home.yml"

cleanup_prepare() {
  local candidate
  for candidate in "${clone_tmp:-}" "${stage_dir:-}"; do
    [[ -n "$candidate" ]] || continue
    if [[ -e "$candidate" || -L "$candidate" ]]; then
      chmod -R u+w "$candidate" 2>/dev/null || true
      rm -rf "$candidate"
    fi
  done
}

akl_require_command git
akl_require_command python3
akl_require_command tar
akl_require_private_env_file "$ENV_FILE"
akl_assert_expected_env_snapshot "$ENV_FILE"
akl_assert_no_ambient_env_file_overrides "$ENV_FILE"
akl_assert_hermetic_git_environment

GIT_URL="$(akl_env_value "$ENV_FILE" AKL_RELEASE_GIT_URL https://github.com/voldzi/AI-KnowledgeBase.git)"
TRUSTED_REF="$(akl_env_value "$ENV_FILE" AKL_RELEASE_TRUSTED_REF refs/remotes/origin/main)"
[[ -n "$GIT_URL" ]] || akl_fail "AKL_RELEASE_GIT_URL is empty"
[[ ! "$GIT_URL" =~ ^https?://[^/]*@ ]] \
  || akl_fail "AKL_RELEASE_GIT_URL must not contain embedded credentials"
[[ "$TRUSTED_REF" == refs/remotes/origin/* ]] || akl_fail "Trusted release ref must be an origin remote-tracking ref"
git --no-replace-objects check-ref-format "$TRUSTED_REF" >/dev/null 2>&1 \
  || akl_fail "Trusted release ref is not a valid Git ref"

umask 077
mkdir -p "$RELEASES_DIR" "$(dirname "$GIT_DIR")"
akl_fsync_directory "$RELEASE_ROOT"
akl_fsync_directory "$(dirname "$GIT_DIR")"

if [[ ! -d "$GIT_DIR" ]]; then
  clone_tmp="${GIT_DIR}.tmp.$$"
  rm -rf "$clone_tmp"
  trap cleanup_prepare EXIT
  GIT_TERMINAL_PROMPT=0 git --no-replace-objects clone --bare --no-local "$GIT_URL" "$clone_tmp"
  akl_fsync_tree "$clone_tmp"
  akl_fsync_directory "$(dirname "$GIT_DIR")"
  mv "$clone_tmp" "$GIT_DIR"
  akl_fsync_directory "$GIT_DIR"
  akl_fsync_directory "$(dirname "$GIT_DIR")"
fi

[[ "$(git --no-replace-objects --git-dir="$GIT_DIR" rev-parse --is-bare-repository)" == "true" ]] \
  || akl_fail "Release Git directory is not bare: $GIT_DIR"
[[ "$(git --no-replace-objects --git-dir="$GIT_DIR" remote get-url origin)" == "$GIT_URL" ]] \
  || akl_fail "Release Git origin does not match AKL_RELEASE_GIT_URL"

GIT_TERMINAL_PROMPT=0 git --no-replace-objects --git-dir="$GIT_DIR" fetch --prune origin \
  '+refs/heads/*:refs/remotes/origin/*' \
  '+refs/tags/*:refs/tags/*'
akl_assert_git_mirror_has_no_replace_refs "$GIT_DIR"

resolved_sha="$(git --no-replace-objects --git-dir="$GIT_DIR" rev-parse --verify "${TARGET_SHA}^{commit}")"
[[ "$resolved_sha" == "$TARGET_SHA" ]] || akl_fail "Requested SHA did not resolve exactly"
git --no-replace-objects --git-dir="$GIT_DIR" show-ref --verify --quiet "$TRUSTED_REF" \
  || akl_fail "Trusted release ref is missing after fetch: $TRUSTED_REF"
git --no-replace-objects --git-dir="$GIT_DIR" merge-base --is-ancestor "$TARGET_SHA" "$TRUSTED_REF" \
  || akl_fail "Requested SHA is not reachable from $TRUSTED_REF"

if git --no-replace-objects --git-dir="$GIT_DIR" ls-tree -r "$TARGET_SHA" | awk '$1 == "160000" { found=1 } END { exit !found }'; then
  akl_fail "Release commits containing Git submodules are not supported"
fi

release_dir="${RELEASES_DIR}/${TARGET_SHA}"
if [[ -e "$release_dir" || -L "$release_dir" ]]; then
  [[ -d "$release_dir" && ! -L "$release_dir" ]] \
    || akl_fail "Existing release path must be a real directory: $release_dir"
  akl_require_read_only_release_tree "$release_dir"
  akl_verify_release_tree "$GIT_DIR" "$TARGET_SHA" "$release_dir" "$TRUSTED_REF"
  akl_require_file "${release_dir}/${COMPOSE_RELATIVE_PATH}"
  akl_assert_no_ambient_compose_overrides "${release_dir}/${COMPOSE_RELATIVE_PATH}"
  akl_fsync_tree "$release_dir"
  akl_fsync_directory "$RELEASES_DIR"
  printf '%s\n' "$release_dir"
  exit 0
fi

stage_dir="${RELEASES_DIR}/.${TARGET_SHA}.tmp.$$"
rm -rf "$stage_dir"
mkdir -p "$stage_dir"
trap cleanup_prepare EXIT

git --no-replace-objects --git-dir="$GIT_DIR" archive --format=tar "$TARGET_SHA" | tar -xf - -C "$stage_dir"
akl_require_file "${stage_dir}/${COMPOSE_RELATIVE_PATH}"
akl_assert_no_ambient_compose_overrides "${stage_dir}/${COMPOSE_RELATIVE_PATH}"

printf '%s\n' "$TARGET_SHA" >"${stage_dir}/.akl-release-sha"
printf 'git_sha=%s\ntrusted_ref=%s\nprepared_utc=%s\n' \
  "$TARGET_SHA" "$TRUSTED_REF" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  >"${stage_dir}/.akl-release-manifest"
akl_verify_release_tree "$GIT_DIR" "$TARGET_SHA" "$stage_dir" "$TRUSTED_REF"
chmod -R a-w "$stage_dir"
akl_require_read_only_release_tree "$stage_dir"
akl_fsync_tree "$stage_dir"
akl_fsync_directory "$RELEASES_DIR"
mv "$stage_dir" "$release_dir"
stage_dir=""
akl_fsync_directory "$release_dir"
akl_fsync_directory "$RELEASES_DIR"
trap - EXIT

printf '%s\n' "$release_dir"
