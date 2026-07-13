#!/usr/bin/env bash
set -euo pipefail

KEYCLOAK_CONTAINER="${KEYCLOAK_CONTAINER:-keycloak}"
KEYCLOAK_URL="${KEYCLOAK_URL:-http://127.0.0.1:8081}"
KEYCLOAK_ADMIN_USER="${KEYCLOAK_ADMIN_USER:-admin}"
KEYCLOAK_ADMIN_REALM="${KEYCLOAK_ADMIN_REALM:-master}"
KEYCLOAK_USE_BOOTSTRAP_ADMIN_SERVICE="${KEYCLOAK_USE_BOOTSTRAP_ADMIN_SERVICE:-false}"
KEYCLOAK_BOOTSTRAP_MANAGEMENT_PORT="${KEYCLOAK_BOOTSTRAP_MANAGEMENT_PORT:-19000}"
STRATOS_REALM="${STRATOS_REALM:-stratos}"
AIIP_CLIENT_ID="${AIIP_CLIENT_ID:-aiip-service}"
AIIP_ROLE="${AIIP_ROLE:-service_aiip}"
AIIP_AUDIENCE="${AIIP_AUDIENCE:-akb-api}"
AIIP_SECRET_FILE="${AIIP_SECRET_FILE:-/srv/akl/env/aiip-service.client-secret}"
SERVICE_CLIENT_NAME="${SERVICE_CLIENT_NAME:-AIIP to AKB Application API}"
SERVICE_ROLE_DESCRIPTION="${SERVICE_ROLE_DESCRIPTION:-AKB application service role for AI Innovation Portal.}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

docker inspect "$KEYCLOAK_CONTAINER" >/dev/null 2>&1 || fail "Keycloak container not found: $KEYCLOAK_CONTAINER"

AUTH_MODE="password"
BOOTSTRAP_CLIENT_ID=""
BOOTSTRAP_CLIENT_SECRET=""
if [ -z "${KEYCLOAK_ADMIN_PASSWORD:-}" ] && [ "$KEYCLOAK_USE_BOOTSTRAP_ADMIN_SERVICE" = "true" ]; then
  AUTH_MODE="bootstrap-service"
  BOOTSTRAP_CLIENT_ID="akb-service-bootstrap-$(date +%s)"
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

tmp_secret="$(mktemp)"
trap 'rm -f "$tmp_secret"; unset KEYCLOAK_ADMIN_PASSWORD BOOTSTRAP_CLIENT_SECRET' EXIT

if [ "$AUTH_MODE" = "bootstrap-service" ]; then
  docker exec -i "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh config credentials \
    --server "$KEYCLOAK_URL" \
    --realm master \
    --client "$BOOTSTRAP_CLIENT_ID" \
    --secret "$BOOTSTRAP_CLIENT_SECRET" >/dev/null
else
  docker exec -i "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh config credentials \
    --server "$KEYCLOAK_URL" \
    --realm "$KEYCLOAK_ADMIN_REALM" \
    --user "$KEYCLOAK_ADMIN_USER" \
    --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null
fi

if ! docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh get "realms/$STRATOS_REALM" >/dev/null 2>&1; then
  fail "Realm does not exist or the administrator cannot access it: $STRATOS_REALM"
fi

if ! docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh get "roles/$AIIP_ROLE" -r "$STRATOS_REALM" >/dev/null 2>&1; then
  docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh create roles -r "$STRATOS_REALM" \
    -s "name=$AIIP_ROLE" \
    -s "description=$SERVICE_ROLE_DESCRIPTION" >/dev/null
fi

client_uuid="$(
  docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh get clients \
    -r "$STRATOS_REALM" -q "clientId=$AIIP_CLIENT_ID" --fields id,clientId --format json \
    | python3 -c 'import json,sys; rows=json.load(sys.stdin); print(rows[0]["id"] if rows else "")'
)"

