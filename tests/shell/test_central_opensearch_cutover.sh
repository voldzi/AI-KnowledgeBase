#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET_COMPOSE="$ROOT_DIR/infra/docker-compose/docker-compose.docker-home.yml"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/akl-central-opensearch-cutover.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

CURRENT_COMPOSE="$WORK_DIR/current.yml"
python3 - "$TARGET_COMPOSE" "$CURRENT_COMPOSE" <<'PY'
import sys
from pathlib import Path

target = Path(sys.argv[1]).read_text(encoding="utf-8")
service = """\
  opensearch:
    image: opensearchproject/opensearch:2
    volumes:
      - opensearch-data:/usr/share/opensearch/data

"""
current = target.replace("\nnetworks:\n", "\n" + service + "networks:\n", 1)
current = current.replace("  qdrant-data:\n", "  qdrant-data:\n  opensearch-data:\n", 1)
current = current.replace(
    ",web=http://akl-web-1:3000${AKL_WEB_BASE_PATH:-/akb}/health}",
    ",opensearch=http://opensearch:9200,web=http://akl-web-1:3000${AKL_WEB_BASE_PATH:-/akb}/health}",
    1,
)
Path(sys.argv[2]).write_text(current, encoding="utf-8")
PY

# shellcheck source=scripts/lib/immutable_release_common.sh
source "$ROOT_DIR/scripts/lib/immutable_release_common.sh"

mapfile -t changed_services < <(
  akl_changed_supported_compose_services "$CURRENT_COMPOSE" "$TARGET_COMPOSE"
)
[[ "${changed_services[*]}" == "ingestion-service rag-retrieval-service" ]] \
  || {
    printf 'Central OpenSearch cutover selected unexpected services: %s\n' \
      "${changed_services[*]}" >&2
    exit 1
  }

printf 'Central OpenSearch immutable-cutover regression checks passed.\n'
