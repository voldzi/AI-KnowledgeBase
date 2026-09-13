#!/usr/bin/env bash
set -euo pipefail

EXPECTED_UUID="2f93f595-b61b-4eea-9054-7afa9b275b5b"
X5_ROOT="/srv/x5-production"
BGE_TARGET="${X5_ROOT}/cache/akb/bge-reranker"
GTE_TARGET="${X5_ROOT}/cache/akb/gte-reranker"
BGE_VOLUME="akb-bge-reranker_bge_reranker_cache"
GTE_VOLUME="akb-gte-reranker_gte_reranker_cache"
REPO_ROOT="${1:-/srv/akb/current}"
RUNTIME_CONFIG_ROOT="/srv/akb/rerankers"
ROLLBACK_BGE_CONFIG="${RUNTIME_CONFIG_ROOT}/docker-compose.bge-volume-rollback.yml"
ROLLBACK_GTE_CONFIG="${RUNTIME_CONFIG_ROOT}/docker-compose.gte-volume-rollback.yml"
MUTATION_STARTED="false"

fail() {
  printf 'AKB X5 cache migration failed: %s\n' "$*" >&2
  exit 1
}

[[ -d "${REPO_ROOT}" ]] || fail "repository root is unavailable: ${REPO_ROOT}"
command -v docker >/dev/null 2>&1 || fail "docker is unavailable"

mounted_target="$(findmnt -n -o TARGET --target "${X5_ROOT}" 2>/dev/null || true)"
mounted_uuid="$(findmnt -n -o UUID --target "${X5_ROOT}" 2>/dev/null || true)"
[[ "${mounted_target}" == "${X5_ROOT}" ]] || fail "${X5_ROOT} is not a dedicated mounted filesystem"
[[ "${mounted_uuid}" == "${EXPECTED_UUID}" ]] || fail "unexpected filesystem UUID at ${X5_ROOT}"

for volume in "${BGE_VOLUME}" "${GTE_VOLUME}"; do
  docker volume inspect "${volume}" >/dev/null 2>&1 || fail "source volume is missing: ${volume}"
done

install -d -m 0755 "${RUNTIME_CONFIG_ROOT}"
install -m 0644 \
  "${REPO_ROOT}/infra/rerankers/docker-compose.bge-docker-home.yml" \
  "${RUNTIME_CONFIG_ROOT}/docker-compose.bge-docker-home.yml"
install -m 0644 \
  "${REPO_ROOT}/infra/rerankers/docker-compose.gte-docker-home.yml" \
  "${RUNTIME_CONFIG_ROOT}/docker-compose.gte-docker-home.yml"
install -m 0644 \
  "${REPO_ROOT}/infra/rerankers/docker-compose.bge-docker-home-volume-rollback.yml" \
  "${ROLLBACK_BGE_CONFIG}"
install -m 0644 \
  "${REPO_ROOT}/infra/rerankers/docker-compose.gte-docker-home-volume-rollback.yml" \
  "${ROLLBACK_GTE_CONFIG}"

rollback_on_error() {
  local status=$?
  if [[ "${MUTATION_STARTED}" == "true" ]]; then
    printf 'Migration failed; restoring both rerankers from captured Compose files.\n' >&2
    docker compose -p akb-bge-reranker \
      -f "${RUNTIME_CONFIG_ROOT}/docker-compose.bge-docker-home.yml" \
      -f "${ROLLBACK_BGE_CONFIG}" \
      up -d --pull never --no-build --no-deps --force-recreate bge-reranker || true
    docker compose -p akb-gte-reranker \
      -f "${RUNTIME_CONFIG_ROOT}/docker-compose.gte-docker-home.yml" \
      -f "${ROLLBACK_GTE_CONFIG}" \
      up -d --pull never --no-build --no-deps --force-recreate gte-reranker || true
  fi
  exit "${status}"
}
trap rollback_on_error ERR
MUTATION_STARTED="true"

docker compose -p akb-bge-reranker \
  -f "${RUNTIME_CONFIG_ROOT}/docker-compose.bge-docker-home.yml" \
  stop bge-reranker
docker compose -p akb-gte-reranker \
  -f "${RUNTIME_CONFIG_ROOT}/docker-compose.gte-docker-home.yml" \
  stop gte-reranker

copy_volume() {
  local volume="$1"
  local target="$2"
  local relative_target="${target#${X5_ROOT}/}"
  docker run --rm --network none --read-only --tmpfs /tmp:size=16m \
    --entrypoint sh \
    --mount "type=volume,src=${volume},dst=/source,readonly" \
    --mount "type=bind,src=${X5_ROOT},dst=/x5" \
    "${HELPER_IMAGE}" -ceu \
    'target="/x5/$1"; mkdir -p "$target"; cp -a /source/. "$target/"; chown -R 0:0 "$target"; chmod 0755 "$target"' \
    sh "${relative_target}"
}

HELPER_IMAGE="$(docker inspect --format '{{.Config.Image}}' akb-bge-reranker-bge-reranker-1)"
[[ -n "${HELPER_IMAGE}" ]] || fail "the pinned reranker helper image is unavailable"
copy_volume "${BGE_VOLUME}" "${BGE_TARGET}"
copy_volume "${GTE_VOLUME}" "${GTE_TARGET}"

for target in "${BGE_TARGET}" "${GTE_TARGET}"; do
  [[ "$(findmnt -n -o UUID --target "${target}")" == "${EXPECTED_UUID}" ]] \
    || fail "target escaped the verified X5 filesystem: ${target}"
done

docker compose -p akb-bge-reranker \
  -f "${RUNTIME_CONFIG_ROOT}/docker-compose.bge-docker-home.yml" \
  up -d --pull never --no-build --no-deps --force-recreate bge-reranker
docker compose -p akb-gte-reranker \
  -f "${RUNTIME_CONFIG_ROOT}/docker-compose.gte-docker-home.yml" \
  up -d --pull never --no-build --no-deps --force-recreate gte-reranker

wait_for_ready() {
  local endpoint="$1"
  local deadline=$((SECONDS + 300))
  while (( SECONDS < deadline )); do
    if docker exec akb-rag-retrieval-service-1 python -c \
      "import urllib.request; urllib.request.urlopen('http://${endpoint}/health', timeout=2).read()" \
      >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  fail "model endpoint did not become ready: ${endpoint}"
}

wait_for_ready bge-reranker:3000
wait_for_ready gte-reranker:3000

docker exec -i akb-rag-retrieval-service-1 python - \
  --provider tei --base-url http://bge-reranker:3000 \
  < "${REPO_ROOT}/scripts/reranker_smoke.py"
docker exec -i akb-rag-retrieval-service-1 python - \
  --provider tei --base-url http://gte-reranker:3000 \
  < "${REPO_ROOT}/scripts/reranker_smoke.py"

for pair in \
  "akb-bge-reranker-bge-reranker-1:${BGE_TARGET}" \
  "akb-gte-reranker-gte-reranker-1:${GTE_TARGET}"; do
  container="${pair%%:*}"
  target="${pair#*:}"
  source="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' "${container}")"
  [[ "${source}" == "${target}" ]] || fail "unexpected /data source for ${container}: ${source}"
done

MUTATION_STARTED="false"
trap - ERR
printf 'AKB reranker caches migrated to X5. Original Docker volumes were preserved for rollback.\n'
