#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/immutable_release_common.sh
source "${SCRIPT_DIR}/lib/immutable_release_common.sh"

usage() {
  printf 'Usage: %s <full-git-sha>\n' "$0" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
TARGET_SHA="$1"
akl_validate_full_sha "$TARGET_SHA"

RELEASE_ROOT="${AKL_RELEASE_ROOT:-/srv/akl}"
ENV_FILE="${AKL_PROD_ENV_FILE:-${RELEASE_ROOT}/env/akl.prod.env}"
BACKUPS_DIR="${RELEASE_ROOT}/backups"
TIMESTAMP="${AKL_RELEASE_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
[[ "$TIMESTAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || akl_fail "Invalid backup timestamp"

akl_require_command pg_dump
akl_require_command pg_restore
akl_require_command psql
akl_require_command python3
akl_require_command sha256sum
akl_require_private_env_file "$ENV_FILE"
[[ "${AKL_REGISTRY_WRITERS_QUIESCED:-}" == "true" ]] \
  || akl_fail "Registry backup requires an explicit verified writer-quiesce handoff"

database_url="$(akl_env_value "$ENV_FILE" AKL_REGISTRY_DATABASE_URL)"
[[ -n "$database_url" ]] || akl_fail "AKL_REGISTRY_DATABASE_URL is missing"
database_url="${database_url/postgresql+psycopg:\/\//postgresql:\/\/}"
database_identity="$(DATABASE_URL="$database_url" python3 - <<'PY'
import os
import re
from urllib.parse import unquote, urlsplit

parsed = urlsplit(os.environ["DATABASE_URL"])
if parsed.scheme != "postgresql" or not parsed.username or not parsed.password:
    raise SystemExit("Registry database URL must contain a PostgreSQL user and password")
host = parsed.hostname or ""
port = parsed.port or 5432
database = unquote(parsed.path.lstrip("/"))
if not re.fullmatch(r"[A-Za-z0-9._-]+", host):
    raise SystemExit("Registry database host is missing or invalid")
if not re.fullmatch(r"[A-Za-z0-9._-]+", database):
    raise SystemExit("Registry database name is missing or invalid")
print(f"database_host={host}\ndatabase_port={port}\ndatabase_name={database}")
PY
)"
database_host="$(awk -F= '$1 == "database_host" {print $2}' <<<"$database_identity")"
database_port="$(awk -F= '$1 == "database_port" {print $2}' <<<"$database_identity")"
expected_database_host="$(akl_env_value "$ENV_FILE" AKL_RELEASE_EXPECTED_REGISTRY_DB_HOST haproxy.home.cz)"
expected_database_port="$(akl_env_value "$ENV_FILE" AKL_RELEASE_EXPECTED_REGISTRY_DB_PORT 5000)"
[[ "$database_host" == "$expected_database_host" && "$database_port" == "$expected_database_port" ]] \
  || akl_fail "Registry database must use ${expected_database_host}:${expected_database_port}"

umask 077
mkdir -p "$BACKUPS_DIR"
final_dir="${BACKUPS_DIR}/registry-${TIMESTAMP}-${TARGET_SHA}"
[[ ! -e "$final_dir" ]] || akl_fail "Backup directory already exists: $final_dir"
stage_dir="$(mktemp -d "${BACKUPS_DIR}/.registry-${TIMESTAMP}-${TARGET_SHA}.tmp.XXXXXX")"
trap 'rm -rf "${stage_dir:-}"' EXIT

dump_file="${stage_dir}/registry.dump"
restore_list="${stage_dir}/pg_restore.list"
checksum_file="${stage_dir}/registry.dump.sha256"
inventory_file="${stage_dir}/inventory.txt"

alembic_before="$(
  PGAPPNAME=akl-release-inventory PGDATABASE="$database_url" psql \
    --no-psqlrc --tuples-only --no-align \
    --command='SELECT version_num FROM alembic_version LIMIT 1'
)"
alembic_before="$(printf '%s' "$alembic_before" | tr -d '[:space:]')"
[[ "$alembic_before" =~ ^[0-9]{4}_[a-z0-9_]+$ ]] \
  || akl_fail "Could not inventory the current full Alembic revision"

printf 'Creating fail-closed Registry PostgreSQL custom dump...\n' >&2
PGAPPNAME=akl-release-backup PGDATABASE="$database_url" pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$dump_file"
[[ -s "$dump_file" ]] || akl_fail "Registry custom dump is empty"

pg_restore --list "$dump_file" >"$restore_list"
[[ -s "$restore_list" ]] || akl_fail "pg_restore --list produced an empty inventory"
(
  cd "$stage_dir"
  sha256sum registry.dump >registry.dump.sha256
  sha256sum --check registry.dump.sha256 >/dev/null
)

current_sha="$(akl_current_release_sha "$RELEASE_ROOT")"
dump_sha="$(awk '{print $1}' "$checksum_file")"
dump_bytes="$(wc -c <"$dump_file" | tr -d '[:space:]')"
restore_entries="$(grep -vc '^;' "$restore_list" || true)"
[[ "$restore_entries" =~ ^[1-9][0-9]*$ ]] \
  || akl_fail "pg_restore --list did not contain any restore entries"

{
  printf 'created_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'target_release_sha=%s\n' "$TARGET_SHA"
  printf 'current_release_sha=%s\n' "${current_sha:-none}"
  printf 'alembic_before=%s\n' "$alembic_before"
  printf 'registry_writers_quiesced=true\n'
  printf '%s\n' "$database_identity"
  printf 'dump_format=custom\n'
  printf 'dump_sha256=%s\n' "$dump_sha"
  printf 'dump_bytes=%s\n' "$dump_bytes"
  printf 'pg_restore_entries=%s\n' "$restore_entries"
  printf 'pg_dump_version=%s\n' "$(pg_dump --version | head -n 1)"
  printf 'pg_restore_version=%s\n' "$(pg_restore --version | head -n 1)"
} >"$inventory_file"

chmod 0600 "$dump_file" "$restore_list" "$checksum_file" "$inventory_file"
mv "$stage_dir" "$final_dir"
stage_dir=""
trap - EXIT

printf '%s\n' "$final_dir"
