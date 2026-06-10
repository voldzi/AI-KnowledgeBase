#!/usr/bin/env bash
set -euo pipefail

KEYCLOAK_CONTAINER="${KEYCLOAK_CONTAINER:-keycloak}"
KEYCLOAK_URL="${KEYCLOAK_URL:-http://127.0.0.1:8081}"
KEYCLOAK_ADMIN_USER="${KEYCLOAK_ADMIN_USER:-admin}"
STRATOS_REALM="${STRATOS_REALM:-stratos}"
DIRECTORY_CLIENT_ID="${STRATOS_KEYCLOAK_DIRECTORY_CLIENT_ID:-stratos-directory-reader}"
AKL_PROD_ENV_FILE="${AKL_PROD_ENV_FILE:-/srv/akl/env/akl.prod.env}"

echo "Keycloak container: ${KEYCLOAK_CONTAINER}"
echo "Keycloak URL:       ${KEYCLOAK_URL}"
echo "Admin user:         ${KEYCLOAK_ADMIN_USER}"
echo "Realm:              ${STRATOS_REALM}"
echo "Directory client:   ${DIRECTORY_CLIENT_ID}"
echo "AKB env file:       ${AKL_PROD_ENV_FILE}"
echo
read -rsp "Keycloak admin password: " KEYCLOAK_ADMIN_PASSWORD
echo

docker exec -i "${KEYCLOAK_CONTAINER}" /opt/keycloak/bin/kcadm.sh config credentials \
  --server "${KEYCLOAK_URL}" \
  --realm master \
  --user "${KEYCLOAK_ADMIN_USER}" \
  --password "${KEYCLOAK_ADMIN_PASSWORD}"

CLIENT_ID="$(docker exec "${KEYCLOAK_CONTAINER}" /opt/keycloak/bin/kcadm.sh get clients \
  -r "${STRATOS_REALM}" \
  -q "clientId=${DIRECTORY_CLIENT_ID}" \
  --fields id,clientId \
  | python3 -c 'import json,sys; data=json.load(sys.stdin); print(data[0]["id"] if data else "")')"

if [ -z "${CLIENT_ID}" ]; then
  docker exec "${KEYCLOAK_CONTAINER}" /opt/keycloak/bin/kcadm.sh create clients \
    -r "${STRATOS_REALM}" \
    -s "clientId=${DIRECTORY_CLIENT_ID}" \
    -s enabled=true \
    -s publicClient=false \
    -s serviceAccountsEnabled=true \
    -s standardFlowEnabled=false \
    -s directAccessGrantsEnabled=false \
    -s protocol=openid-connect >/dev/null
  CLIENT_ID="$(docker exec "${KEYCLOAK_CONTAINER}" /opt/keycloak/bin/kcadm.sh get clients \
    -r "${STRATOS_REALM}" \
    -q "clientId=${DIRECTORY_CLIENT_ID}" \
    --fields id,clientId \
    | python3 -c 'import json,sys; data=json.load(sys.stdin); print(data[0]["id"] if data else "")')"
fi

if [ -z "${CLIENT_ID}" ]; then
  echo "ERROR: could not resolve ${DIRECTORY_CLIENT_ID} client id" >&2
  exit 1
fi

SERVICE_USER_ID="$(docker exec "${KEYCLOAK_CONTAINER}" /opt/keycloak/bin/kcadm.sh get "clients/${CLIENT_ID}/service-account-user" \
  -r "${STRATOS_REALM}" \
  --fields id \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"

REALM_MGMT_ID="$(docker exec "${KEYCLOAK_CONTAINER}" /opt/keycloak/bin/kcadm.sh get clients \
  -r "${STRATOS_REALM}" \
  -q clientId=realm-management \
  --fields id,clientId \
  | python3 -c 'import json,sys; data=json.load(sys.stdin); print(data[0]["id"])')"

for role in view-users query-users; do
  docker exec "${KEYCLOAK_CONTAINER}" /opt/keycloak/bin/kcadm.sh add-roles \
    -r "${STRATOS_REALM}" \
    --uusername "service-account-${DIRECTORY_CLIENT_ID}" \
    --cclientid realm-management \
    --rolename "${role}" >/dev/null || true
done

SECRET="$(docker exec "${KEYCLOAK_CONTAINER}" /opt/keycloak/bin/kcadm.sh get "clients/${CLIENT_ID}/client-secret" \
  -r "${STRATOS_REALM}" \
  --fields value \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["value"])')"

if [ -z "${SECRET}" ]; then
  echo "ERROR: could not read directory client secret" >&2
  exit 1
fi

install -d "$(dirname "${AKL_PROD_ENV_FILE}")"
touch "${AKL_PROD_ENV_FILE}"
chmod 600 "${AKL_PROD_ENV_FILE}"
python3 - "${AKL_PROD_ENV_FILE}" "${KEYCLOAK_URL}" "${STRATOS_REALM}" "${DIRECTORY_CLIENT_ID}" "${SECRET}" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
values = {
    "AKL_KEYCLOAK_ADMIN_BASE_URL": sys.argv[2].rstrip("/"),
    "AKL_KEYCLOAK_REALM": sys.argv[3],
    "STRATOS_KEYCLOAK_DIRECTORY_CLIENT_ID": sys.argv[4],
    "STRATOS_KEYCLOAK_DIRECTORY_CLIENT_SECRET": sys.argv[5],
}
lines = path.read_text().splitlines()
seen = set()
out = []
for line in lines:
    if "=" in line and not line.lstrip().startswith("#"):
        key = line.split("=", 1)[0].strip()
        if key in values:
            out.append(f"{key}={values[key]}")
            seen.add(key)
            continue
    out.append(line)
if out and out[-1] != "":
    out.append("")
for key, value in values.items():
    if key not in seen:
        out.append(f"{key}={value}")
path.write_text("\n".join(out) + "\n")
PY

echo
echo "STRATOS directory reader is ready. Secret was written to ${AKL_PROD_ENV_FILE}."
echo "Restart AKB registry-api after deploying the updated compose file."
