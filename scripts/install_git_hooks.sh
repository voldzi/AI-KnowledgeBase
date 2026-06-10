#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_SOURCE_DIR="${ROOT_DIR}/scripts/git-hooks"
TARGET_HOOKS_DIR="${ROOT_DIR}/.git/hooks"

if [[ ! -d "${TARGET_HOOKS_DIR}" ]]; then
  printf 'ERROR: git hooks directory not found at %s\n' "${TARGET_HOOKS_DIR}" >&2
  exit 1
fi

install_hook() {
  local hook_name="$1"
  local source_file="${HOOKS_SOURCE_DIR}/${hook_name}"
  local target_file="${TARGET_HOOKS_DIR}/${hook_name}"

  if [[ ! -f "${source_file}" ]]; then
    printf 'ERROR: hook source not found: %s\n' "${source_file}" >&2
    exit 1
  fi

  cp "${source_file}" "${target_file}"
  chmod 755 "${target_file}"
  printf 'Installed git hook %s -> %s\n' "${source_file}" "${target_file}"
}

install_hook post-merge
install_hook post-checkout
