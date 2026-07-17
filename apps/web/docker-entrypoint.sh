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

INGESTION_SECRET_SOURCE="${AKL_WEB_INGESTION_CLIENT_SECRET_SOURCE_FILE:-}"
INGESTION_SECRET_RUNTIME="${AKL_WEB_INGESTION_CLIENT_SECRET_FILE:-}"
if [ -n "$INGESTION_SECRET_SOURCE" ] || [ -n "$INGESTION_SECRET_RUNTIME" ]; then
  if [ -z "$INGESTION_SECRET_SOURCE" ] || [ -z "$INGESTION_SECRET_RUNTIME" ] || [ ! -f "$INGESTION_SECRET_SOURCE" ]; then
    echo "web ingestion client secret is not available" >&2
    exit 1
  fi
  umask 077
  INGESTION_SECRET_RUNTIME_DIR="$(dirname "$INGESTION_SECRET_RUNTIME")"
  mkdir -p "$INGESTION_SECRET_RUNTIME_DIR"
  chown nextjs:nextjs "$INGESTION_SECRET_RUNTIME_DIR"
  chmod 0700 "$INGESTION_SECRET_RUNTIME_DIR"
  rm -f "$INGESTION_SECRET_RUNTIME"
  cp "$INGESTION_SECRET_SOURCE" "$INGESTION_SECRET_RUNTIME"
  chown nextjs:nextjs "$INGESTION_SECRET_RUNTIME"
  chmod 0400 "$INGESTION_SECRET_RUNTIME"
fi

exec su-exec nextjs "$@"
