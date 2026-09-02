#!/usr/bin/env bash
set -euo pipefail

registry="${AKB_C4_REGISTRY:-git.home.cz}"
owner="${AKB_C4_REGISTRY_OWNER:-akb}"
source_sha="${AKB_C4_SOURCE_SHA:-}"
output="${AKB_C4_OUTPUT:-clean-pilot-c4-image-manifest.json}"
platform="${AKB_C4_PLATFORM:-linux/amd64}"

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
[[ "$platform" == "linux/amd64" ]] || {
  printf 'AKB_C4_PLATFORM must be the reviewed linux/amd64 platform.\n' >&2
  exit 1
}
source_date_epoch="$(git show -s --format=%ct "$source_sha")"
[[ "$source_date_epoch" =~ ^[1-9][0-9]*$ ]] || {
  printf 'The reviewed source commit has no valid SOURCE_DATE_EPOCH.\n' >&2
  exit 1
}
docker buildx version >/dev/null || {
  printf 'Docker Buildx is required for deterministic C4 publication.\n' >&2
  exit 1
}
python3 scripts/ci/check_clean_pilot_c4_inputs.py
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

resolve_pushed_ref() {
  local name="$1" target="$2" resolved
  # Gitea may normalize a pushed single-platform manifest and assign a digest
  # different from the local source manifest. Pull the registry tag before
  # recording the immutable reference so the registry remains authoritative.
  docker pull "$target" >/dev/null
  resolved="$(docker image inspect "$target" --format '{{range .RepoDigests}}{{println .}}{{end}}' | awk -v prefix="$registry/$owner/cpe1-$name@" 'index($0,prefix)==1 {print; exit}')"
  [[ "$resolved" =~ ^git\.home\.cz/akb/cpe1-[a-z0-9-]+@sha256:[a-f0-9]{64}$ ]] || {
    printf 'Registry did not return an immutable digest for %s.\n' "$name" >&2
    exit 1
  }
  printf '%s\n' "$resolved"
}

publish_existing() {
  local name="$1" source_ref="$2" target
  target="$registry/$owner/cpe1-$name:$source_sha"
  docker pull "$source_ref" >/dev/null
  docker tag "$source_ref" "$target"
  docker push "$target" >/dev/null
  images["$name"]="$(resolve_pushed_ref "$name" "$target")"
  upstream["$name"]="$(docker image inspect "$source_ref" --format '{{range .RepoDigests}}{{println .}}{{end}}' | head -n1)"
}

build_and_publish() {
  local name="$1" context="$2" target
  shift 2
  target="$registry/$owner/cpe1-$name:$source_sha"
  local -a dockerfile_args=()
  if [[ "${1:-}" != --* && -n "${1:-}" ]]; then
    dockerfile_args=(--file "$1")
    shift
  fi
  local -a extra_build_args=("$@")
  # SOURCE_DATE_EPOCH plus the image exporter's timestamp rewrite removes
  # filesystem and config-clock variance. Attestations are deliberately kept
  # outside the image manifest because their generated metadata is run-specific;
  # the closed same-SHA artifact remains the authoritative C4 evidence.
  BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker buildx build --pull \
    --platform "$platform" \
    --provenance=false \
    --sbom=false \
    --build-arg "SOURCE_DATE_EPOCH=$source_date_epoch" \
    --output "type=image,name=$target,push=true,unpack=false,rewrite-timestamp=true" \
    "${dockerfile_args[@]}" "${extra_build_args[@]}" "$context"
  images["$name"]="$(resolve_pushed_ref "$name" "$target")"
}

publish_existing postgresql postgres@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685
publish_existing s3-object-storage minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e
publish_existing opensearch opensearchproject/opensearch@sha256:8690b204fe914c60ca76d451ac73bc0481e034d32d3779944c8caca56a2b003f
publish_existing qdrant qdrant/qdrant@sha256:75eab8c4ba42096724fdcfde8b4de0b5713d529dde32f285a1f86fdcb2c9e50c

build_and_publish registry-api services/registry-api
build_and_publish ingestion-service services/ingestion-service --build-arg AKL_INSTALL_DOCLING=true
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

python3 - "$tmp_dir" "$source_sha" "$source_date_epoch" "$platform" "$output" <<'PY'
import hashlib, json, pathlib, sys
root, source_sha = pathlib.Path(sys.argv[1]), sys.argv[2]
source_date_epoch, platform, output = int(sys.argv[3]), sys.argv[4], pathlib.Path(sys.argv[5])
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
    "buildPolicy": {
        "builder": "docker-buildx",
        "platform": platform,
        "sourceDateEpoch": source_date_epoch,
        "rewriteTimestamp": True,
        "provenance": False,
        "sbom": False,
        "lockedInputs": "PASS",
    },
    "imageBundleSha256": image_bundle,
    "pullVerification": "PASS",
    "productionMutationAuthorized": False,
}
output.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
print(f"C4 registry image manifest PASS bundle={image_bundle}")
PY
