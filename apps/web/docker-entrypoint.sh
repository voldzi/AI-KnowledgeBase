#!/bin/sh
set -eu

OBJECT_STORAGE_ROOT="${AKL_WEB_OBJECT_STORAGE_ROOT:-/data/object-storage}"
if [ "${AKL_WEB_PROFILE:-platform}" = "chat" ]; then
  if [ ! -d "$OBJECT_STORAGE_ROOT" ]; then
    echo "chat object storage is not available" >&2
    exit 1
  fi
else
  mkdir -p "$OBJECT_STORAGE_ROOT"
  chown -R nextjs:nextjs "$OBJECT_STORAGE_ROOT"
fi

install_secret() {
  label="$1"
  source_file="$2"
  runtime_file="$3"
  if [ -n "$source_file" ] || [ -n "$runtime_file" ]; then
    if [ -z "$source_file" ] || [ -z "$runtime_file" ] || [ ! -f "$source_file" ]; then
      echo "$label client secret is not available" >&2
      exit 1
    fi
    umask 077
    runtime_dir="$(dirname "$runtime_file")"
    mkdir -p "$runtime_dir"
    chown nextjs:nextjs "$runtime_dir"
    chmod 0700 "$runtime_dir"
    rm -f "$runtime_file"
    cp "$source_file" "$runtime_file"
    chown nextjs:nextjs "$runtime_file"
    chmod 0400 "$runtime_file"
  fi
}

install_secret \
  "web ingestion" \
  "${AKL_WEB_INGESTION_CLIENT_SECRET_SOURCE_FILE:-}" \
  "${AKL_WEB_INGESTION_CLIENT_SECRET_FILE:-}"

if [ "${AKL_DIRECTOR_COPILOT_ENABLED:-false}" = "true" ]; then
  if [ -z "${AKL_DIRECTOR_COPILOT_CLIENT_SECRET_SOURCE_FILE:-}" ] || [ -z "${AKL_DIRECTOR_COPILOT_CLIENT_SECRET_FILE:-}" ]; then
    echo "director copilot client secret paths are not configured" >&2
    exit 1
  fi
fi

install_secret \
  "director copilot" \
  "${AKL_DIRECTOR_COPILOT_CLIENT_SECRET_SOURCE_FILE:-}" \
  "${AKL_DIRECTOR_COPILOT_CLIENT_SECRET_FILE:-}"

exec su-exec nextjs "$@"
