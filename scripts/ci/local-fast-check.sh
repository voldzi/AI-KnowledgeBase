#!/usr/bin/env bash
set -Eeuo pipefail

# The orchestrator is Python-stdlib-only. Application dependencies are built
# and executed in isolated Docker Desktop containers, never in macOS Python.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec python3 "$ROOT_DIR/scripts/ci/local_fast_check.py" "$@"
