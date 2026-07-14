#!/usr/bin/env bash
set +x
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/immutable_release_common.sh
source "${SCRIPT_DIR}/lib/immutable_release_common.sh"

usage() {
  printf 'Usage: %s --phase <pre-stop|pre-quiesce|pre-migration>\n' "$0" >&2
  exit 2
}

PHASE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --phase)
      [[ $# -ge 2 ]] || usage
      PHASE="$2"
      shift 2
      ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done
case "$PHASE" in
  pre-stop|pre-quiesce|pre-migration) ;;
  *) usage ;;
esac

RELEASE_ROOT="${AKL_RELEASE_ROOT:-/srv/akl}"
ENV_FILE="${AKL_PROD_ENV_FILE:-${RELEASE_ROOT}/env/akl.prod.env}"
EXPECTED_POSTGRES_TOOL_IMAGE_ID="${AKL_RELEASE_EXPECTED_POSTGRES_TOOL_IMAGE_ID:-}"
DEPLOYMENT_ID="${AKL_RELEASE_DEPLOYMENT_ID:-primary-gate-${PHASE}-$$}"
akl_validate_deployment_id "$DEPLOYMENT_ID"

akl_require_command docker
akl_require_command id
akl_require_command python3
akl_require_private_env_file "$ENV_FILE"
akl_assert_expected_env_snapshot "$ENV_FILE"
akl_assert_no_ambient_env_file_overrides "$ENV_FILE"
akl_assert_local_docker_daemon_environment
POSTGRES_TOOL_IMAGE_REF="$(akl_env_value "$ENV_FILE" AKL_RELEASE_POSTGRES_TOOL_IMAGE)"
[[ -n "$POSTGRES_TOOL_IMAGE_REF" ]] \
  || akl_fail "AKL_RELEASE_POSTGRES_TOOL_IMAGE is missing"
[[ "$EXPECTED_POSTGRES_TOOL_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || akl_fail "Writable-primary gate requires the expected exact PostgreSQL tool image ID"
resolved_postgres_tool_image_id="$(akl_resolve_local_exact_image_id "$POSTGRES_TOOL_IMAGE_REF")"
[[ "$resolved_postgres_tool_image_id" == "$EXPECTED_POSTGRES_TOOL_IMAGE_ID" ]] \
  || akl_fail "PostgreSQL tool image identity changed before the writable-primary gate"

database_url="$(akl_env_value "$ENV_FILE" AKL_REGISTRY_DATABASE_URL)"
[[ -n "$database_url" ]] || akl_fail "AKL_REGISTRY_DATABASE_URL is missing"
database_url="${database_url/postgresql+psycopg:\/\//postgresql:\/\/}"

umask 077
credentials_purpose="primary-${PHASE}"
credentials_dir="$(
  akl_postgres_credentials_dir_path \
    "$RELEASE_ROOT" "$DEPLOYMENT_ID" "$credentials_purpose"
)"
cleanup() {
  local status=$?
  local cleanup_status=0
  trap - EXIT
  if [[ -n "${credentials_dir:-}" \
    && ( -e "$credentials_dir" || -L "$credentials_dir" ) ]]; then
    akl_cleanup_private_postgres_credentials_dir \
      "$RELEASE_ROOT" "$credentials_dir" || cleanup_status=1
  fi
  if [[ "$cleanup_status" -ne 0 ]]; then
    printf 'CRITICAL: Private PostgreSQL credential cleanup failed.\n' >&2
    status=1
  fi
  exit "$status"
}
trap cleanup EXIT
akl_create_private_postgres_credentials_dir \
  "$RELEASE_ROOT" "$DEPLOYMENT_ID" "$credentials_purpose"

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

with open(sys.argv[1], "x", encoding="utf-8") as handle:
    handle.write(
        ":".join(
            pgpass_escape(value)
            for value in (host, str(port), database, username, password)
        )
        + "\n"
    )
os.chmod(sys.argv[1], 0o600)
with open(sys.argv[2], "x", encoding="utf-8") as handle:
    handle.write(
        f"database_host={host}\n"
        f"database_port={port}\n"
        f"database_name={database}\n"
        f"database_user={username}\n"
    )
os.chmod(sys.argv[2], 0o600)
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
[[ "$pgpass_file" != *,* && "$pgpass_file" != *$'\n'* && "$pgpass_file" != *$'\r'* ]] \
  || akl_fail "PostgreSQL credential bind path contains an unsupported character"

for attempt in 1 2 3; do
  primary_state="$(
    PGHOST="$database_host" \
    PGPORT="$database_port" \
    PGDATABASE="$database_name" \
    PGUSER="$database_user" \
    PGAPPNAME="akl-release-writable-primary-${PHASE}" \
    PGCONNECT_TIMEOUT=5 \
      docker run \
        --rm \
        --pull never \
        --network host \
        --read-only \
        --cap-drop ALL \
        --security-opt no-new-privileges \
        --user "$(id -u):$(id -g)" \
        --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m \
        --env PGHOST \
        --env PGPORT \
        --env PGDATABASE \
        --env PGUSER \
        --env PGAPPNAME \
        --env PGCONNECT_TIMEOUT \
        --env PGPASSFILE=/run/secrets/akl-pgpass \
        --mount "type=bind,src=${pgpass_file},dst=/run/secrets/akl-pgpass,readonly" \
        "$POSTGRES_TOOL_IMAGE_REF" \
        psql \
          --no-psqlrc \
          --tuples-only \
          --no-align \
          --field-separator='|' \
          --set=ON_ERROR_STOP=1 \
          --command="SELECT current_setting('transaction_read_only'), pg_is_in_recovery(), current_database(), current_user, COALESCE(inet_server_addr()::text, ''), COALESCE(inet_server_port()::text, '')"
  )" || akl_fail "Writable-primary PostgreSQL check ${attempt}/3 failed during ${PHASE}"
  primary_state="$(printf '%s' "$primary_state" | tr -d '\r\n')"
  [[ "$(awk -F'|' '{print NF}' <<<"$primary_state")" -eq 6 ]] \
    || akl_fail "Registry database returned a malformed identity response during ${PHASE} check ${attempt}/3"
  IFS='|' read -r transaction_read_only in_recovery actual_database_name actual_database_user backend_address backend_port \
    <<<"$primary_state"
  [[ "$transaction_read_only" == "off" && "$in_recovery" == "f" ]] \
    || akl_fail "Registry database is not a writable primary during ${PHASE} check ${attempt}/3"
  [[ "$actual_database_name" == "$expected_database_name" \
    && "$actual_database_user" == "$expected_database_user" ]] \
    || akl_fail "Registry database backend identity does not match the expected database and user during ${PHASE} check ${attempt}/3"
  [[ -z "$backend_address" || "$backend_address" =~ ^[0-9A-Fa-f:.]+$ ]] \
    || akl_fail "Registry database returned an invalid backend address during ${PHASE} check ${attempt}/3"
  [[ -z "$backend_port" || ( "$backend_port" =~ ^[1-9][0-9]*$ && "$backend_port" -le 65535 ) ]] \
    || akl_fail "Registry database returned an invalid backend port during ${PHASE} check ${attempt}/3"
  printf 'Writable-primary PostgreSQL check %s/3 passed during %s.\n' "$attempt" "$PHASE" >&2
done
