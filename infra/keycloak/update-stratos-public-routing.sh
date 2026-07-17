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


strip_quotes() {
  value="$1"
  case "$value" in
    \"*) value="${value#?}" ;;
  esac
  case "$value" in
    *\") value="${value%?}" ;;
  esac
  printf "%s" "$value"
}

update_client() {
  client_id="$1"
  redirect_uris_json="$2"
  web_origins_json="$3"

  id=""
  while IFS=, read -r raw_id raw_client_id; do
    raw_id=$(strip_quotes "$raw_id")
    raw_client_id=$(strip_quotes "$raw_client_id")
    if [ "$raw_client_id" = "$client_id" ]; then
      id="$raw_id"
      break
    fi
  done <<CLIENTS
$(/opt/keycloak/bin/kcadm.sh get clients -r "$REALM" -q clientId="$client_id" --fields id,clientId --format csv)
CLIENTS
  if [ -z "$id" ]; then
    echo "ERROR: client not found: $client_id" >&2
    exit 1
  fi

  /opt/keycloak/bin/kcadm.sh update "clients/$id" -r "$REALM" \
    -s "redirectUris=$redirect_uris_json" \
    -s "webOrigins=$web_origins_json" >/dev/null
  if [ "$client_id" = "akb-chat-web" ]; then
    /opt/keycloak/bin/kcadm.sh update "clients/$id" -r "$REALM" \
      -s 'attributes."post.logout.redirect.uris"=https://chat.zeleznalady.cz/*##http://localhost:3010/*' \
      -s 'attributes."pkce.code.challenge.method"=S256' >/dev/null
  fi
  echo "updated $client_id"
}

ensure_akb_chat_client() {
  id=$(
    /opt/keycloak/bin/kcadm.sh get clients -r "$REALM" \
      -q clientId=akb-chat-web --fields id --format csv \
      | tail -n 1 \
      | tr -d '"\r'
  )
  if [ -n "$id" ] && [ "$id" != "id" ]; then
    return
  fi

  id=$(
    /opt/keycloak/bin/kcadm.sh create clients -r "$REALM" \
      -s clientId=akb-chat-web \
      -s 'name=AKB Standalone Chat PWA' \
      -s enabled=true \
      -s protocol=openid-connect \
      -s publicClient=true \
      -s standardFlowEnabled=true \
      -s directAccessGrantsEnabled=false \
      -s serviceAccountsEnabled=false \
      -i
  )
  /opt/keycloak/bin/kcadm.sh create "clients/$id/protocol-mappers/models" -r "$REALM" \
    -s 'name=akl-api audience' \
    -s protocol=openid-connect \
    -s protocolMapper=oidc-audience-mapper \
    -s consentRequired=false \
    -s 'config."included.client.audience"=akl-api' \
    -s 'config."id.token.claim"=false' \
    -s 'config."access.token.claim"=true' >/dev/null
  echo "created akb-chat-web"
}

ensure_akb_chat_client

update_client "akl-web" \
  '["https://stratos.zeleznalady.cz/akb/*","https://akl.zeleznalady.cz/*","https://docker.home.cz/*","http://localhost:3000/*","http://localhost:3002/*","http://localhost:3003/*"]' \
  '["https://stratos.zeleznalady.cz","https://akl.zeleznalady.cz","https://docker.home.cz","+"]'

update_client "akb-chat-web" \
  '["https://chat.zeleznalady.cz/api/auth/callback","http://localhost:3010/api/auth/callback"]' \
  '["https://chat.zeleznalady.cz","http://localhost:3010"]'

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
