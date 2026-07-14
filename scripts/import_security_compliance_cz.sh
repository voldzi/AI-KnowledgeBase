#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' \
  'ERROR: This mutating legacy import wrapper is retired in every environment.' \
  'It exits before Keycloak, Registry, object storage, or ingestion access.' \
  'Use the governed AKB application flow.' >&2
exit 1
