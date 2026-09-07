#!/usr/bin/env bash
set -Eeuo pipefail
set +x

# One-time, privileged preparation only. It never copies documents, databases,
# vector collections, object storage, or secrets from the retired AKL root.
[[ ${EUID:-1} -eq 0 ]] || { printf 'Run as root.\n' >&2; exit 2; }
[[ $# -eq 2 ]] || { printf 'Usage: %s <deploy-user> <release-git-url>\n' "$0" >&2; exit 2; }
DEPLOY_USER="$1"
GIT_URL="$2"
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || { printf 'Invalid deploy user.\n' >&2; exit 2; }
[[ "$GIT_URL" =~ ^ssh://git@git\.home\.cz:2222/[A-Za-z0-9._/-]+\.git$ ]] || { printf 'Release Git URL must be the approved Gitea SSH URL.\n' >&2; exit 2; }
id "$DEPLOY_USER" >/dev/null
ROOT=/srv/akb
for directory in "$ROOT" "$ROOT/releases" "$ROOT/state" "$ROOT/env" "$ROOT/git" "$ROOT/prebuilt" "$ROOT/backups" "$ROOT/ci-deployments" "$ROOT/deployments"; do
  install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 0700 "$directory"
done
GIT_DIR="$ROOT/git/AI-KnowledgeBase.git"
[[ ! -e "$GIT_DIR" ]] || { printf 'Refusing to replace existing Git mirror.\n' >&2; exit 1; }
su -s /bin/bash "$DEPLOY_USER" -c "git clone --bare --no-local '$GIT_URL' '$GIT_DIR'"
printf 'AKB release root prepared. Provision %s/env/akb.prod.env and the referenced mode-0600 secret files separately.\n' "$ROOT"
