#!/usr/bin/env bash
set -euo pipefail

KEYCLOAK_CONTAINER="${KEYCLOAK_CONTAINER:-keycloak}"
KEYCLOAK_INTERNAL_URL="${KEYCLOAK_INTERNAL_URL:-http://127.0.0.1:8081}"
KEYCLOAK_BOOTSTRAP_MANAGEMENT_PORT="${KEYCLOAK_BOOTSTRAP_MANAGEMENT_PORT:-19000}"
REALM="${REALM:-stratos}"
CLIENT_ID="${AKB_CHAT_MCP_CLIENT_ID:-akb-chat-mcp-user}"
REDIRECT_URI="${AKB_CHAT_MCP_REDIRECT_URI:-http://127.0.0.1:18766/callback}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

docker inspect "$KEYCLOAK_CONTAINER" >/dev/null 2>&1 \
  || fail "Keycloak container not found: $KEYCLOAK_CONTAINER"

bootstrap_client_id="akb-mcp-bootstrap-$(date +%s)-$$"
bootstrap_client_secret="$(openssl rand -hex 32)"

cleanup_host() {
  unset bootstrap_client_secret
}
trap cleanup_host EXIT

docker exec -i \
  -e BOOTSTRAP_CLIENT_ID="$bootstrap_client_id" \
  -e BOOTSTRAP_CLIENT_SECRET="$bootstrap_client_secret" \
  "$KEYCLOAK_CONTAINER" sh -c \
  '/opt/keycloak/bin/kc.sh bootstrap-admin service --client-id "$BOOTSTRAP_CLIENT_ID" --client-secret:env BOOTSTRAP_CLIENT_SECRET --no-prompt --http-management-port "'"$KEYCLOAK_BOOTSTRAP_MANAGEMENT_PORT"'" >/dev/null'

docker exec -i \
  -e KEYCLOAK_INTERNAL_URL="$KEYCLOAK_INTERNAL_URL" \
  -e BOOTSTRAP_CLIENT_ID="$bootstrap_client_id" \
  -e BOOTSTRAP_CLIENT_SECRET="$bootstrap_client_secret" \
  -e REALM="$REALM" \
  -e CLIENT_ID="$CLIENT_ID" \
  -e REDIRECT_URI="$REDIRECT_URI" \
  "$KEYCLOAK_CONTAINER" sh -s <<'IN_CONTAINER'
set -eu

KCADM=/opt/keycloak/bin/kcadm.sh
KCADM_CONFIG="/tmp/kcadm-akb-mcp-$$.config"

strip_quotes() {
  value="$1"
  case "$value" in \"*) value="${value#?}" ;; esac
  case "$value" in *\") value="${value%?}" ;; esac
  printf '%s' "$value"
}

find_client_uuid() {
  wanted="$1"
  client_realm="${2:-$REALM}"
  found=""
  while IFS=, read -r raw_id raw_client_id; do
    id="$(strip_quotes "$raw_id")"
    candidate="$(strip_quotes "$raw_client_id")"
    if [ "$candidate" = "$wanted" ]; then
      found="$id"
      break
    fi
  done <<CLIENTS
$($KCADM get clients --config "$KCADM_CONFIG" -r "$client_realm" -q clientId="$wanted" --fields id,clientId --format csv)
CLIENTS
  printf '%s' "$found"
}

cleanup_container() {
  bootstrap_uuid="$(find_client_uuid "$BOOTSTRAP_CLIENT_ID" master 2>/dev/null || true)"
  if [ -n "$bootstrap_uuid" ]; then
    "$KCADM" delete "clients/$bootstrap_uuid" --config "$KCADM_CONFIG" -r master >/dev/null 2>&1 || true
  fi
  rm -f "$KCADM_CONFIG"
}
trap cleanup_container EXIT

"$KCADM" config credentials --config "$KCADM_CONFIG" \
  --server "$KEYCLOAK_INTERNAL_URL" \
  --realm master \
  --client "$BOOTSTRAP_CLIENT_ID" \
  --secret "$BOOTSTRAP_CLIENT_SECRET" >/dev/null

client_uuid="$(find_client_uuid "$CLIENT_ID")"
if [ -z "$client_uuid" ]; then
  client_uuid="$($KCADM create clients --config "$KCADM_CONFIG" -r "$REALM" \
    -s "clientId=$CLIENT_ID" -s 'name=AKB Chat MCP User Test Client' \
    -s enabled=true -s protocol=openid-connect -i)"
  action=created
else
  action=updated
fi

"$KCADM" update "clients/$client_uuid" --config "$KCADM_CONFIG" -r "$REALM" \
  -s 'name=AKB Chat MCP User Test Client' \
  -s enabled=true \
  -s protocol=openid-connect \
  -s publicClient=true \
  -s bearerOnly=false \
  -s standardFlowEnabled=true \
  -s implicitFlowEnabled=false \
  -s directAccessGrantsEnabled=false \
  -s serviceAccountsEnabled=false \
  -s "redirectUris=[\"$REDIRECT_URI\"]" \
  -s 'webOrigins=[]' \
  -s 'attributes."pkce.code.challenge.method"=S256' \
  -s 'attributes."oauth2.device.authorization.grant.enabled"=true' >/dev/null

ensure_audience_mapper() {
  mapper_name="$1"
  audience="$2"
  compact_mapper_name="$(printf '%s' "$mapper_name" | tr -d '[:space:]')"
  existing="$($KCADM get "clients/$client_uuid/protocol-mappers/models" --config "$KCADM_CONFIG" -r "$REALM" --format json | tr -d '[:space:]')"
  case "$existing" in
    *"\"name\":\"$compact_mapper_name\""*"\"included.client.audience\":\"$audience\""*) return ;;
    *"\"name\":\"$compact_mapper_name\""*)
      echo "ERROR: existing audience mapper has an unexpected configuration: $mapper_name" >&2
      exit 1
      ;;
  esac

  payload="/tmp/akb-mcp-mapper-$$.json"
  printf '%s\n' "{\"name\":\"$mapper_name\",\"protocol\":\"openid-connect\",\"protocolMapper\":\"oidc-audience-mapper\",\"consentRequired\":false,\"config\":{\"included.client.audience\":\"$audience\",\"id.token.claim\":\"false\",\"access.token.claim\":\"true\"}}" >"$payload"
  "$KCADM" create "clients/$client_uuid/protocol-mappers/models" --config "$KCADM_CONFIG" -r "$REALM" -f "$payload" >/dev/null
  rm -f "$payload"
}

