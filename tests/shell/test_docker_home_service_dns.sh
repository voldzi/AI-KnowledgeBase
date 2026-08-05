#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose/docker-compose.docker-home.yml"
ENV_EXAMPLE="$ROOT_DIR/infra/docker-compose/docker-home.env.example"

grep -Fq "AKL_IMAGE_TAG=docker-home" "$ENV_EXAMPLE" \
  || {
    printf 'Docker Home production env must document the immutable image-tag fallback.\n' >&2
    exit 1
  }

for expected in \
  "image: \${WEB_IMAGE:-akl/web:\${AKL_IMAGE_TAG:-docker-home}}" \
  "image: \${CHAT_WEB_IMAGE:-akl/chat-web:\${AKL_IMAGE_TAG:-docker-home}}" \
  "image: \${REGISTRY_API_IMAGE:-akl/registry-api:\${AKL_IMAGE_TAG:-docker-home}}" \
  "image: \${INGESTION_SERVICE_IMAGE:-akl/ingestion-service:\${AKL_IMAGE_TAG:-docker-home}}"
do
  grep -Fq "$expected" "$COMPOSE_FILE" \
    || {
      printf 'Docker Home immutable image fallback is missing %s.\n' "$expected" >&2
      exit 1
    }
done

if grep -Fq 'AKL_S3_BUCKET: ${AKL_S3_BUCKET:-akl-documents}' "$COMPOSE_FILE"; then
  printf 'Docker Home services must default to the physical akb-documents bucket.\n' >&2
  exit 1
fi

[[ "$(grep -Fc 'AKL_S3_BUCKET: ${AKL_S3_BUCKET:-akb-documents}' "$COMPOSE_FILE")" -eq 4 ]] \
  || {
    printf 'All four document-storage boundary services must share the akb-documents bucket.\n' >&2
    exit 1
  }

grep -Fq "WEB_UPSTREAM=akl-platform-web:3000" "$ENV_EXAMPLE" \
  || {
    printf 'Docker Home production env must route the reverse proxy through the collision-free AKB web service DNS name.\n' >&2
    exit 1
  }

grep -Fq "web=http://akl-platform-web:3000/akb/health" "$ENV_EXAMPLE" \
  || {
    printf 'Docker Home production env readiness checks must use the collision-free AKB web service DNS name.\n' >&2
    exit 1
  }

awk '
  /^  web:$/ { in_web = 1; next }
  in_web && /^  [a-zA-Z0-9_-]+:$/ { exit }
  in_web { print }
' "$COMPOSE_FILE" | grep -Fq 'akl-platform-web' \
  || {
    printf 'Docker Home web service must publish the collision-free AKB network alias.\n' >&2
    exit 1
  }

if grep -Fq 'akl-web-1' "$ENV_EXAMPLE"; then
  printf 'Docker Home production env must not depend on an ephemeral container name.\n' >&2
  exit 1
fi

grep -Fq "AKL_OPENSEARCH_BASE_URL=https://opensearch.home.cz:9200" "$ENV_EXAMPLE" \
  || {
    printf 'Docker Home production env must use central TLS OpenSearch.\n' >&2
    exit 1
  }

if grep -Fq 'opensearch=http://opensearch:9200' "$ENV_EXAMPLE" \
  || grep -Fq 'opensearch=http://opensearch:9200' "$COMPOSE_FILE"; then
  printf 'Platform readiness must not probe the removed local OpenSearch service.\n' >&2
  exit 1
fi

if grep -Eq '^  opensearch:$|^  opensearch-data:$' "$COMPOSE_FILE"; then
  printf 'Docker Home production Compose must not define local OpenSearch state.\n' >&2
  exit 1
fi

for expected in \
  'AKL_OPENSEARCH_INGESTION_USERNAME:-akl_ingestion_writer' \
  'AKL_OPENSEARCH_RAG_USERNAME:-akl_rag_reader' \
  '/run/secrets/opensearch-root-ca.pem:ro' \
  '/run/secrets/akl-opensearch-password:ro'
do
  grep -Fq "$expected" "$COMPOSE_FILE" \
    || {
      printf 'Docker Home OpenSearch contract is missing %s.\n' "$expected" >&2
      exit 1
    }
done

for expected in \
  'AKL_RAG_RERANKER_API_KEY_FILE: /run/secrets/akl-rag-reranker-api-key' \
  'AKL_RAG_RERANKER_BASE_URLS:' \
  'AKL_RAG_RERANKER_TIMEOUT_SECONDS:' \
  'AKL_RAG_RERANKER_BATCH_SIZE:' \
  'AKL_RAG_RERANKER_MIN_SCORE:' \
  'AKL_RAG_RERANKER_API_KEY_SOURCE_FILE:-/dev/null' \
  '/run/secrets/akl-rag-reranker-api-key:ro'
do
  grep -Fq "$expected" "$COMPOSE_FILE" \
    || {
      printf 'Docker Home RAG reranker contract is missing %s.\n' "$expected" >&2
      exit 1
    }
done

printf 'Docker Home service-DNS regression checks passed.\n'
