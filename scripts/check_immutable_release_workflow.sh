#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

scripts=(
  scripts/backup_registry_release.sh
  scripts/deploy_docker_home.sh
  scripts/deploy_docker_home_release.sh
  scripts/lib/immutable_release_common.sh
  scripts/prepare_docker_home_release.sh
  scripts/rollback_docker_home_release.sh
  scripts/verify_docker_home_release.sh
  tests/shell/test_immutable_docker_home_release.sh
)

for script in "${scripts[@]}"; do
  bash -n "$script"
done

if ! command -v shellcheck >/dev/null 2>&1; then
  printf 'shellcheck is required to validate the immutable release workflow.\n' >&2
  exit 1
fi
shellcheck -x "${scripts[@]}"

bash tests/shell/test_immutable_docker_home_release.sh