if [ -z "$client_uuid" ]; then
  docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh create clients -r "$STRATOS_REALM" \
    -s "clientId=$AIIP_CLIENT_ID" \
    -s "name=$SERVICE_CLIENT_NAME" \
    -s enabled=true \
    -s protocol=openid-connect \
    -s publicClient=false \
    -s serviceAccountsEnabled=true \
    -s standardFlowEnabled=false \
    -s directAccessGrantsEnabled=false \
    -s implicitFlowEnabled=false \
    -s 'clientAuthenticatorType=client-secret' >/dev/null
  client_uuid="$(
    docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh get clients \
      -r "$STRATOS_REALM" -q "clientId=$AIIP_CLIENT_ID" --fields id,clientId --format json \
      | python3 -c 'import json,sys; rows=json.load(sys.stdin); print(rows[0]["id"] if rows else "")'
  )"
else
  docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh update "clients/$client_uuid" -r "$STRATOS_REALM" \
    -s "name=$SERVICE_CLIENT_NAME" \
    -s enabled=true \
    -s publicClient=false \
    -s serviceAccountsEnabled=true \
    -s standardFlowEnabled=false \
    -s directAccessGrantsEnabled=false \
    -s implicitFlowEnabled=false \
    -s 'clientAuthenticatorType=client-secret' >/dev/null
fi

[ -n "$client_uuid" ] || fail "Could not resolve Keycloak client UUID for $AIIP_CLIENT_ID"

docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh add-roles \
  -r "$STRATOS_REALM" \
  --uusername "service-account-$AIIP_CLIENT_ID" \
  --rolename "$AIIP_ROLE" >/dev/null

mapper_id="$(
  docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh get \
    "clients/$client_uuid/protocol-mappers/models" -r "$STRATOS_REALM" --format json \
    | python3 -c 'import json,sys; rows=json.load(sys.stdin); print(next((row["id"] for row in rows if row.get("name") == "akb-api audience"), ""))'
)"
if [ -n "$mapper_id" ]; then
  docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh delete \
    "clients/$client_uuid/protocol-mappers/models/$mapper_id" -r "$STRATOS_REALM" >/dev/null
fi

python3 - "$AIIP_AUDIENCE" <<'PY' \
  | docker exec -i "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh create \
      "clients/$client_uuid/protocol-mappers/models" -r "$STRATOS_REALM" -f - >/dev/null
import json
import sys

json.dump(
    {
        "name": "akb-api audience",
        "protocol": "openid-connect",
        "protocolMapper": "oidc-audience-mapper",
        "consentRequired": False,
        "config": {
            "included.custom.audience": sys.argv[1],
            "id.token.claim": "false",
            "access.token.claim": "true",
            "introspection.token.claim": "true",
        },
    },
    sys.stdout,
)
PY

docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh get \
  "clients/$client_uuid/client-secret" -r "$STRATOS_REALM" --format json \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("value", ""))' >"$tmp_secret"

[ -s "$tmp_secret" ] || fail "Keycloak did not return a client secret"
install -d -m 700 "$(dirname "$AIIP_SECRET_FILE")"
install -m 600 "$tmp_secret" "$AIIP_SECRET_FILE"

if [ "$AUTH_MODE" = "bootstrap-service" ]; then
  bootstrap_uuid="$(
    docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh get clients \
      -r master -q "clientId=$BOOTSTRAP_CLIENT_ID" --fields id,clientId --format json \
      | python3 -c 'import json,sys; rows=json.load(sys.stdin); print(rows[0]["id"] if rows else "")'
  )"
  if [ -n "$bootstrap_uuid" ]; then
    docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh delete \
      "clients/$bootstrap_uuid" -r master >/dev/null || true
  fi
fi

printf 'Keycloak client %s is ready in realm %s.\n' "$AIIP_CLIENT_ID" "$STRATOS_REALM"
printf 'Role=%s audience=%s; secret stored with mode 0600 in %s.\n' "$AIIP_ROLE" "$AIIP_AUDIENCE" "$AIIP_SECRET_FILE"
