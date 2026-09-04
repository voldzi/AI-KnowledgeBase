#!/usr/bin/env bash
set -euo pipefail

registry="${AKB_RELEASE_REGISTRY:-git.home.cz}"
owner="${AKB_RELEASE_REGISTRY_OWNER:-akb}"
source_sha="${AKB_RELEASE_SOURCE_SHA:-}"
output="${AKB_RELEASE_MANIFEST_OUTPUT:-akb-production-image-manifest.json}"
platform="${AKB_RELEASE_PLATFORM:-linux/amd64}"

[[ "$registry" == "git.home.cz" && "$owner" == "akb" ]] \
  || { printf 'Production image registry is not approved.\n' >&2; exit 1; }
[[ "$source_sha" =~ ^[0-9a-f]{40}$ && "$(git rev-parse HEAD)" == "$source_sha" ]] \
  || { printf 'Production image source SHA is invalid.\n' >&2; exit 1; }
[[ "$platform" == "linux/amd64" ]] \
  || { printf 'Production image platform must be linux/amd64.\n' >&2; exit 1; }
[[ -n "${AKB_RELEASE_REGISTRY_USER:-}" && -n "${AKB_RELEASE_REGISTRY_TOKEN:-}" ]] \
  || { printf 'Ephemeral registry credentials are required.\n' >&2; exit 1; }

source_date_epoch="$(git show -s --format=%ct "$source_sha")"
[[ "$source_date_epoch" =~ ^[1-9][0-9]*$ ]] \
  || { printf 'Source commit timestamp is invalid.\n' >&2; exit 1; }
docker buildx version >/dev/null
python3 scripts/ci/check_clean_pilot_c4_inputs.py

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
  docker logout "$registry" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
printf '%s' "$AKB_RELEASE_REGISTRY_TOKEN" \
  | docker login "$registry" --username "$AKB_RELEASE_REGISTRY_USER" --password-stdin >/dev/null
unset AKB_RELEASE_REGISTRY_TOKEN

declare -A images
build_image() {
  local service="$1" context="$2" dockerfile="$3"
  shift 3
  local target="$registry/$owner/akb-$service:$source_sha"
  if docker pull "$target" >/dev/null 2>&1; then
    [[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$target")" == "$source_sha" \
      && "$(docker image inspect --format '{{index .Config.Labels "cz.zeleznalady.akl.compose-project"}}' "$target")" == "akl" \
      && "$(docker image inspect --format '{{index .Config.Labels "cz.zeleznalady.akl.service"}}' "$target")" == "$service" ]] \
      || { printf 'Existing immutable image provenance is invalid for %s.\n' "$service" >&2; exit 1; }
  else
  BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker buildx build --pull \
    --platform "$platform" --provenance=false --sbom=false \
    --build-arg "SOURCE_DATE_EPOCH=$source_date_epoch" \
    --label "org.opencontainers.image.revision=$source_sha" \
    --label 'cz.zeleznalady.akl.compose-project=akl' \
    --label "cz.zeleznalady.akl.service=$service" \
    --output "type=image,name=$target,push=true,unpack=false,rewrite-timestamp=true" \
    --file "$dockerfile" "$@" "$context"
    docker pull "$target" >/dev/null
  fi
  local resolved
  resolved="$(docker image inspect "$target" --format '{{range .RepoDigests}}{{println .}}{{end}}' \
    | awk -v prefix="$registry/$owner/akb-$service@" 'index($0,prefix)==1 {print; exit}')"
  [[ "$resolved" =~ ^git\.home\.cz/akb/akb-[a-z0-9-]+@sha256:[a-f0-9]{64}$ ]] \
    || { printf 'Registry digest is invalid for %s.\n' "$service" >&2; exit 1; }
  images["$service"]="$resolved"
}

build_image registry-api services/registry-api services/registry-api/Dockerfile
build_image ingestion-service services/ingestion-service services/ingestion-service/Dockerfile \
  --build-arg AKL_INSTALL_DOCLING=true
build_image rag-retrieval-service services/rag-retrieval-service services/rag-retrieval-service/Dockerfile
build_image evaluation-service services/evaluation-service services/evaluation-service/Dockerfile
build_image governance-service services/governance-service services/governance-service/Dockerfile
build_image llm-gateway-service services/llm-gateway-service services/llm-gateway-service/Dockerfile
build_image web . apps/web/Dockerfile \
  --build-arg AKL_IMAGE_SERVICE=web --build-arg NEXT_PUBLIC_AKL_BASE_PATH=/akb
build_image chat-web . apps/web/Dockerfile \
  --build-arg AKL_IMAGE_SERVICE=chat-web --build-arg NEXT_PUBLIC_AKL_BASE_PATH=

for service in "${!images[@]}"; do
  printf '%s\n' "${images[$service]}" >"$tmp_dir/$service"
done
python3 - "$tmp_dir" "$source_sha" "$source_date_epoch" "$platform" "$output" <<'PY'
import hashlib, json, pathlib, sys
root, source, epoch, platform, output = pathlib.Path(sys.argv[1]), sys.argv[2], int(sys.argv[3]), sys.argv[4], pathlib.Path(sys.argv[5])
names = ["registry-api", "ingestion-service", "rag-retrieval-service", "evaluation-service", "governance-service", "llm-gateway-service", "web", "chat-web"]
images = {name: (root / name).read_text().strip() for name in names}
bundle = hashlib.sha256(json.dumps(images, separators=(",", ":"), sort_keys=True).encode()).hexdigest()
value = {
    "schema": "akb-production-image-manifest-1",
    "repository": "AKB/ai-knowledgebase",
    "sourceCommit": source,
    "platform": platform,
    "sourceDateEpoch": epoch,
    "images": images,
    "imageBundleSha256": bundle,
    "buildPolicy": {"pull": True, "lockedInputs": "PASS", "provenance": False, "sbom": False, "rewriteTimestamp": True},
    "productionMutationAuthorized": False,
}
output.write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n")
print(f"production_image_manifest=passed bundle={bundle}")
PY
