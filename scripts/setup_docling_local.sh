#!/usr/bin/env bash
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="${AKL_DOCLING_VENV_DIR:-${ROOT}/data/docling-venv}"
ARTIFACTS_DIR="${AKL_DOCLING_ARTIFACTS_DIR:-${ROOT}/data/docling-models}"
MIN_FREE_GIB="${AKL_DOCLING_MIN_FREE_GIB:-20}"

if [[ ! "${MIN_FREE_GIB}" =~ ^[1-9][0-9]*$ ]]; then
  printf 'AKL_DOCLING_MIN_FREE_GIB must be a positive integer.\n' >&2
  exit 2
fi
AVAILABLE_KIB="$(df -Pk "${ROOT}" | awk 'NR == 2 { print $4 }')"
REQUIRED_KIB="$((MIN_FREE_GIB * 1024 * 1024))"
if [[ ! "${AVAILABLE_KIB}" =~ ^[0-9]+$ ]] || (( AVAILABLE_KIB < REQUIRED_KIB )); then
  printf 'Docling setup requires at least %s GiB free on the workspace volume.\n' \
    "${MIN_FREE_GIB}" >&2
  exit 2
fi

SYSTEM="$(uname -s)"
MACHINE="$(uname -m)"
case "${SYSTEM}/${MACHINE}" in
  Darwin/arm64)
    REQUIRED_PYTHON_MINOR="3.14"
    LOCK_FILE="requirements-docling-macos.c4.lock"
    PIP_INDEX_ARGS=()
    MODELS=(layout tableformer granitedocling granitedocling_mlx)
    ;;
  Linux/x86_64)
    REQUIRED_PYTHON_MINOR="3.12"
    LOCK_FILE="requirements-docling.c4.lock"
    PIP_INDEX_ARGS=(--extra-index-url https://download.pytorch.org/whl/cpu)
    MODELS=(layout tableformer granitedocling)
    ;;
  *)
    printf 'Unsupported Docling host: %s/%s\n' "${SYSTEM}" "${MACHINE}" >&2
    exit 2
    ;;
esac

ACTUAL_PYTHON_MINOR="$(${PYTHON_BIN} -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
if [[ "${ACTUAL_PYTHON_MINOR}" != "${REQUIRED_PYTHON_MINOR}" ]]; then
  printf 'Docling on %s/%s requires Python %s; got %s.\n' \
    "${SYSTEM}" "${MACHINE}" "${REQUIRED_PYTHON_MINOR}" "${ACTUAL_PYTHON_MINOR}" >&2
  exit 2
fi

"${PYTHON_BIN}" -m venv "${VENV_DIR}"
"${VENV_DIR}/bin/pip" install --only-binary=:all: --require-hashes \
  "${PIP_INDEX_ARGS[@]}" \
  -r "${ROOT}/services/ingestion-service/${LOCK_FILE}"
"${VENV_DIR}/bin/docling-tools" models download \
  "${MODELS[@]}" \
  --output-dir "${ARTIFACTS_DIR}"

ARTIFACTS_SHA256="$({
  cd "${ROOT}/services/ingestion-service"
  PYTHONPATH=. "${VENV_DIR}/bin/python" -c \
    "import sys; from pathlib import Path; from parsers.docling import directory_sha256; print(directory_sha256(Path(sys.argv[1])))" \
    "${ARTIFACTS_DIR}"
})"

printf '%s\n' \
  "Docling local runtime is ready." \
  "Dependency lock: ${LOCK_FILE}" \
  "AKL_INGESTION_DOCLING_ARTIFACTS_PATH=${ARTIFACTS_DIR}" \
  "AKL_INGESTION_DOCLING_ARTIFACTS_SHA256=${ARTIFACTS_SHA256}" \
  "Use shadow mode first; no application configuration was modified."
