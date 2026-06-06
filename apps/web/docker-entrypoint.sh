#!/bin/sh
set -eu

OBJECT_STORAGE_ROOT="${AKL_WEB_OBJECT_STORAGE_ROOT:-/data/object-storage}"
mkdir -p "$OBJECT_STORAGE_ROOT"
chown -R nextjs:nextjs "$OBJECT_STORAGE_ROOT"

exec su-exec nextjs "$@"
