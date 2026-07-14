#!/usr/bin/env bash
set +x
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
DEPLOYMENT_ID="${AKL_RELEASE_DEPLOYMENT_ID:-}"
[[ "$TIMESTAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || akl_fail "Invalid backup timestamp"
akl_validate_deployment_id "$DEPLOYMENT_ID"

akl_require_command docker
akl_require_command id
akl_require_command mktemp
akl_require_command python3
akl_require_command sha256sum
akl_require_private_env_file "$ENV_FILE"
akl_assert_expected_env_snapshot "$ENV_FILE"
akl_assert_no_ambient_env_file_overrides "$ENV_FILE"
akl_assert_local_docker_daemon_environment
akl_assert_registry_writer_quiesced "$RELEASE_ROOT" "$DEPLOYMENT_ID" backup-entry

postgres_tool_image="$(akl_env_value "$ENV_FILE" AKL_RELEASE_POSTGRES_TOOL_IMAGE)"
[[ -n "$postgres_tool_image" ]] \
  || akl_fail "AKL_RELEASE_POSTGRES_TOOL_IMAGE is missing"
postgres_tool_image_id="$(akl_resolve_local_exact_image_id "$postgres_tool_image")"
if [[ -n "${AKL_RELEASE_EXPECTED_POSTGRES_TOOL_IMAGE_ID:-}" \
  && "$postgres_tool_image_id" != "$AKL_RELEASE_EXPECTED_POSTGRES_TOOL_IMAGE_ID" ]]; then
  akl_fail "PostgreSQL tool image identity changed after deployment preflight"
fi
psql_version="$(akl_postgres_tool_version "$postgres_tool_image" psql)"
pg_dump_version="$(akl_postgres_tool_version "$postgres_tool_image" pg_dump)"
pg_restore_version="$(akl_postgres_tool_version "$postgres_tool_image" pg_restore)"

database_url="$(akl_env_value "$ENV_FILE" AKL_REGISTRY_DATABASE_URL)"
[[ -n "$database_url" ]] || akl_fail "AKL_REGISTRY_DATABASE_URL is missing"
database_url="${database_url/postgresql+psycopg:\/\//postgresql:\/\/}"
umask 077
credentials_dir="$(
  akl_postgres_credentials_dir_path "$RELEASE_ROOT" "$DEPLOYMENT_ID" backup
)"
stage_dir=""
cleanup_backup() {
  local status=$?
  local cleanup_status=0
  trap - EXIT
  if [[ -n "${credentials_dir:-}" \
    && ( -e "$credentials_dir" || -L "$credentials_dir" ) ]]; then
    akl_cleanup_private_postgres_credentials_dir \
      "$RELEASE_ROOT" "$credentials_dir" || cleanup_status=1
  fi
  if [[ -n "${stage_dir:-}" && ( -e "$stage_dir" || -L "$stage_dir" ) ]]; then
    rm -rf "$stage_dir" || cleanup_status=1
  fi
  if [[ "$cleanup_status" -ne 0 ]]; then
    printf 'CRITICAL: Private PostgreSQL credential or backup staging cleanup failed.\n' >&2
    status=1
  fi
  exit "$status"
}
trap cleanup_backup EXIT
akl_create_private_postgres_credentials_dir \
  "$RELEASE_ROOT" "$DEPLOYMENT_ID" backup
pgpass_file="${credentials_dir}/pgpass"
identity_file="${credentials_dir}/identity.env"
DATABASE_URL="$database_url" python3 - "$pgpass_file" "$identity_file" <<'PY'
import os
import re
import sys
from urllib.parse import unquote, urlsplit

raw_database_url = os.environ["DATABASE_URL"]
parsed = urlsplit(raw_database_url)
if parsed.scheme != "postgresql" or not parsed.username or not parsed.password:
    raise SystemExit("Registry database URL must contain a PostgreSQL user and password")
if "?" in raw_database_url or "#" in raw_database_url or parsed.query or parsed.fragment:
    raise SystemExit(
        "Registry database URL query and fragment parameters are forbidden because they can override the verified connection identity"
    )
host = parsed.hostname or ""
port = parsed.port or 5432
database = unquote(parsed.path.lstrip("/"))
username = unquote(parsed.username)
password = unquote(parsed.password)
if not re.fullmatch(r"[A-Za-z0-9._-]+", host):
    raise SystemExit("Registry database host is missing or invalid")
if not re.fullmatch(r"[A-Za-z0-9._-]+", database):
    raise SystemExit("Registry database name is missing or invalid")
if not re.fullmatch(r"[A-Za-z0-9._-]+", username):
    raise SystemExit("Registry database user is missing or invalid")
if any(character in password for character in "\r\n\0"):
    raise SystemExit("Registry database password is invalid")

def pgpass_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace(":", "\\:")

pgpass_path = sys.argv[1]
identity_path = sys.argv[2]
with open(pgpass_path, "x", encoding="utf-8") as handle:
    handle.write(
        ":".join(
            pgpass_escape(value)
            for value in (host, str(port), database, username, password)
        )
        + "\n"
    )
os.chmod(pgpass_path, 0o600)
with open(identity_path, "x", encoding="utf-8") as handle:
    handle.write(
        f"database_host={host}\n"
        f"database_port={port}\n"
        f"database_name={database}\n"
        f"database_user={username}\n"
    )
os.chmod(identity_path, 0o600)
PY
unset database_url
database_identity="$(<"$identity_file")"
database_host="$(awk -F= '$1 == "database_host" {print $2}' <<<"$database_identity")"
database_port="$(awk -F= '$1 == "database_port" {print $2}' <<<"$database_identity")"
database_name="$(awk -F= '$1 == "database_name" {print $2}' <<<"$database_identity")"
database_user="$(awk -F= '$1 == "database_user" {print $2}' <<<"$database_identity")"
expected_database_host="$(akl_env_value "$ENV_FILE" AKL_RELEASE_EXPECTED_REGISTRY_DB_HOST haproxy.home.cz)"
expected_database_port="$(akl_env_value "$ENV_FILE" AKL_RELEASE_EXPECTED_REGISTRY_DB_PORT 5000)"
expected_database_name="$(akl_env_value "$ENV_FILE" AKL_RELEASE_EXPECTED_REGISTRY_DB_NAME)"
expected_database_user="$(akl_env_value "$ENV_FILE" AKL_RELEASE_EXPECTED_REGISTRY_DB_USER)"
[[ "$expected_database_host" =~ ^[A-Za-z0-9._-]+$ ]] \
  || akl_fail "AKL_RELEASE_EXPECTED_REGISTRY_DB_HOST is missing or invalid"
[[ "$expected_database_port" =~ ^[1-9][0-9]*$ && "$expected_database_port" -le 65535 ]] \
  || akl_fail "AKL_RELEASE_EXPECTED_REGISTRY_DB_PORT is missing or invalid"
[[ "$expected_database_name" =~ ^[A-Za-z0-9._-]+$ ]] \
  || akl_fail "AKL_RELEASE_EXPECTED_REGISTRY_DB_NAME is missing or invalid"
[[ "$expected_database_user" =~ ^[A-Za-z0-9._-]+$ ]] \
  || akl_fail "AKL_RELEASE_EXPECTED_REGISTRY_DB_USER is missing or invalid"
[[ "$database_host" == "$expected_database_host" \
  && "$database_port" == "$expected_database_port" \
  && "$database_name" == "$expected_database_name" \
  && "$database_user" == "$expected_database_user" ]] \
  || akl_fail "Registry database URL does not match the expected host, port, database, and user identity"

mkdir -p "$BACKUPS_DIR"
akl_fsync_directory "$RELEASE_ROOT"
final_dir="${BACKUPS_DIR}/registry-${TIMESTAMP}-${TARGET_SHA}"
[[ ! -e "$final_dir" ]] || akl_fail "Backup directory already exists: $final_dir"
stage_dir="$(mktemp -d "${BACKUPS_DIR}/.registry-${TIMESTAMP}-${TARGET_SHA}.tmp.XXXXXX")"

for bind_path in "$pgpass_file" "$stage_dir"; do
  [[ "$bind_path" != *,* && "$bind_path" != *$'\n'* && "$bind_path" != *$'\r'* ]] \
    || akl_fail "PostgreSQL tool bind path contains an unsupported character"
done

POSTGRES_TOOL_RUN=(
  docker run
  --rm
  --pull never
  --network host
  --read-only
  --cap-drop ALL
  --security-opt no-new-privileges
  --user "$(id -u):$(id -g)"
  --tmpfs "/tmp:rw,noexec,nosuid,nodev,size=16m"
)

run_postgres_tool() {
  local application_name="$1"
  local credentials_required="$2"
  local backup_mount_mode="$3"
  shift 3
  local -a docker_options=()

  if [[ "$credentials_required" == "true" ]]; then
    docker_options+=(
      --env PGHOST
      --env PGPORT
      --env PGDATABASE
      --env PGUSER
      --env PGAPPNAME
      --env PGPASSFILE=/run/secrets/akl-pgpass
      --mount "type=bind,src=${pgpass_file},dst=/run/secrets/akl-pgpass,readonly"
    )
  elif [[ "$credentials_required" != "false" ]]; then
    akl_fail "Invalid PostgreSQL credential-mount request"
  fi
  if [[ "$backup_mount_mode" == "readwrite" ]]; then
    docker_options+=(
      --mount "type=bind,src=${stage_dir},dst=/backup"
    )
  elif [[ "$backup_mount_mode" == "readonly" ]]; then
    docker_options+=(
      --mount "type=bind,src=${stage_dir},dst=/backup,readonly"
    )
  elif [[ "$backup_mount_mode" != "none" ]]; then
    akl_fail "Invalid PostgreSQL backup-mount request"
  fi

  PGHOST="$database_host" \
  PGPORT="$database_port" \
  PGDATABASE="$database_name" \
  PGUSER="$database_user" \
  PGAPPNAME="$application_name" \
    "${POSTGRES_TOOL_RUN[@]}" \
      "${docker_options[@]}" \
      "$postgres_tool_image" \
      "$@"
}

dump_file="${stage_dir}/registry.dump"
restore_list="${stage_dir}/pg_restore.list"
checksum_file="${stage_dir}/registry.dump.sha256"
inventory_file="${stage_dir}/inventory.txt"

backend_identity="$(
  run_postgres_tool akl-release-backend-identity true none psql \
    --no-psqlrc --tuples-only --no-align --field-separator='|' \
    --command="SELECT current_database(), current_user, COALESCE(inet_server_addr()::text, ''), COALESCE(inet_server_port()::text, '')"
)"
backend_identity="$(printf '%s' "$backend_identity" | tr -d '\r\n')"
[[ "$(awk -F'|' '{print NF}' <<<"$backend_identity")" -eq 4 ]] \
  || akl_fail "Registry database returned a malformed backup identity response"
