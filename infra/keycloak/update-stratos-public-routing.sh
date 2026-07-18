#!/usr/bin/env bash
set -euo pipefail

KEYCLOAK_CONTAINER="${KEYCLOAK_CONTAINER:-keycloak}"
KEYCLOAK_INTERNAL_URL="${KEYCLOAK_INTERNAL_URL:-http://127.0.0.1:8081}"
KEYCLOAK_ADMIN_USER="${KEYCLOAK_ADMIN_USER:-admin}"
KEYCLOAK_USE_BOOTSTRAP_ADMIN_SERVICE="${KEYCLOAK_USE_BOOTSTRAP_ADMIN_SERVICE:-false}"
KEYCLOAK_BOOTSTRAP_MANAGEMENT_PORT="${KEYCLOAK_BOOTSTRAP_MANAGEMENT_PORT:-19000}"
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

AUTH_MODE="password"
BOOTSTRAP_CLIENT_ID=""
BOOTSTRAP_CLIENT_SECRET=""
if [[ -z "${KEYCLOAK_ADMIN_PASSWORD:-}" && "$KEYCLOAK_USE_BOOTSTRAP_ADMIN_SERVICE" = "true" ]]; then
  AUTH_MODE="bootstrap-service"
  BOOTSTRAP_CLIENT_ID="akb-chat-bootstrap-$(date +%s)"
  BOOTSTRAP_CLIENT_SECRET="$(openssl rand -hex 32)"
  docker exec \
    -e BOOTSTRAP_CLIENT_ID="$BOOTSTRAP_CLIENT_ID" \
    -e BOOTSTRAP_CLIENT_SECRET="$BOOTSTRAP_CLIENT_SECRET" \
    "$KEYCLOAK_CONTAINER" sh -c \
    '/opt/keycloak/bin/kc.sh bootstrap-admin service --client-id "$BOOTSTRAP_CLIENT_ID" --client-secret:env BOOTSTRAP_CLIENT_SECRET --no-prompt --http-management-port "'"$KEYCLOAK_BOOTSTRAP_MANAGEMENT_PORT"'" >/dev/null'
elif [[ -z "${KEYCLOAK_ADMIN_PASSWORD:-}" ]]; then
  read -rsp "Keycloak admin password: " KEYCLOAK_ADMIN_PASSWORD
  printf "\n"
fi

[[ -n "${KEYCLOAK_ADMIN_PASSWORD:-}" || "$AUTH_MODE" = "bootstrap-service" ]] \
  || fail "Password cannot be empty."

trap 'unset KEYCLOAK_ADMIN_PASSWORD BOOTSTRAP_CLIENT_SECRET' EXIT

docker exec -i \
  -e KEYCLOAK_INTERNAL_URL="$KEYCLOAK_INTERNAL_URL" \
  -e KEYCLOAK_ADMIN_USER="$KEYCLOAK_ADMIN_USER" \
  -e KEYCLOAK_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-}" \
  -e AUTH_MODE="$AUTH_MODE" \
  -e BOOTSTRAP_CLIENT_ID="$BOOTSTRAP_CLIENT_ID" \
  -e BOOTSTRAP_CLIENT_SECRET="$BOOTSTRAP_CLIENT_SECRET" \
  -e REALM="$REALM" \
  "$KEYCLOAK_CONTAINER" sh -s <<"IN_CONTAINER"
set -euo pipefail

KCADM=/opt/keycloak/bin/kcadm.sh
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

find_client_id() {
  client_id="$1"
  client_realm="${2:-$REALM}"
  id=""
  while IFS=, read -r raw_id raw_client_id; do
    raw_id=$(strip_quotes "$raw_id")
    raw_client_id=$(strip_quotes "$raw_client_id")
    if [ "$raw_client_id" = "$client_id" ]; then
      id="$raw_id"
      break
    fi
  done <<CLIENTS
$("$KCADM" get clients -r "$client_realm" -q clientId="$client_id" --fields id,clientId --format csv)
CLIENTS
  printf "%s" "$id"
}

cleanup_bootstrap_client() {
  if [ "$AUTH_MODE" != "bootstrap-service" ]; then
    return
  fi
  bootstrap_id=$(find_client_id "$BOOTSTRAP_CLIENT_ID" master)
  if [ -n "$bootstrap_id" ]; then
    "$KCADM" delete "clients/$bootstrap_id" -r master >/dev/null || true
  fi
}

trap cleanup_bootstrap_client EXIT

