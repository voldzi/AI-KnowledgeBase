#!/usr/bin/env bash
set -euo pipefail

KEYCLOAK_CONTAINER="${KEYCLOAK_CONTAINER:-keycloak}"
KEYCLOAK_INTERNAL_URL="${KEYCLOAK_INTERNAL_URL:-http://127.0.0.1:8081}"
KEYCLOAK_ADMIN_USER="${KEYCLOAK_ADMIN_USER:-admin}"
REALM="${REALM:-stratos}"
SERVICE_CLIENT_ID="${SERVICE_CLIENT_ID:-stratos-akl-adapter}"
REPO_DIR="${REPO_DIR:-/srv/akl/repo}"
IMPORT_DIR="${IMPORT_DIR:-/srv/akl/imports/security-compliance-cz}"
REPORT_PATH="${REPORT_PATH:-$IMPORT_DIR/reports/import-report.json}"
QDRANT_URL="${QDRANT_URL:-http://10.246.244.2:6333}"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

docker inspect "$KEYCLOAK_CONTAINER" >/dev/null 2>&1 || fail "Keycloak container not found: $KEYCLOAK_CONTAINER"
[[ -d "$REPO_DIR" ]] || fail "AKB repo not found: $REPO_DIR"
[[ -d "$IMPORT_DIR/source" ]] || fail "Import source not found: $IMPORT_DIR/source"
[[ -f "$IMPORT_DIR/import-manifest.yaml" ]] || fail "Import manifest not found: $IMPORT_DIR/import-manifest.yaml"

printf 'Keycloak container: %s\n' "$KEYCLOAK_CONTAINER"
printf 'Keycloak URL:       %s\n' "$KEYCLOAK_INTERNAL_URL"
printf 'Admin user:         %s\n' "$KEYCLOAK_ADMIN_USER"
printf 'Realm:              %s\n' "$REALM"
printf 'Service client:     %s\n' "$SERVICE_CLIENT_ID"
printf 'Import dir:         %s\n' "$IMPORT_DIR"
printf '\n'

read -rsp "Keycloak admin password: " KEYCLOAK_ADMIN_PASSWORD
printf '\n'
[[ -n "$KEYCLOAK_ADMIN_PASSWORD" ]] || fail "Keycloak admin password is required"

docker exec \
  -e KEYCLOAK_INTERNAL_URL="$KEYCLOAK_INTERNAL_URL" \
  -e KEYCLOAK_ADMIN_USER="$KEYCLOAK_ADMIN_USER" \
  -e KEYCLOAK_ADMIN_PASSWORD="$KEYCLOAK_ADMIN_PASSWORD" \
  "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh config credentials \
    --server "$KEYCLOAK_INTERNAL_URL" \
    --realm master \
    --user "$KEYCLOAK_ADMIN_USER" \
    --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null

CLIENTS_JSON="$(docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh get clients -r "$REALM" -q clientId="$SERVICE_CLIENT_ID" --fields id,clientId,publicClient,serviceAccountsEnabled,clientAuthenticatorType --format json)"
CLIENT_ID="$(CLIENTS_JSON="$CLIENTS_JSON" python3 - <<'PY_CLIENT'
import json
import os
clients = json.loads(os.environ.get("CLIENTS_JSON") or "[]")
print(clients[0].get("id", "") if clients else "")
PY_CLIENT
)"
[[ -n "$CLIENT_ID" ]] || fail "Keycloak client not found: $SERVICE_CLIENT_ID"

read_client_secret() {
  local secret_json
  secret_json="$(docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh get "clients/$CLIENT_ID/client-secret" -r "$REALM" --format json 2>/dev/null || true)"
  SECRET_JSON="$secret_json" python3 - <<'PY_SECRET'
import json
import os
raw = os.environ.get("SECRET_JSON") or "{}"
try:
    body = json.loads(raw)
except json.JSONDecodeError:
    body = {}
print(body.get("value", ""))
PY_SECRET
}

CLIENT_SECRET="$(read_client_secret)"
if [[ -z "$CLIENT_SECRET" ]]; then
  printf 'Service client secret is missing; configuring %s as confidential service client.
' "$SERVICE_CLIENT_ID"
  docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh update "clients/$CLIENT_ID" -r "$REALM" \
    -s publicClient=false \
    -s serviceAccountsEnabled=true \
    -s clientAuthenticatorType=client-secret >/dev/null
  docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh create "clients/$CLIENT_ID/client-secret" -r "$REALM" >/dev/null 2>&1 || true
  CLIENT_SECRET="$(read_client_secret)"
fi


SERVICE_ACCOUNT_JSON="$(docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh get "clients/$CLIENT_ID/service-account-user" -r "$REALM" --format json)"
SERVICE_ACCOUNT_USER_ID="$(SERVICE_ACCOUNT_JSON="$SERVICE_ACCOUNT_JSON" python3 - <<'PY_SERVICE_USER'
import json
import os
body = json.loads(os.environ.get("SERVICE_ACCOUNT_JSON") or "{}")
print(body.get("id", ""))
PY_SERVICE_USER
)"
[[ -n "$SERVICE_ACCOUNT_USER_ID" ]] || fail "Could not resolve service account user for $SERVICE_CLIENT_ID"

for role_name in admin document_manager reader service_ingestion stratos_service; do
  role_json="$(docker exec "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh get roles/$role_name -r "$REALM" --format json 2>/dev/null || true)"
  if [[ -n "$role_json" ]]; then
    printf '%s
' "$role_json" | docker exec -i "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kcadm.sh add-roles       -r "$REALM"       --uusername "service-account-$SERVICE_CLIENT_ID"       --rolename "$role_name" >/dev/null 2>&1 || true
  fi
done

[[ -n "$CLIENT_SECRET" ]] || fail "Could not read service client secret"

AKL_IMPORT_BEARER_TOKEN="$(
  curl -fsS -X POST "$KEYCLOAK_INTERNAL_URL/realms/$REALM/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode grant_type=client_credentials \
    --data-urlencode client_id="$SERVICE_CLIENT_ID" \
    --data-urlencode client_secret="$CLIENT_SECRET" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])'
)"

[[ -n "$AKL_IMPORT_BEARER_TOKEN" ]] || fail "Could not obtain service bearer token"

export AKL_IMPORT_BEARER_TOKEN
cd "$REPO_DIR"

python3 tools/import_docs_folder.py \
  --source "$IMPORT_DIR/source" \
  --manifest "$IMPORT_DIR/import-manifest.yaml" \
  --mode new-version \
  --report "$REPORT_PATH" \
  --registry-url http://127.0.0.1:3220/registry \
  --ingestion-url http://127.0.0.1:3220/ingestion \
  --qdrant-url "$QDRANT_URL" \
  --ingestion-container akl-ingestion-service-1 \
  --storage-prefix security-compliance-cz \
  --timeout-seconds 300

python3 - "$REPORT_PATH" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
print("\nImport verification")
for key, value in report["totals"].items():
    print(f"- {key}: {value}")
if report["totals"].get("failed_documents"):
    raise SystemExit(1)
if report["totals"].get("qdrant_points", 0) <= 0:
    raise SystemExit("No Qdrant points were created")
PY

unset KEYCLOAK_ADMIN_PASSWORD CLIENT_SECRET AKL_IMPORT_BEARER_TOKEN