IFS='|' read -r actual_database_name actual_database_user backend_address backend_port \
  <<<"$backend_identity"
[[ "$actual_database_name" == "$expected_database_name" \
  && "$actual_database_user" == "$expected_database_user" ]] \
  || akl_fail "Registry backup backend does not match the expected database and user identity"
[[ -z "$backend_address" || "$backend_address" =~ ^[0-9A-Fa-f:.]+$ ]] \
  || akl_fail "Registry backup backend returned an invalid server address"
[[ -z "$backend_port" || ( "$backend_port" =~ ^[1-9][0-9]*$ && "$backend_port" -le 65535 ) ]] \
  || akl_fail "Registry backup backend returned an invalid server port"

alembic_before_output="$(
  run_postgres_tool akl-release-inventory true none psql \
    --no-psqlrc --tuples-only --no-align \
    --command='SELECT version_num FROM alembic_version ORDER BY version_num'
)"
mapfile -t alembic_before_revisions < <(
  awk 'NF {gsub(/^[[:space:]]+|[[:space:]]+$/, ""); print}' \
    <<<"$alembic_before_output"
)
[[ ${#alembic_before_revisions[@]} -eq 1 \
  && "${alembic_before_revisions[0]}" =~ ^[0-9]{4}_[a-z0-9_]+$ ]] \
  || akl_fail "Registry database must contain exactly one full Alembic revision before backup"
alembic_before="${alembic_before_revisions[0]}"

critical_counts="$(
  run_postgres_tool akl-release-row-counts true none psql \
    --no-psqlrc --tuples-only --no-align --field-separator='|' \
    --command='SELECT (SELECT COUNT(*) FROM documents), (SELECT COUNT(*) FROM document_versions), (SELECT COUNT(*) FROM document_files), (SELECT COUNT(*) FROM document_access_policies), (SELECT COUNT(*) FROM audit_events)'
)"
critical_counts="$(printf '%s' "$critical_counts" | tr -d '\r\n')"
[[ "$(awk -F'|' '{print NF}' <<<"$critical_counts")" -eq 5 ]] \
  || akl_fail "Registry database returned malformed critical-table row counts"
