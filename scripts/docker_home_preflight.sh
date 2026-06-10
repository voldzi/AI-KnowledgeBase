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
require_cmd python3
require_file "$ENV_FILE" "Production env file"
require_file "$NPMRC_FILE" "GitHub Packages npmrc secret"

if grep -E 'replace-with|<user>|<password>|long-random|prod-password' "$ENV_FILE" >/dev/null; then
  fail "Production env file still contains placeholder values."
fi

eval "$(
  ENV_FILE="$ENV_FILE" python3 - <<'PY'
import os
import shlex
from pathlib import Path

for raw_line in Path(os.environ["ENV_FILE"]).read_text().splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    key = key.strip()
    if not key.replace("_", "").isalnum() or key[0].isdigit():
        continue
    print(f"export {key}={shlex.quote(value.strip().strip(chr(34)).strip(chr(39)))}")
PY
)"

: "${AKL_REGISTRY_DATABASE_URL:?AKL_REGISTRY_DATABASE_URL must be set}"
: "${AKL_OIDC_ISSUER:?AKL_OIDC_ISSUER must be set}"
: "${AKL_OIDC_JWKS_URL:?AKL_OIDC_JWKS_URL must be set}"
: "${AKL_WEB_OIDC_ISSUER:?AKL_WEB_OIDC_ISSUER must be set}"
: "${AKL_WEB_PUBLIC_BASE_URL:?AKL_WEB_PUBLIC_BASE_URL must be set}"
: "${AKL_WEB_SESSION_SECRET:?AKL_WEB_SESSION_SECRET must be set}"
: "${AKL_WEB_UPLOAD_SIGNING_SECRET:?AKL_WEB_UPLOAD_SIGNING_SECRET must be set}"
: "${AKL_EVAL_SERVICE_TOKEN:?AKL_EVAL_SERVICE_TOKEN must be set}"
: "${AKL_GOVERNANCE_SERVICE_TOKEN:?AKL_GOVERNANCE_SERVICE_TOKEN must be set}"

printf 'Checking docker compose render...\n'
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/tmp/akl-docker-home-preflight.yml

printf 'Checking AKL Docker bridge subnet reservations...\n'
python3 - <<'PY'
import ipaddress
import re
import subprocess
from pathlib import Path

rendered = Path("/tmp/akl-docker-home-preflight.yml").read_text()
reserved_site_networks = [
    ipaddress.ip_network("192.168.1.0/24"),
    ipaddress.ip_network("192.168.10.0/24"),
    ipaddress.ip_network("192.168.100.0/24"),
]
current_network_name = ""

docker_networks = subprocess.check_output(
    [
        "docker",
        "network",
        "inspect",
        *subprocess.check_output(["docker", "network", "ls", "-q"], text=True).splitlines(),
    ],
    text=True,
)
for line in docker_networks.splitlines():
    name_match = re.search(r'"Name":\s*"([^"]+)"', line)
    if name_match:
        current_network_name = name_match.group(1)
        continue
    subnet_match = re.search(r'"Subnet":\s*"([^"]+)"', line)
    if subnet_match and not current_network_name.startswith("akl_"):
        reserved_site_networks.append(ipaddress.ip_network(subnet_match.group(1), strict=False))

subnets = []
for match in re.finditer(r"^\s*-?\s*subnet:\s+([^\s#]+)\s*$", rendered, re.MULTILINE):
    subnets.append(ipaddress.ip_network(match.group(1), strict=False))

if not subnets:
    raise SystemExit("No AKL Docker network subnets found in rendered compose config.")

for subnet in subnets:
    for reserved in reserved_site_networks:
        if subnet.overlaps(reserved):
            raise SystemExit(f"AKL Docker subnet {subnet} overlaps reserved site VLAN {reserved}.")

print("ok: " + ", ".join(str(subnet) for subnet in subnets))
PY

printf 'Checking PostgreSQL HAProxy TCP endpoint...\n'
python3 - <<'PY'
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
