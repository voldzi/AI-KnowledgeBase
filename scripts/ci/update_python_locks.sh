#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

uv_bin="${UV_BIN:-uv}"
uv_version="0.12.9"
package_cutoff="2026-09-06T10:05:00Z"

[[ "$($uv_bin --version)" == "uv ${uv_version} ("* ]] || {
  printf 'Python lock generation requires uv %s.\n' "$uv_version" >&2
  exit 2
}

common=(
  --upgrade
  --generate-hashes
  --no-build
  --no-emit-index-url
  --exclude-newer "$package_cutoff"
  --python-version 3.12
  --python-platform x86_64-manylinux_2_28
  --custom-compile-command scripts/ci/update_python_locks.sh
)

for service in evaluation-service governance-service ingestion-service llm-gateway-service rag-retrieval-service; do
  "$uv_bin" pip compile "${common[@]}" \
    --output-file "services/$service/requirements.c4.lock" \
    "services/$service/requirements.txt"
done

"$uv_bin" pip compile "${common[@]}" \
  --output-file services/registry-api/requirements.c4.lock \
  services/registry-api/pyproject.toml

"$uv_bin" pip compile "${common[@]}" --extra test \
  --output-file infra/ci/local-fast-check/locks/registry-api.test.lock \
  services/registry-api/pyproject.toml

cp services/governance-service/requirements.c4.lock \
  infra/ci/local-fast-check/locks/governance-service.test.lock
cp services/llm-gateway-service/requirements.c4.lock \
  infra/ci/local-fast-check/locks/llm-gateway-service.test.lock

python3 scripts/ci/update_dependency_lock_manifests.py
printf 'Python locks refreshed with uv %s and cutoff %s.\n' "$uv_version" "$package_cutoff"
