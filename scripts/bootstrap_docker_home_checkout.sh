#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-/srv/akl/env/akl.prod.env}"

printf 'Bootstrapping docker-home checkout in %s\n' "${ROOT_DIR}"

"${ROOT_DIR}/scripts/install_git_hooks.sh"
"${ROOT_DIR}/scripts/link_docker_home_env.sh" "${ENV_FILE}"

printf 'Done.\n'
printf 'Installed git hooks and refreshed local compose env files from %s\n' "${ENV_FILE}"