update_client() {
  client_id="$1"
  redirect_uris_json="$2"
  web_origins_json="$3"

  id=$(find_client_id "$client_id")
  if [ -z "$id" ]; then
    echo "ERROR: client not found: $client_id" >&2
    exit 1
  fi

  /opt/keycloak/bin/kcadm.sh update "clients/$id" -r "$REALM" \
    -s "redirectUris=$redirect_uris_json" \
    -s "webOrigins=$web_origins_json" >/dev/null
  echo "updated $client_id"
}

ensure_akb_chat_client() {
  id=$(find_client_id "akb-chat-web")
  if [ -z "$id" ]; then
    id=$(
      /opt/keycloak/bin/kcadm.sh create clients -r "$REALM" \
        -s clientId=akb-chat-web \
        -s 'name=AKB Standalone Chat PWA' \
        -s enabled=true \
        -s protocol=openid-connect \
        -i
    )
    echo "created akb-chat-web"
  fi

  /opt/keycloak/bin/kcadm.sh update "clients/$id" -r "$REALM" \
    -s 'name=AKB Standalone Chat PWA' \
    -s enabled=true \
    -s protocol=openid-connect \
    -s publicClient=true \
    -s standardFlowEnabled=true \
    -s implicitFlowEnabled=false \
    -s directAccessGrantsEnabled=false \
    -s serviceAccountsEnabled=false \
    -s 'redirectUris=["https://chat.zeleznalady.cz/api/auth/callback"]' \
    -s 'webOrigins=["https://chat.zeleznalady.cz"]' \
    -s 'attributes."post.logout.redirect.uris"=https://chat.zeleznalady.cz/*' \
    -s 'attributes."pkce.code.challenge.method"=S256' >/dev/null

  ensure_audience_mapper "$id" "akl-api audience" "akl-api"
  ensure_audience_mapper "$id" "budget-web audience" "budget-web"
  ensure_audience_mapper "$id" "stratos-access-api audience" "stratos-access-api"
  echo "reconciled akb-chat-web"
}

ensure_audience_mapper() {
  client_uuid="$1"
  mapper_name="$2"
  audience="$3"
  mapper_payload_file="/tmp/akb-audience-mapper-$$.json"
  mapper_id=""
  while IFS=, read -r raw_id raw_name; do
    raw_id=$(strip_quotes "$raw_id")
    raw_name=$(strip_quotes "$raw_name")
    if [ "$raw_name" = "$mapper_name" ]; then
      mapper_id="$raw_id"
      break
    fi
  done <<MAPPERS
$(/opt/keycloak/bin/kcadm.sh get "clients/$client_uuid/protocol-mappers/models" -r "$REALM" --fields id,name --format csv)
MAPPERS

  if [ -z "$mapper_id" ]; then
    printf '%s\n' \
      "{\"name\":\"$mapper_name\",\"protocol\":\"openid-connect\",\"protocolMapper\":\"oidc-audience-mapper\",\"consentRequired\":false,\"config\":{\"included.client.audience\":\"$audience\",\"id.token.claim\":\"false\",\"access.token.claim\":\"true\"}}" \
      >"$mapper_payload_file"
    mapper_id=$(
      /opt/keycloak/bin/kcadm.sh create "clients/$client_uuid/protocol-mappers/models" -r "$REALM" \
        -f "$mapper_payload_file" \
        -i
    )
  else
    printf '%s\n' \
      "{\"id\":\"$mapper_id\",\"name\":\"$mapper_name\",\"protocol\":\"openid-connect\",\"protocolMapper\":\"oidc-audience-mapper\",\"consentRequired\":false,\"config\":{\"included.client.audience\":\"$audience\",\"id.token.claim\":\"false\",\"access.token.claim\":\"true\"}}" \
      >"$mapper_payload_file"
    /opt/keycloak/bin/kcadm.sh update \
      "clients/$client_uuid/protocol-mappers/models/$mapper_id" -r "$REALM" \
      -f "$mapper_payload_file" >/dev/null
  fi
  rm -f "$mapper_payload_file"

  mapper_config=$(
    /opt/keycloak/bin/kcadm.sh get \
      "clients/$client_uuid/protocol-mappers/models/$mapper_id" -r "$REALM" \
      --format json | tr -d '[:space:]'
  )
  case "$mapper_config" in
    *"\"included.client.audience\":\"$audience\""*) ;;
    *)
      echo "ERROR: audience mapper $mapper_name did not persist audience $audience" >&2
      exit 1
      ;;
  esac
}

ensure_akb_chat_client

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
"$KCADM" get clients -r "$REALM" --fields clientId,redirectUris,webOrigins --format json
IN_CONTAINER

unset KEYCLOAK_ADMIN_PASSWORD BOOTSTRAP_CLIENT_SECRET
trap - EXIT
printf "\nSTRATOS public routing clients updated.\n"
