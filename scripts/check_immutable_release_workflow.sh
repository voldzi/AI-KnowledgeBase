#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

scripts=(
  scripts/backup_registry_release.sh
  scripts/bootstrap_docker_home_target.sh
  scripts/check_registry_writable_primary.sh
  scripts/cleanup_stale_release_postgres_credentials.sh
  scripts/cleanup_stale_release_env_snapshot.sh
  scripts/deploy_docker_home.sh
  scripts/deploy_docker_home_release.sh
  scripts/lib/immutable_release_common.sh
  scripts/prepare_docker_home_release.sh
  scripts/rollback_docker_home_release.sh
  scripts/verify_docker_home_release.sh
  tests/fixtures/legacy_deploy_orchestrator.sh
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

(
  set -Eeuo pipefail
  compose_probe_root="$(mktemp -d "${TMPDIR:-/tmp}/akl-real-compose-env-probe.XXXXXX")"
  # Invoked indirectly by the EXIT trap below.
  # shellcheck disable=SC2329
  cleanup_compose_probe() {
    local status=$?
    trap - EXIT
    rm -rf -- "$compose_probe_root"
    exit "$status"
  }
  trap cleanup_compose_probe EXIT
  chmod 0700 "$compose_probe_root"
  umask 077
  compose_probe_env="${compose_probe_root}/akl.prod.env"
  compose_probe_file="${compose_probe_root}/compose.yml"
  printf 'AKL_REAL_COMPOSE_ENV_PROBE=expected-reopened-value\nAKL_REAL_COMPOSE_PINNED_IMAGE=sha256:%s\n' \
    "$(printf 'a%.0s' {1..64})" >"$compose_probe_env"
  chmod 0600 "$compose_probe_env"
  cat >"$compose_probe_file" <<'YAML'
services:
  probe:
    image: ${AKL_REAL_COMPOSE_PINNED_IMAGE:?durable image-ID probe is missing}
    environment:
      AKL_REAL_COMPOSE_ENV_PROBE: ${AKL_REAL_COMPOSE_ENV_PROBE:?real Compose env snapshot probe is missing}
YAML
  chmod 0600 "$compose_probe_file"

  docker compose version >/dev/null
  docker compose \
    --project-name akl-real-compose-env-probe \
    --env-file "$compose_probe_env" \
    -f "$compose_probe_file" \
    config --quiet
  rendered_compose="$({
    docker compose \
      --project-name akl-real-compose-env-probe \
      --env-file "$compose_probe_env" \
      -f "$compose_probe_file" \
      config --format json
  })"
  python3 - "$rendered_compose" <<'PY'
import json
import sys

document = json.loads(sys.argv[1])
environment = document["services"]["probe"]["environment"]
if environment.get("AKL_REAL_COMPOSE_ENV_PROBE") != "expected-reopened-value":
    raise SystemExit("real Docker Compose did not reopen the linked env snapshot exactly")
expected_image = "sha256:" + ("a" * 64)
if document["services"]["probe"].get("image") != expected_image:
    raise SystemExit("real Docker Compose did not retain the durable image ID")
PY
)

bash tests/shell/test_immutable_docker_home_release.sh
