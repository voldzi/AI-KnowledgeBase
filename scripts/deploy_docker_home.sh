#!/usr/bin/env bash
set +x
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

printf 'This compatibility entry point now requires an exact immutable release SHA.\n' >&2
printf 'It never pulls or checks out /srv/akl/repo.\n' >&2
exec "${SCRIPT_DIR}/deploy_docker_home_release.sh" "$@"
