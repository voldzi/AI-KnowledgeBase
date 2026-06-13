#!/usr/bin/env bash
set -euo pipefail

KEYCLOAK_CONTAINER="${KEYCLOAK_CONTAINER:-keycloak}"
KEYCLOAK_INTERNAL_URL="${KEYCLOAK_INTERNAL_URL:-http://127.0.0.1:8081}"
KEYCLOAK_ADMIN_USER="${KEYCLOAK_ADMIN_USER:-admin}"
KEYCLOAK_USE_BOOTSTRAP_ADMIN_SERVICE="${KEYCLOAK_USE_BOOTSTRAP_ADMIN_SERVICE:-false}"
KEYCLOAK_BOOTSTRAP_MANAGEMENT_PORT="${KEYCLOAK_BOOTSTRAP_MANAGEMENT_PORT:-19000}"
REALM="${KEYCLOAK_REALM:-stratos}"
GRAFANA_CLIENT_ID="${GRAFANA_OAUTH_CLIENT_ID:-akb-grafana}"
GRAFANA_ROOT_URL="${GRAFANA_ROOT_URL:-https://stratos.zeleznalady.cz/akb/grafana/}"
AKL_PROD_ENV_FILE="${AKL_PROD_ENV_FILE:-/srv/akl/env/akl.prod.env}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

docker inspect "$KEYCLOAK_CONTAINER" >/dev/null 2>&1 || fail "Keycloak container not found: $KEYCLOAK_CONTAINER"

BOOTSTRAP_CLIENT_ID=""
BOOTSTRAP_CLIENT_SECRET=""
AUTH_MODE="password"

if [ -z "${KEYCLOAK_ADMIN_PASSWORD:-}" ] && [ "$KEYCLOAK_USE_BOOTSTRAP_ADMIN_SERVICE" = "true" ]; then
  AUTH_MODE="bootstrap-service"
  BOOTSTRAP_CLIENT_ID="akb-grafana-bootstrap-$(date +%s)"
  BOOTSTRAP_CLIENT_SECRET="$(openssl rand -hex 32)"
  docker exec \
    -e BOOTSTRAP_CLIENT_ID="$BOOTSTRAP_CLIENT_ID" \
    -e BOOTSTRAP_CLIENT_SECRET="$BOOTSTRAP_CLIENT_SECRET" \
    "$KEYCLOAK_CONTAINER" sh -c \
    '/opt/keycloak/bin/kc.sh bootstrap-admin service --client-id "$BOOTSTRAP_CLIENT_ID" --client-secret:env BOOTSTRAP_CLIENT_SECRET --no-prompt --http-management-port "'"$KEYCLOAK_BOOTSTRAP_MANAGEMENT_PORT"'" >/dev/null'
elif [ -z "${KEYCLOAK_ADMIN_PASSWORD:-}" ]; then
  read -rsp "Keycloak admin password: " KEYCLOAK_ADMIN_PASSWORD
  printf '\n'
fi

if [ "$AUTH_MODE" = "password" ]; then
  [[ -n "$KEYCLOAK_ADMIN_PASSWORD" ]] || fail "Keycloak admin password is required"
fi

tmp_secret="$(mktemp)"
trap 'rm -f "$tmp_secret"; unset KEYCLOAK_ADMIN_PASSWORD CLIENT_SECRET BOOTSTRAP_CLIENT_SECRET' EXIT

docker exec \
  -e KEYCLOAK_INTERNAL_URL="$KEYCLOAK_INTERNAL_URL" \
  -e KEYCLOAK_ADMIN_USER="$KEYCLOAK_ADMIN_USER" \
  -e KEYCLOAK_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-}" \
  -e AUTH_MODE="$AUTH_MODE" \
  -e BOOTSTRAP_CLIENT_ID="$BOOTSTRAP_CLIENT_ID" \
  -e BOOTSTRAP_CLIENT_SECRET="$BOOTSTRAP_CLIENT_SECRET" \
  -e REALM="$REALM" \
  -e GRAFANA_CLIENT_ID="$GRAFANA_CLIENT_ID" \
  -e GRAFANA_ROOT_URL="$GRAFANA_ROOT_URL" \
  "$KEYCLOAK_CONTAINER" sh -s <<'IN_CONTAINER' >"$tmp_secret"
set -eu

KCADM=/opt/keycloak/bin/kcadm.sh
ROOT_URL="${GRAFANA_ROOT_URL%/}"
REDIRECT_URI="$ROOT_URL/login/generic_oauth"
WEB_ORIGIN="$(printf '%s\n' "$ROOT_URL" | sed -E 's#^(https?://[^/]+).*#\1#')"

find_client_uuid() {
  realm="$1"
  client_id="$2"
  "$KCADM" get clients -r "$realm" --fields id,clientId --format json \
    | sed -n "N;s/.*\"id\" : \"\\([^\"]*\\)\".*\\n.*\"clientId\" : \"$client_id\".*/\\1/p" \
    | head -n 1
}

if [ "$AUTH_MODE" = "bootstrap-service" ]; then
  "$KCADM" config credentials \
    --server "$KEYCLOAK_INTERNAL_URL" \
    --realm master \
    --client "$BOOTSTRAP_CLIENT_ID" \
    --secret "$BOOTSTRAP_CLIENT_SECRET" >/dev/null
else
  "$KCADM" config credentials \
    --server "$KEYCLOAK_INTERNAL_URL" \
    --realm master \
    --user "$KEYCLOAK_ADMIN_USER" \
    --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null
fi

if ! "$KCADM" get "realms/$REALM" >/dev/null 2>&1; then
  echo "Realm $REALM does not exist." >&2
  exit 2
fi

client_uuid="$(find_client_uuid "$REALM" "$GRAFANA_CLIENT_ID")"

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
  client_uuid="$(find_client_uuid "$REALM" "$GRAFANA_CLIENT_ID")"
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

"$KCADM" get "clients/$client_uuid/client-secret" -r "$REALM" --format json \
  | sed -n 's/.*"value" : "\([^"]*\)".*/\1/p'

if [ "$AUTH_MODE" = "bootstrap-service" ]; then
  bootstrap_uuid="$(find_client_uuid master "$BOOTSTRAP_CLIENT_ID")"
  if [ -n "$bootstrap_uuid" ]; then
    "$KCADM" delete "clients/$bootstrap_uuid" -r master >/dev/null || true
  fi
fi
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
