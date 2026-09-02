#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UV_BIN="${UV_BIN:-uv}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
UV_VERSION="0.12.9"
PACKAGE_CUTOFF="2026-09-02T20:00:00Z"
CONSTRAINTS="/tmp/akb-docling-base.constraints"

[[ "$(${UV_BIN} --version)" == "uv ${UV_VERSION} ("* ]] || {
  printf 'Docling lock generation requires uv %s.\n' "${UV_VERSION}" >&2
  exit 2
}
[[ "$(uname -s)/$(uname -m)" == "Darwin/arm64" ]] || {
  printf 'Docling lock generation must run on the reviewed Apple Silicon host.\n' >&2
  exit 2
}
[[ "$(${PYTHON_BIN} -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')" == "3.14" ]] || {
  printf 'The Apple Silicon Docling lock requires Python 3.14.\n' >&2
  exit 2
}

trap 'rm -f "${CONSTRAINTS}"' EXIT
cd "${ROOT}"
awk '/^[A-Za-z0-9_.-]+==/ { skip = ($0 ~ /^websockets==/) } !skip { print }' \
  services/ingestion-service/requirements.c4.lock >"${CONSTRAINTS}"

common_args=(
  --quiet
  --generate-hashes
  --no-build
  --no-emit-index-url
  --exclude-newer "${PACKAGE_CUTOFF}"
  --custom-compile-command scripts/ci/compile_docling_locks.sh
  --constraints "${CONSTRAINTS}"
)

"${UV_BIN}" pip compile "${common_args[@]}" \
  --python-version 3.12 \
  --python-platform x86_64-manylinux_2_28 \
  --torch-backend cpu \
  --output-file services/ingestion-service/requirements-docling.c4.lock \
  services/ingestion-service/requirements-docling.in

"${UV_BIN}" pip compile "${common_args[@]}" \
  --python "${PYTHON_BIN}" \
  --python-version 3.14 \
  --output-file services/ingestion-service/requirements-docling-macos.c4.lock \
  services/ingestion-service/requirements-docling-macos.in

printf 'Docling locks generated with uv %s and cutoff %s.\n' \
  "${UV_VERSION}" "${PACKAGE_CUTOFF}"
