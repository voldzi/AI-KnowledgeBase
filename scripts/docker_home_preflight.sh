#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${AKL_PROD_ENV_FILE:-/srv/akl/env/akl.prod.env}"
NPMRC_FILE="${AKL_NPMRC_SECRET_FILE:-/srv/akl/secrets/npmrc}"
COMPOSE_FILE="${ROOT_DIR}/infra/docker-compose/docker-compose.docker-home.yml"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

require_file() {
  local path="$1"
  local label="$2"
  [[ -f "$path" ]] || fail "$label not found: $path"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

printf 'AKL docker.home.cz preflight\n'
printf 'Repo: %s\n' "$ROOT_DIR"
printf 'Env:  %s\n' "$ENV_FILE"

require_cmd docker
require_cmd curl
require_file "$ENV_FILE" "Production env file"
require_file "$NPMRC_FILE" "GitHub Packages npmrc secret"

if grep -E 'replace-with|<user>|<password>|long-random|prod-password' "$ENV_FILE" >/dev/null; then
  fail "Production env file still contains placeholder values."
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${AKL_REGISTRY_DATABASE_URL:?AKL_REGISTRY_DATABASE_URL must be set}"
: "${AKL_OIDC_ISSUER:?AKL_OIDC_ISSUER must be set}"
: "${AKL_OIDC_JWKS_URL:?AKL_OIDC_JWKS_URL must be set}"
: "${AKL_WEB_OIDC_ISSUER:?AKL_WEB_OIDC_ISSUER must be set}"
: "${AKL_WEB_PUBLIC_BASE_URL:?AKL_WEB_PUBLIC_BASE_URL must be set}"
: "${AKL_WEB_SESSION_SECRET:?AKL_WEB_SESSION_SECRET must be set}"
: "${AKL_WEB_UPLOAD_SIGNING_SECRET:?AKL_WEB_UPLOAD_SIGNING_SECRET must be set}"

printf 'Checking docker compose render...\n'
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/tmp/akl-docker-home-preflight.yml

printf 'Checking PostgreSQL HAProxy TCP endpoint...\n'
python - <<'PY'
import socket
host = "haproxy.home.cz"
port = 5000
with socket.create_connection((host, port), timeout=5):
    pass
print(f"ok: {host}:{port}")
PY

printf 'Checking OIDC discovery and JWKS...\n'
curl -fsS "${AKL_OIDC_ISSUER%/}/.well-known/openid-configuration" >/dev/null
curl -fsS "$AKL_OIDC_JWKS_URL" >/dev/null

printf 'Checking AKL SeaweedFS filesystem bridge directory...\n'
mkdir -p "${AKL_SEAWEEDFS_AKL_ROOT:-/srv/seaweedfs/akl}"
test -w "${AKL_SEAWEEDFS_AKL_ROOT:-/srv/seaweedfs/akl}" || fail "AKL SeaweedFS root is not writable."

printf 'Preflight passed.\n'
