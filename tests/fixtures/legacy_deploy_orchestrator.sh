#!/usr/bin/env bash
set +x
set -Eeuo pipefail

printf 'old_current_orchestrator_called\n' >>"${CALL_LOG:?}"
exit 97
