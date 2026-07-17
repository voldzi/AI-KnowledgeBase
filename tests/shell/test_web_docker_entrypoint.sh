#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENTRYPOINT="${ROOT_DIR}/apps/web/docker-entrypoint.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/akb-web-entrypoint.XXXXXX")"

cleanup() {
  rm -rf -- "$TEST_ROOT"
}
trap cleanup EXIT

BIN_DIR="${TEST_ROOT}/bin"
STORAGE_DIR="${TEST_ROOT}/object-storage"
CHOWN_LOG="${TEST_ROOT}/chown.log"
mkdir -p "$BIN_DIR" "$STORAGE_DIR"

cat >"${BIN_DIR}/su-exec" <<'SH'
#!/bin/sh
shift
exec "$@"
SH
chmod 0700 "${BIN_DIR}/su-exec"

cat >"${BIN_DIR}/chown" <<'SH'
#!/bin/sh
if [ "${AKL_TEST_CHOWN_MUST_NOT_RUN:-false}" = "true" ]; then
  echo "chown was called for a read-only chat profile" >&2
  exit 97
fi
printf '%s\n' "$*" >>"${AKL_TEST_CHOWN_LOG:?}"
SH
chmod 0700 "${BIN_DIR}/chown"

PATH="${BIN_DIR}:${PATH}" \
AKL_WEB_PROFILE=chat \
AKL_WEB_OBJECT_STORAGE_ROOT="$STORAGE_DIR" \
AKL_WEB_INGESTION_CLIENT_SECRET_SOURCE_FILE='' \
AKL_WEB_INGESTION_CLIENT_SECRET_FILE='' \
AKL_TEST_CHOWN_MUST_NOT_RUN=true \
AKL_TEST_CHOWN_LOG="$CHOWN_LOG" \
  sh "$ENTRYPOINT" sh -c 'exit 0'

if [[ -e "$CHOWN_LOG" ]]; then
  printf 'Chat profile unexpectedly changed object-storage ownership.\n' >&2
  exit 1
fi

PATH="${BIN_DIR}:${PATH}" \
AKL_WEB_PROFILE=platform \
AKL_WEB_OBJECT_STORAGE_ROOT="$STORAGE_DIR" \
AKL_WEB_INGESTION_CLIENT_SECRET_SOURCE_FILE='' \
AKL_WEB_INGESTION_CLIENT_SECRET_FILE='' \
AKL_TEST_CHOWN_LOG="$CHOWN_LOG" \
  sh "$ENTRYPOINT" sh -c 'exit 0'

grep -Fxq -- "-R nextjs:nextjs ${STORAGE_DIR}" "$CHOWN_LOG"

if PATH="${BIN_DIR}:${PATH}" \
  AKL_WEB_PROFILE=chat \
  AKL_WEB_OBJECT_STORAGE_ROOT="${TEST_ROOT}/missing" \
  AKL_WEB_INGESTION_CLIENT_SECRET_SOURCE_FILE='' \
  AKL_WEB_INGESTION_CLIENT_SECRET_FILE='' \
  AKL_TEST_CHOWN_MUST_NOT_RUN=true \
  AKL_TEST_CHOWN_LOG="$CHOWN_LOG" \
  sh "$ENTRYPOINT" sh -c 'exit 0' \
  >"${TEST_ROOT}/missing.out" 2>"${TEST_ROOT}/missing.err"; then
  printf 'Chat profile accepted a missing object-storage mount.\n' >&2
  exit 1
fi
grep -Fxq 'chat object storage is not available' "${TEST_ROOT}/missing.err"

printf 'Web Docker entrypoint profile checks passed.\n'
