#!/usr/bin/env bash
set -euo pipefail

KEYCLOAK_CONTAINER="${KEYCLOAK_CONTAINER:-keycloak}"
KEYCLOAK_INTERNAL_URL="${KEYCLOAK_INTERNAL_URL:-http://127.0.0.1:8081}"
KEYCLOAK_ADMIN_USER="${KEYCLOAK_ADMIN_USER:-admin}"
REALM="${REALM:-stratos}"

fail() {
  printf "ERROR: %s\n" "$1" >&2
  exit 1
}

docker inspect "$KEYCLOAK_CONTAINER" >/dev/null 2>&1 || fail "Keycloak container not found: $KEYCLOAK_CONTAINER"

printf "Keycloak container: %s\n" "$KEYCLOAK_CONTAINER"
printf "Keycloak URL:       %s\n" "$KEYCLOAK_INTERNAL_URL"
printf "Admin user:         %s\n" "$KEYCLOAK_ADMIN_USER"
printf "Realm:              %s\n" "$REALM"
printf "\n"
read -rsp "Keycloak admin password: " KEYCLOAK_ADMIN_PASSWORD
printf "\n"

if [[ -z "$KEYCLOAK_ADMIN_PASSWORD" ]]; then
  fail "Password cannot be empty."
fi

docker exec -i \
  -e KEYCLOAK_INTERNAL_URL="$KEYCLOAK_INTERNAL_URL" \
  -e KEYCLOAK_ADMIN_USER="$KEYCLOAK_ADMIN_USER" \
  -e KEYCLOAK_ADMIN_PASSWORD="$KEYCLOAK_ADMIN_PASSWORD" \
  -e REALM="$REALM" \
  "$KEYCLOAK_CONTAINER" sh -s <<"IN_CONTAINER"
set -euo pipefail

/opt/keycloak/bin/kcadm.sh config credentials \
  --server "$KEYCLOAK_INTERNAL_URL" \
  --realm master \
  --user "$KEYCLOAK_ADMIN_USER" \
  --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null

update_client() {
  client_id="$1"
  redirect_uris_json="$2"
  web_origins_json="$3"

  id="$(/opt/keycloak/bin/kcadm.sh get clients -r "$REALM" -q clientId="$client_id" --fields id --format csv | tail -n +2 | tr -d '"' | head -n 1)"
  if [ -z "$id" ]; then
    echo "ERROR: client not found: $client_id" >&2
    exit 1
  fi

  /opt/keycloak/bin/kcadm.sh update "clients/$id" -r "$REALM" \
    -s "redirectUris=$redirect_uris_json" \
    -s "webOrigins=$web_origins_json" >/dev/null
  echo "updated $client_id"
}

update_client "akl-web" \
  '["https://stratos.zeleznalady.cz/akb/*","https://akl.zeleznalady.cz/*","https://docker.home.cz/*","http://localhost:3000/*","http://localhost:3002/*","http://localhost:3003/*"]' \
  '["https://stratos.zeleznalady.cz","https://akl.zeleznalady.cz","https://docker.home.cz","+"]'

update_client "budget-web" \
  '["https://stratos.zeleznalady.cz/*","https://budget.zeleznalady.cz/*","https://contracts.zeleznalady.cz/*","https://docker.home.cz/*","http://localhost:3004/*"]' \
  '["https://stratos.zeleznalady.cz","https://budget.zeleznalady.cz","https://contracts.zeleznalady.cz","https://docker.home.cz","+"]'

update_client "projectflow-web" \
  '["https://stratos.zeleznalady.cz/project/*","https://projectflow.zeleznalady.cz/*","https://docker.home.cz/*","http://localhost:3005/*"]' \
  '["https://stratos.zeleznalady.cz","https://projectflow.zeleznalady.cz","https://docker.home.cz","+"]'

update_client "archflow-web" \
  '["https://stratos.zeleznalady.cz/arch/*","https://archflow.zeleznalady.cz/*","https://docker.home.cz/*","http://localhost:3006/*"]' \
  '["https://stratos.zeleznalady.cz","https://archflow.zeleznalady.cz","https://docker.home.cz","+"]'

update_client "stratos-shell" \
  '["https://stratos.zeleznalady.cz/*","https://docker.home.cz/*","http://localhost:3001/*"]' \
  '["https://stratos.zeleznalady.cz","https://docker.home.cz","+"]'

echo
/opt/keycloak/bin/kcadm.sh get clients -r "$REALM" --fields clientId,redirectUris,webOrigins --format json
IN_CONTAINER

unset KEYCLOAK_ADMIN_PASSWORD
printf "\nSTRATOS public routing clients updated.\n"
