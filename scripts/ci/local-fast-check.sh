#!/usr/bin/env bash
set -Eeuo pipefail

# Fast local feedback only. This script never loads production configuration,
# contacts docker.home.cz, or replaces the trusted Gitea release gate.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_REF=""
PRODUCTION_SHA=""
FULL=false
SKIP_INSTALL=false

usage() {
  cat <<'EOF'
Usage: scripts/ci/local-fast-check.sh [options]

Options:
  --base REF       Compare the working tree to REF (default: origin/main)
  --production-sha SHA  Also require the current production full SHA in HEAD
  --full           Run every local application check
  --skip-install   Do not install Node or Python dependencies
  -h, --help       Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      BASE_REF="$2"
      shift 2
      ;;
    --production-sha)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      PRODUCTION_SHA="$2"
      shift 2
      ;;
    --full) FULL=true; shift ;;
    --skip-install) SKIP_INSTALL=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

cd "$ROOT_DIR"
BASE_REF="${BASE_REF:-origin/main}"
baseline_args=(--base "$BASE_REF")
if [[ -n "$PRODUCTION_SHA" ]]; then
  baseline_args+=(--production-sha "$PRODUCTION_SHA")
fi
python3 scripts/ci/check_working_baseline.py "${baseline_args[@]}"
changed_file="$(mktemp)"
log_dir="$(mktemp -d "${TMPDIR:-/tmp}/akb-local-ci.XXXXXX")"
cleanup() { rm -f "$changed_file"; rm -rf "$log_dir"; }
trap cleanup EXIT

if [[ "$FULL" == true ]]; then
  printf '%s\n' pyproject.toml >"$changed_file"
else
  {
    git diff --name-only "$BASE_REF"...HEAD --
    git diff --cached --name-only --
    git diff --name-only --
    git ls-files --others --exclude-standard
  } | sort -u >"$changed_file" || {
    printf 'Could not compare with %s; running the full local suite.\n' "$BASE_REF" >&2
    printf '%s\n' pyproject.toml >"$changed_file"
  }
  if [[ ! -s "$changed_file" ]]; then
    git diff --name-only -- >"$changed_file"
  fi
fi

plan_file="$log_dir/impact-plan"
python3 scripts/ci/affected_components.py "$changed_file" >"$plan_file"
cat "$plan_file"

is_true() { grep -qx "$1=true" "$plan_file"; }

run_python_service() {
  local service="$1"
  local log="$log_dir/$service.log"
  {
    set -euo pipefail
    if [[ "$SKIP_INSTALL" != true ]]; then
      if [[ "$service" == registry-api ]]; then
        python3 -m pip install -e ".[test]"
      else
        python3 -m pip install -r requirements.txt
      fi
    fi
    PYTHONPATH=. python3 -m pytest
  } >"$log" 2>&1
}

pids=()
services=(registry-api ingestion-service rag-retrieval-service llm-gateway-service evaluation-service governance-service)
for service in "${services[@]}"; do
  component="${service//-/_}"
  if is_true "$component"; then
    (cd "services/$service" && run_python_service "$service") &
    pids+=("$!")
  fi
done

if is_true web; then
  (
    set -euo pipefail
    cd apps/web
    if [[ "$SKIP_INSTALL" != true ]]; then
      pnpm install --frozen-lockfile
    fi
    pnpm semantic-registry:check
    pnpm typecheck
    pnpm test
    pnpm build
  ) >"$log_dir/web.log" 2>&1 &
  pids+=("$!")
fi

failed=0
for pid in "${pids[@]}"; do
  if ! wait "$pid"; then failed=1; fi
done

if is_true compose; then
  docker compose \
    --env-file infra/docker-compose/docker-home.env.example \
    -f infra/docker-compose/docker-compose.docker-home.yml \
    config >/dev/null
fi

for log in "$log_dir"/*.log; do
  [[ -f "$log" ]] || continue
  printf '\n--- %s ---\n' "${log##*/}"
  cat "$log"
done

(( failed == 0 )) || { printf '\nLocal fast-check failed.\n' >&2; exit 1; }
printf '\nLocal fast-check passed. Run trusted Gitea CI before release.\n'