ensure_audience_mapper 'akl-api audience' 'akl-api'
ensure_audience_mapper 'stratos-access-api audience' 'stratos-access-api'

ensure_identity_audience_mapper() {
  mapper_name='STRATOS verified identity audience'
  compact_mapper_name='STRATOSverifiedidentityaudience'
  existing="$($KCADM get "clients/$client_uuid/protocol-mappers/models" --config "$KCADM_CONFIG" -r "$REALM" --format json | tr -d '[:space:]')"
  case "$existing" in
    *"\"name\":\"$compact_mapper_name\""*'"user.attribute":"identity_audience"'*'"claim.name":"identity_audience"'*'"access.token.claim":"true"'*) return ;;
    *"\"name\":\"$compact_mapper_name\""*)
      echo "ERROR: existing identity audience mapper has an unexpected configuration" >&2
      exit 1
      ;;
  esac

  payload="/tmp/akb-mcp-identity-mapper-$$.json"
  cat >"$payload" <<'JSON'
{"name":"STRATOS verified identity audience","protocol":"openid-connect","protocolMapper":"oidc-usermodel-attribute-mapper","consentRequired":false,"config":{"user.attribute":"identity_audience","claim.name":"identity_audience","jsonType.label":"String","multivalued":"false","aggregate.attrs":"false","access.token.claim":"true","id.token.claim":"false","userinfo.token.claim":"false"}}
JSON
  "$KCADM" create "clients/$client_uuid/protocol-mappers/models" --config "$KCADM_CONFIG" -r "$REALM" -f "$payload" >/dev/null
  rm -f "$payload"
}

ensure_identity_audience_mapper

representation="$($KCADM get "clients/$client_uuid" --config "$KCADM_CONFIG" -r "$REALM" --format json | tr -d '[:space:]')"
assert_client_setting() {
  expected="$1"
  label="$2"
  case "$representation" in
    *"$expected"*) ;;
    *) echo "ERROR: MCP client setting did not persist: $label" >&2; exit 1 ;;
  esac
}
assert_client_setting '"publicClient":true' 'public client'
assert_client_setting '"standardFlowEnabled":true' 'authorization code flow'
assert_client_setting '"directAccessGrantsEnabled":false' 'password grant disabled'
assert_client_setting '"serviceAccountsEnabled":false' 'service account disabled'
assert_client_setting '"pkce.code.challenge.method":"S256"' 'PKCE S256'
assert_client_setting '"oauth2.device.authorization.grant.enabled":"true"' 'device authorization'

mapper_dump="$($KCADM get "clients/$client_uuid/protocol-mappers/models" --config "$KCADM_CONFIG" -r "$REALM" --format json | tr -d '[:space:]')"
case "$mapper_dump" in *'"included.client.audience":"akl-api"'*) ;; *) echo 'ERROR: akl-api audience is missing' >&2; exit 1 ;; esac
case "$mapper_dump" in *'"included.client.audience":"stratos-access-api"'*) ;; *) echo 'ERROR: stratos-access-api audience is missing' >&2; exit 1 ;; esac
case "$mapper_dump" in *'"claim.name":"identity_audience"'*'"access.token.claim":"true"'*) ;; *) echo 'ERROR: verified identity audience mapper is missing' >&2; exit 1 ;; esac

printf '%s %s in realm %s; PKCE, device flow and exact AKB audiences verified.\n' "$action" "$CLIENT_ID" "$REALM"
IN_CONTAINER

printf 'Temporary bootstrap client removed after reconciliation.\n'
