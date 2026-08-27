#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENTRYPOINT="${ROOT_DIR}/apps/web/docker-entrypoint.sh"
DOCKERFILE="${ROOT_DIR}/apps/web/Dockerfile"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/akb-web-entrypoint.XXXXXX")"

cleanup() {
  rm -rf -- "$TEST_ROOT"
}
trap cleanup EXIT

BIN_DIR="${TEST_ROOT}/bin"
STORAGE_DIR="${TEST_ROOT}/object-storage"
CHOWN_LOG="${TEST_ROOT}/chown.log"
SESSION_ENCRYPTION_SOURCE="${TEST_ROOT}/session-encryption.source"
SESSION_STORE_SOURCE="${TEST_ROOT}/session-store.source"
SESSION_ENCRYPTION_RUNTIME="${TEST_ROOT}/runtime/session-encryption.key"
SESSION_STORE_RUNTIME="${TEST_ROOT}/runtime/session-store.secret"
mkdir -p "$BIN_DIR" "$STORAGE_DIR"
printf 'session-encryption-fixture\n' >"$SESSION_ENCRYPTION_SOURCE"
printf 'session-store-fixture\n' >"$SESSION_STORE_SOURCE"

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
AKL_WEB_SESSION_ENCRYPTION_KEY_SOURCE_FILE="$SESSION_ENCRYPTION_SOURCE" \
AKL_WEB_SESSION_ENCRYPTION_KEY_FILE="$SESSION_ENCRYPTION_RUNTIME" \
AKL_WEB_SESSION_STORE_SECRET_SOURCE_FILE="$SESSION_STORE_SOURCE" \
AKL_WEB_SESSION_STORE_SECRET_FILE="$SESSION_STORE_RUNTIME" \
AKL_TEST_CHOWN_LOG="$CHOWN_LOG" \
  sh "$ENTRYPOINT" sh -c 'exit 0'

grep -Fxq -- "-R nextjs:nextjs ${STORAGE_DIR}" "$CHOWN_LOG"
cmp "$SESSION_ENCRYPTION_SOURCE" "$SESSION_ENCRYPTION_RUNTIME"
cmp "$SESSION_STORE_SOURCE" "$SESSION_STORE_RUNTIME"
grep -Fxq -- "nextjs:nextjs ${SESSION_ENCRYPTION_RUNTIME}" "$CHOWN_LOG"
grep -Fxq -- "nextjs:nextjs ${SESSION_STORE_RUNTIME}" "$CHOWN_LOG"

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

for domain in budget projectflow archflow legacy; do
  printf 'synthetic-%s-credential\n' "$domain" >"${TEST_ROOT}/${domain}.source"
done

run_director_fixture() {
  env PATH="${BIN_DIR}:${PATH}" \
    AKL_WEB_PROFILE=chat \
    AKL_WEB_OBJECT_STORAGE_ROOT="$STORAGE_DIR" \
    AKL_TEST_CHOWN_LOG="$CHOWN_LOG" \
    AKL_DIRECTOR_COPILOT_ENABLED=true \
    AKL_IDENTITY_MODE=managed \
    AKL_DIRECTOR_COPILOT_CLIENT_SECRET_SOURCE_FILE="${TEST_ROOT}/missing-legacy" \
    AKL_DIRECTOR_COPILOT_CLIENT_SECRET_FILE="${TEST_ROOT}/runtime/legacy" \
    AKL_DIRECTOR_COPILOT_BUDGET_CLIENT_SECRET_SOURCE_FILE="${TEST_ROOT}/budget.source" \
    AKL_DIRECTOR_COPILOT_BUDGET_CLIENT_SECRET_FILE="${TEST_ROOT}/runtime/budget" \
    AKL_DIRECTOR_COPILOT_PROJECTFLOW_CLIENT_SECRET_SOURCE_FILE="${TEST_ROOT}/projectflow.source" \
    AKL_DIRECTOR_COPILOT_PROJECTFLOW_CLIENT_SECRET_FILE="${TEST_ROOT}/runtime/projectflow" \
    AKL_DIRECTOR_COPILOT_ARCHFLOW_CLIENT_SECRET_SOURCE_FILE="${TEST_ROOT}/archflow.source" \
    AKL_DIRECTOR_COPILOT_ARCHFLOW_CLIENT_SECRET_FILE="${TEST_ROOT}/runtime/archflow" \
    "$@" sh "$ENTRYPOINT" sh -c 'exit 0'
}

run_director_fixture
for domain in budget projectflow archflow; do
  cmp "${TEST_ROOT}/${domain}.source" "${TEST_ROOT}/runtime/${domain}"
  test -n "$(find "${TEST_ROOT}/runtime/${domain}" -perm 0400 -print)"
done
test ! -e "${TEST_ROOT}/runtime/legacy"

if run_director_fixture AKL_DIRECTOR_COPILOT_BUDGET_CLIENT_SECRET_SOURCE_FILE='' \
  >"${TEST_ROOT}/managed-missing.out" 2>"${TEST_ROOT}/managed-missing.err"; then
  printf 'Managed Director accepted a missing per-domain credential.\n' >&2
  exit 1
fi
grep -Fxq 'managed director copilot secret paths are not configured' "${TEST_ROOT}/managed-missing.err"

run_director_fixture AKL_IDENTITY_MODE=external_oidc \
  AKL_DIRECTOR_COPILOT_CLIENT_SECRET_SOURCE_FILE="${TEST_ROOT}/legacy.source" \
  AKL_DIRECTOR_COPILOT_BUDGET_CLIENT_SECRET_SOURCE_FILE="${TEST_ROOT}/missing-managed"
cmp "${TEST_ROOT}/legacy.source" "${TEST_ROOT}/runtime/legacy"

grep -Fxq \
  'COPY --from=builder --chown=nextjs:nextjs /app/public ./public' \
  "$DOCKERFILE" \
  || {
    printf 'Web runtime image must make immutable public assets readable by nextjs.\n' >&2
    exit 1
  }

printf 'Web Docker entrypoint profile checks passed.\n'