IFS='|' read -r documents_count document_versions_count document_files_count \
  document_access_policies_count audit_events_count <<<"$critical_counts"
for critical_count in \
  "$documents_count" \
  "$document_versions_count" \
  "$document_files_count" \
  "$document_access_policies_count" \
  "$audit_events_count"; do
  [[ "$critical_count" =~ ^[0-9]+$ ]] \
    || akl_fail "Registry database returned an invalid critical-table row count"
done

akl_assert_registry_writer_quiesced "$RELEASE_ROOT" "$DEPLOYMENT_ID" backup-pre-dump
printf 'Creating fail-closed Registry PostgreSQL custom dump...\n' >&2
run_postgres_tool akl-release-backup true readwrite pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file=/backup/registry.dump
[[ -s "$dump_file" ]] || akl_fail "Registry custom dump is empty"

run_postgres_tool akl-release-restore-list false readonly \
  pg_restore --list /backup/registry.dump >"$restore_list"
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
  printf 'documents_count=%s\n' "$documents_count"
  printf 'document_versions_count=%s\n' "$document_versions_count"
  printf 'document_files_count=%s\n' "$document_files_count"
  printf 'document_access_policies_count=%s\n' "$document_access_policies_count"
  printf 'audit_events_count=%s\n' "$audit_events_count"
  printf 'registry_writers_quiesced=true\n'
  printf '%s\n' "$database_identity"
  printf 'actual_database_name=%s\n' "$actual_database_name"
  printf 'actual_database_user=%s\n' "$actual_database_user"
  printf 'backend_server_address=%s\n' "${backend_address:-unavailable}"
  printf 'backend_server_port=%s\n' "${backend_port:-unavailable}"
  printf 'dump_format=custom\n'
  printf 'dump_sha256=%s\n' "$dump_sha"
  printf 'dump_bytes=%s\n' "$dump_bytes"
  printf 'pg_restore_entries=%s\n' "$restore_entries"
  printf 'postgres_tool_image_ref=%s\n' "$postgres_tool_image"
  printf 'postgres_tool_image_id=%s\n' "$postgres_tool_image_id"
  printf 'psql_version=%s\n' "$psql_version"
  printf 'pg_dump_version=%s\n' "$pg_dump_version"
  printf 'pg_restore_version=%s\n' "$pg_restore_version"
} >"$inventory_file"

chmod 0600 "$dump_file" "$restore_list" "$checksum_file" "$inventory_file"
akl_fsync_file "$dump_file"
akl_fsync_file "$restore_list"
akl_fsync_file "$checksum_file"
akl_fsync_file "$inventory_file"
akl_fsync_directory "$stage_dir"
akl_cleanup_private_postgres_credentials_dir "$RELEASE_ROOT" "$credentials_dir"
credentials_dir=""
mv "$stage_dir" "$final_dir"
stage_dir=""
akl_fsync_directory "$final_dir"
akl_fsync_directory "$BACKUPS_DIR"
trap - EXIT

printf '%s\n' "$final_dir"
