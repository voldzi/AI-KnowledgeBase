#!/usr/bin/env bash
set -euo pipefail

KEYCLOAK_CONTAINER="${KEYCLOAK_CONTAINER:-keycloak}"
KEYCLOAK_INTERNAL_URL="${KEYCLOAK_INTERNAL_URL:-http://127.0.0.1:8081}"
KEYCLOAK_ADMIN_USER="${KEYCLOAK_ADMIN_USER:-admin}"
REALM="${KEYCLOAK_REALM:-stratos}"
GRAFANA_CLIENT_ID="${GRAFANA_OAUTH_CLIENT_ID:-akb-grafana}"
GRAFANA_ROOT_URL="${GRAFANA_ROOT_URL:-https://stratos.zeleznalady.cz/akb/grafana/}"
AKL_PROD_ENV_FILE="${AKL_PROD_ENV_FILE:-/srv/akl/env/akl.prod.env}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

docker inspect "$KEYCLOAK_CONTAINER" >/dev/null 2>&1 || fail "Keycloak container not found: $KEYCLOAK_CONTAINER"

if [ -z "${KEYCLOAK_ADMIN_PASSWORD:-}" ]; then
  read -rsp "Keycloak admin password: " KEYCLOAK_ADMIN_PASSWORD
  printf '\n'
fi

[[ -n "$KEYCLOAK_ADMIN_PASSWORD" ]] || fail "Keycloak admin password is required"

tmp_secret="$(mktemp)"
trap 'rm -f "$tmp_secret"; unset KEYCLOAK_ADMIN_PASSWORD CLIENT_SECRET' EXIT

docker exec \
  -e KEYCLOAK_INTERNAL_URL="$KEYCLOAK_INTERNAL_URL" \
  -e KEYCLOAK_ADMIN_USER="$KEYCLOAK_ADMIN_USER" \
  -e KEYCLOAK_ADMIN_PASSWORD="$KEYCLOAK_ADMIN_PASSWORD" \
  -e REALM="$REALM" \
  -e GRAFANA_CLIENT_ID="$GRAFANA_CLIENT_ID" \
  -e GRAFANA_ROOT_URL="$GRAFANA_ROOT_URL" \
  "$KEYCLOAK_CONTAINER" sh -s <<'IN_CONTAINER' >"$tmp_secret"
set -eu

KCADM=/opt/keycloak/bin/kcadm.sh
ROOT_URL="${GRAFANA_ROOT_URL%/}"
REDIRECT_URI="$ROOT_URL/login/generic_oauth"
WEB_ORIGIN="$(printf '%s\n' "$ROOT_URL" | sed -E 's#^(https?://[^/]+).*#\1#')"

"$KCADM" config credentials \
  --server "$KEYCLOAK_INTERNAL_URL" \
  --realm master \
  --user "$KEYCLOAK_ADMIN_USER" \
  --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null

if ! "$KCADM" get "realms/$REALM" >/dev/null 2>&1; then
  echo "Realm $REALM does not exist." >&2
  exit 2
fi

client_uuid="$("$KCADM" get clients -r "$REALM" -q "clientId=$GRAFANA_CLIENT_ID" --fields id --format csv --noquotes | tail -n +2 | head -n 1)"

if [ -z "$client_uuid" ]; then
  "$KCADM" create clients -r "$REALM" \
    -s "clientId=$GRAFANA_CLIENT_ID" \
    -s 'name=AKB Grafana' \
    -s enabled=true \
    -s protocol=openid-connect \
    -s publicClient=false \
    -s serviceAccountsEnabled=false \
    -s standardFlowEnabled=true \
    -s directAccessGrantsEnabled=false \
    -s implicitFlowEnabled=false \
    -s 'clientAuthenticatorType=client-secret' \
    -s "rootUrl=$ROOT_URL" \
    -s 'baseUrl=/' \
    -s "redirectUris=[\"$REDIRECT_URI\"]" \
    -s "webOrigins=[\"$WEB_ORIGIN\"]" >/dev/null
  client_uuid="$("$KCADM" get clients -r "$REALM" -q "clientId=$GRAFANA_CLIENT_ID" --fields id --format csv --noquotes | tail -n +2 | head -n 1)"
else
  "$KCADM" update "clients/$client_uuid" -r "$REALM" \
    -s 'name=AKB Grafana' \
    -s enabled=true \
    -s protocol=openid-connect \
    -s publicClient=false \
    -s serviceAccountsEnabled=false \
    -s standardFlowEnabled=true \
    -s directAccessGrantsEnabled=false \
    -s implicitFlowEnabled=false \
    -s 'clientAuthenticatorType=client-secret' \
    -s "rootUrl=$ROOT_URL" \
    -s 'baseUrl=/' \
    -s "redirectUris=[\"$REDIRECT_URI\"]" \
    -s "webOrigins=[\"$WEB_ORIGIN\"]" >/dev/null
fi

"$KCADM" get "clients/$client_uuid/client-secret" -r "$REALM" --fields value --format csv --noquotes | tail -n +2 | head -n 1
IN_CONTAINER

CLIENT_SECRET="$(tr -d '\r\n' <"$tmp_secret")"
[[ -n "$CLIENT_SECRET" ]] || fail "Keycloak did not return a Grafana client secret."

python3 - "$AKL_PROD_ENV_FILE" "$GRAFANA_CLIENT_ID" "$CLIENT_SECRET" "$GRAFANA_ROOT_URL" <<'PY'
from pathlib import Path
import sys

env_path = Path(sys.argv[1])
client_id = sys.argv[2]
client_secret = sys.argv[3]
root_url = sys.argv[4]
issuer = "https://login.zeleznalady.cz/realms/stratos"

text = env_path.read_text() if env_path.exists() else ""
updates = {
    "GRAFANA_OAUTH_ENABLED": "true",
    "GRAFANA_OAUTH_CLIENT_ID": client_id,
    "GRAFANA_OAUTH_CLIENT_SECRET": client_secret,
    "GRAFANA_OAUTH_AUTH_URL": f"{issuer}/protocol/openid-connect/auth",
    "GRAFANA_OAUTH_TOKEN_URL": f"{issuer}/protocol/openid-connect/token",
    "GRAFANA_OAUTH_API_URL": f"{issuer}/protocol/openid-connect/userinfo",
    "GRAFANA_ROOT_URL": root_url,
}

lines = []
seen = set()
for line in text.splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        key = line.split("=", 1)[0]
        if key in updates:
            lines.append(f"{key}={updates[key]}")
            seen.add(key)
            continue
    lines.append(line)

for key, value in updates.items():
    if key not in seen:
        lines.append(f"{key}={value}")

env_path.write_text("\n".join(lines) + "\n")
PY

printf 'Grafana Keycloak client %s is ready in realm %s.\n' "$GRAFANA_CLIENT_ID" "$REALM"
printf 'Updated %s with GRAFANA_OAUTH_ENABLED=true and the client secret.\n' "$AKL_PROD_ENV_FILE"
