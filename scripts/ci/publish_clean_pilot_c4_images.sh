#!/usr/bin/env bash
set -euo pipefail

registry="${AKB_C4_REGISTRY:-git.home.cz}"
owner="${AKB_C4_REGISTRY_OWNER:-akb}"
source_sha="${AKB_C4_SOURCE_SHA:-}"
output="${AKB_C4_OUTPUT:-clean-pilot-c4-image-manifest.json}"

[[ "$registry" == "git.home.cz" && "$owner" == "akb" ]] || {
  printf 'C4 registry target must be the internal AKB Gitea namespace.\n' >&2
  exit 1
}
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'AKB_C4_SOURCE_SHA must be an exact lowercase Git SHA.\n' >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$source_sha" ]] || {
  printf 'Checked out source differs from AKB_C4_SOURCE_SHA.\n' >&2
  exit 1
}
[[ -n "${AKB_C4_REGISTRY_TOKEN:-}" && -n "${AKB_C4_REGISTRY_USER:-}" ]] || {
  printf 'Ephemeral Gitea registry credentials are required.\n' >&2
  exit 1
}
case "${APP_ENV:-}${NODE_ENV:-}" in
  *[Pp][Rr][Oo][Dd]*)
    printf 'C4 image publication is forbidden in a production environment.\n' >&2
    exit 1
    ;;
esac

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
  docker logout "$registry" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

printf '%s' "$AKB_C4_REGISTRY_TOKEN" \
  | docker login "$registry" --username "$AKB_C4_REGISTRY_USER" --password-stdin >/dev/null
unset AKB_C4_REGISTRY_TOKEN

declare -A images
declare -A upstream

publish_existing() {
  local name="$1" source_ref="$2" target
  target="$registry/$owner/cpe1-$name:$source_sha"
  docker pull "$source_ref" >/dev/null
  docker tag "$source_ref" "$target"
  docker push "$target" >/dev/null
  images["$name"]="$(docker image inspect "$target" --format '{{range .RepoDigests}}{{println .}}{{end}}' | awk -v prefix="$registry/$owner/cpe1-$name@" 'index($0,prefix)==1 {print; exit}')"
  upstream["$name"]="$(docker image inspect "$source_ref" --format '{{range .RepoDigests}}{{println .}}{{end}}' | head -n1)"
  [[ "${images[$name]}" =~ ^git\.home\.cz/akb/cpe1-[a-z0-9-]+@sha256:[a-f0-9]{64}$ ]] || {
    printf 'Registry did not return an immutable digest for %s.\n' "$name" >&2
    exit 1
  }
}

build_and_publish() {
  local name="$1" context="$2" dockerfile="${3:-}" target
  target="$registry/$owner/cpe1-$name:$source_sha"
  local -a dockerfile_args=()
  if [[ -n "$dockerfile" ]]; then
    dockerfile_args=(--file "$dockerfile")
  fi
  docker build --pull "${dockerfile_args[@]}" \
    --label "org.opencontainers.image.revision=$source_sha" \
    --label "org.opencontainers.image.source=AKB/ai-knowledgebase" \
    --tag "$target" "$context"
  docker push "$target" >/dev/null
  images["$name"]="$(docker image inspect "$target" --format '{{range .RepoDigests}}{{println .}}{{end}}' | awk -v prefix="$registry/$owner/cpe1-$name@" 'index($0,prefix)==1 {print; exit}')"
  [[ "${images[$name]}" =~ ^git\.home\.cz/akb/cpe1-[a-z0-9-]+@sha256:[a-f0-9]{64}$ ]] || {
    printf 'Registry did not return an immutable digest for %s.\n' "$name" >&2
    exit 1
  }
}

publish_existing postgresql postgres:16-alpine
publish_existing s3-object-storage minio/minio:latest
publish_existing opensearch opensearchproject/opensearch:2
publish_existing qdrant qdrant/qdrant@sha256:75eab8c4ba42096724fdcfde8b4de0b5713d529dde32f285a1f86fdcb2c9e50c

build_and_publish registry-api services/registry-api
build_and_publish ingestion-service services/ingestion-service
build_and_publish rag-retrieval-service services/rag-retrieval-service
build_and_publish evaluation-service services/evaluation-service
build_and_publish web . apps/web/Dockerfile

for name in postgresql s3-object-storage opensearch qdrant registry-api ingestion-service rag-retrieval-service evaluation-service web; do
  docker pull "${images[$name]}" >/dev/null
done

# Export through files because associative arrays cannot be inherited by Python.
for name in "${!images[@]}"; do
  printf '%s\n' "${images[$name]}" >"$tmp_dir/image-$name"
done
for name in "${!upstream[@]}"; do
  printf '%s\n' "${upstream[$name]}" >"$tmp_dir/upstream-$name"
done

python3 - "$tmp_dir" "$source_sha" "$output" <<'PY'
import hashlib, json, pathlib, sys
root, source_sha, output = pathlib.Path(sys.argv[1]), sys.argv[2], pathlib.Path(sys.argv[3])
names = "postgresql s3-object-storage opensearch qdrant registry-api ingestion-service rag-retrieval-service evaluation-service web".split()
images = {name: (root / f"image-{name}").read_text().strip() for name in names}
upstream = {name: (root / f"upstream-{name}").read_text().strip() for name in names[:4]}
image_bundle = hashlib.sha256(json.dumps(images, separators=(",", ":"), sort_keys=True).encode()).hexdigest()
value = {
    "schemaVersion": "akb-clean-pilot-c4-registry-image-manifest-1",
    "repository": "AKB/ai-knowledgebase",
    "sourceCommit": source_sha,
    "registry": "git.home.cz/akb",
    "images": images,
    "upstreamSources": upstream,
    "imageBundleSha256": image_bundle,
    "pullVerification": "PASS",
    "productionMutationAuthorized": False,
}
output.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
print(f"C4 registry image manifest PASS bundle={image_bundle}")
PY
