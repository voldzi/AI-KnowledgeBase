#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET_COMPOSE="$ROOT_DIR/infra/docker-compose/docker-compose.docker-home.yml"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/akb-external-qdrant-cutover.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

CURRENT_COMPOSE="$WORK_DIR/current.yml"
python3 - "$TARGET_COMPOSE" "$CURRENT_COMPOSE" <<'PY'
import sys
from pathlib import Path

target = Path(sys.argv[1]).read_text(encoding="utf-8")
service = """\
  qdrant:
    image: qdrant/qdrant:v1.19.1
    volumes:
      - qdrant-data:/qdrant/storage

"""
current = target.replace("\nnetworks:\n", "\n" + service + "networks:\n", 1)
current = current.replace(
    ",web=http://akl-web-1:3000${AKL_WEB_BASE_PATH:-/akb}/health}",
    ",qdrant=http://qdrant:6333/readyz,web=http://akl-web-1:3000${AKL_WEB_BASE_PATH:-/akb}/health}",
    1,
)
Path(sys.argv[2]).write_text(current, encoding="utf-8")
PY

# shellcheck source=scripts/lib/immutable_release_common.sh
source "$ROOT_DIR/scripts/lib/immutable_release_common.sh"

changed_services="$(
  akl_changed_supported_compose_services "$CURRENT_COMPOSE" "$TARGET_COMPOSE" \
    | paste -sd ' ' -
)"
[[ "$changed_services" == "ingestion-service rag-retrieval-service" ]] \
  || {
    printf 'External Qdrant cutover selected unexpected services: %s\n' \
      "$changed_services" >&2
    exit 1
  }

printf 'External Qdrant immutable-cutover regression checks passed.\n'
