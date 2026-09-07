#!/usr/bin/env bash
set +x
set -Eeuo pipefail

# One-time privileged migration of private runtime configuration. It never
# copies application documents, databases, Qdrant collections, object-store
# contents, releases, Docker volumes, or model artifacts.
[[ ${EUID:-1} -eq 0 ]] || { printf 'Run as root.\n' >&2; exit 2; }
[[ $# -eq 1 ]] || { printf 'Usage: %s <deploy-user>\n' "$0" >&2; exit 2; }
DEPLOY_USER="$1"
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || { printf 'Invalid deploy user.\n' >&2; exit 2; }
id "$DEPLOY_USER" >/dev/null

SOURCE_ROOT=/srv/akl
TARGET_ROOT=/srv/akb
SOURCE_ENV="${SOURCE_ROOT}/env"
TARGET_ENV="${TARGET_ROOT}/env"
SOURCE_CONFIG="${SOURCE_ENV}/akl.prod.env"
TARGET_CONFIG="${TARGET_ENV}/akb.prod.env"
[[ -d "$SOURCE_ENV" && ! -L "$SOURCE_ENV" && -d "$TARGET_ENV" && ! -L "$TARGET_ENV" ]] \
  || { printf 'Expected source and target environment directories are missing.\n' >&2; exit 1; }
[[ -f "$SOURCE_CONFIG" && ! -L "$SOURCE_CONFIG" ]] \
  || { printf 'Legacy production configuration is not a regular file.\n' >&2; exit 1; }
[[ ! -e "$TARGET_CONFIG" && ! -L "$TARGET_CONFIG" ]] \
  || { printf 'Refusing to replace existing AKB production configuration.\n' >&2; exit 1; }
[[ ! -e "${TARGET_ROOT}/current" && ! -L "${TARGET_ROOT}/current" ]] \
  || { printf 'Refusing configuration migration after AKB activation.\n' >&2; exit 1; }

# Refuse links and non-regular entries. This keeps the secret migration bounded
# to private files directly governed by the legacy env directory.
while IFS= read -r -d '' entry; do
  [[ -f "$entry" && ! -L "$entry" ]] || { printf 'Legacy env contains an unsafe entry.\n' >&2; exit 1; }
done < <(find "$SOURCE_ENV" -mindepth 1 -maxdepth 1 -print0)

stage="$(mktemp -d "${TARGET_ROOT}/.akb-config-migration.XXXXXX")"
cleanup() { rm -rf "$stage"; }
trap cleanup EXIT
mkdir -p "${stage}/env"
chmod 0700 "$stage" "${stage}/env"

while IFS= read -r -d '' entry; do
  name="$(basename "$entry")"
  [[ "$name" != "akl.prod.env" ]] || name="akb.prod.env"
  install -m 0600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$entry" "${stage}/env/${name}"
done < <(find "$SOURCE_ENV" -mindepth 1 -maxdepth 1 -type f -print0)

python3 - "${stage}/env/akb.prod.env" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
raw = path.read_text(encoding='utf-8')
if '\x00' in raw or '\r' in raw:
    raise SystemExit('production configuration has unsafe encoding')
raw = raw.replace('/srv/akl/env/', '/srv/akb/env/')
raw = raw.replace('/srv/akl/models/', '/srv/akb/models/')
updates = {
    'COMPOSE_PROJECT_NAME': 'akb',
    'AKL_RELEASE_COMPOSE_PROJECT': 'akb',
}
for key, value in updates.items():
    pattern = re.compile(rf'^{re.escape(key)}=.*$', re.M)
    line = f'{key}={value}'
    raw, count = pattern.subn(line, raw, count=1)
    if count == 0:
        raw += f'\n{line}\n'
path.write_text(raw, encoding='utf-8')
PY

install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$TARGET_ENV"
find "${stage}/env" -maxdepth 1 -type f -exec install -m 0600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" {} "$TARGET_ENV/" \;
install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "${TARGET_ROOT}/models"
printf 'AKB private runtime configuration migrated. No documents, databases, vector data, object storage, releases, Docker volumes, or model artifacts were copied.\n'
