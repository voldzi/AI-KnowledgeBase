#!/usr/bin/env bash
set -Eeuo pipefail

# Pre-pilot fast path for changes isolated to apps/web. It leaves the immutable
# release pointer untouched; the next formal release reconciles the full stack.

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

TARGET_SHA="${1:-$(git rev-parse HEAD)}"
SSH_TARGET="${AKB_FAST_SSH_TARGET:-docker.home.cz}"
SSH_HOSTNAME="${AKB_FAST_SSH_HOSTNAME:-}"
REMOTE_ENV="/srv/akb/env/akb.prod.env"
REMOTE_TMP="/tmp/akb-fast-web-${TARGET_SHA}.tar.gz"
LOCAL_ARCHIVE="${TMPDIR:-/tmp}/akb-fast-web-${TARGET_SHA}.tar.gz"
WEB_IMAGE="akl/web:${TARGET_SHA}"
CHAT_IMAGE="akl/chat-web:${TARGET_SHA}"

ssh_options=(-o BatchMode=yes -o IdentitiesOnly=yes)
if [[ -n "$SSH_HOSTNAME" ]]; then
  ssh_options+=(-o "HostName=${SSH_HOSTNAME}" -o HostKeyAlias=docker.home.cz)
fi

# Arguments are intentionally expanded locally and passed as SSH argv.
# shellcheck disable=SC2029
remote() { ssh "${ssh_options[@]}" "$SSH_TARGET" "$@"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
cleanup() { rm -f "$LOCAL_ARCHIVE"; }
trap cleanup EXIT

git diff --quiet || die "working tree has unstaged changes"
git diff --cached --quiet || die "working tree has staged changes"
git fetch origin main --quiet
git cat-file -e "${TARGET_SHA}^{commit}" 2>/dev/null || die "target is not a commit"
[[ "$(git rev-parse "$TARGET_SHA")" == "$(git rev-parse HEAD)" ]] || die "target must equal HEAD"
git merge-base --is-ancestor "$TARGET_SHA" origin/main || die "target is not contained in origin/main"

BASE_SHA="$(remote "docker inspect -f '{{ index .Config.Labels \"org.opencontainers.image.revision\" }}' akb-web-1")"
git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null || die "production web SHA is unavailable locally"

changed_paths=()
while IFS= read -r path; do
  changed_paths+=("$path")
done < <(git diff --name-only "$BASE_SHA" "$TARGET_SHA")
((${#changed_paths[@]} > 0)) || die "production web already runs target SHA"
has_web_change=false
for path in "${changed_paths[@]}"; do
  case "$path" in
    apps/web/*) has_web_change=true ;;
    docs/*|README.md|AGENTS.md|CLAUDE.md|LICENSE) ;;
    *) die "fast web path rejected non-web change: ${path}" ;;
  esac
done
[[ "$has_web_change" == true ]] || die "candidate contains no web change"

printf 'Validating web at %s against production web %s\n' "$TARGET_SHA" "$BASE_SHA"
pnpm --dir apps/web test & test_pid=$!
pnpm --dir apps/web typecheck & typecheck_pid=$!
wait "$test_pid"
wait "$typecheck_pid"

docker buildx build --load --platform linux/amd64 \
  --file apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_AKL_BASE_PATH=/akb \
  --build-arg AKL_IMAGE_SERVICE=web \
  --label "org.opencontainers.image.revision=${TARGET_SHA}" \
  --label org.opencontainers.image.source=AI-KnowledgeBase \
  --label org.opencontainers.image.service=web \
  --tag "$WEB_IMAGE" . & web_build_pid=$!

docker buildx build --load --platform linux/amd64 \
  --file apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_AKL_BASE_PATH= \
  --build-arg AKL_IMAGE_SERVICE=chat-web \
  --label "org.opencontainers.image.revision=${TARGET_SHA}" \
  --label org.opencontainers.image.source=AI-KnowledgeBase \
  --label org.opencontainers.image.service=chat-web \
  --tag "$CHAT_IMAGE" . & chat_build_pid=$!

wait "$web_build_pid"
wait "$chat_build_pid"

docker save "$WEB_IMAGE" "$CHAT_IMAGE" | gzip -1 >"$LOCAL_ARCHIVE"
LOCAL_DIGEST="$(shasum -a 256 "$LOCAL_ARCHIVE" | awk '{print $1}')"
scp "${ssh_options[@]}" "$LOCAL_ARCHIVE" "${SSH_TARGET}:${REMOTE_TMP}"

remote bash -s -- "$TARGET_SHA" "$BASE_SHA" "$REMOTE_TMP" "$LOCAL_DIGEST" "$REMOTE_ENV" <<'REMOTE'
set -Eeuo pipefail
target_sha="$1"; base_sha="$2"; archive="$3"; expected_digest="$4"; env_file="$5"
actual_digest="$(sha256sum "$archive" | awk '{print $1}')"
[[ "$actual_digest" == "$expected_digest" ]]

old_web_image="$(docker inspect -f '{{.Image}}' akb-web-1)"
old_chat_image="$(docker inspect -f '{{.Image}}' akb-chat-web-1)"
compose_file="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' akb-web-1)"
compose_dir="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' akb-web-1)"
[[ -f "$compose_file" && -f "$env_file" && -d "$compose_dir" ]]

rollback() {
  cd "$compose_dir"
  WEB_IMAGE="$old_web_image" CHAT_WEB_IMAGE="$old_chat_image" AKL_SERVICE_VERSION="$base_sha" \
    docker compose --project-name akb --env-file "$env_file" -f "$compose_file" \
      up -d --no-deps --wait web chat-web || true
}
trap rollback ERR

docker load -i "$archive"
rm -f "$archive"

for spec in "akl/web:${target_sha}:web" "akl/chat-web:${target_sha}:chat-web"; do
  image_ref="${spec%:*}"; expected_service="${spec##*:}"
  revision="$(docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image_ref")"
  service="$(docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.service" }}' "$image_ref")"
  [[ "$revision" == "$target_sha" && "$service" == "$expected_service" ]]
done

cd "$compose_dir"
WEB_IMAGE="akl/web:${target_sha}" CHAT_WEB_IMAGE="akl/chat-web:${target_sha}" AKL_SERVICE_VERSION="$target_sha" \
  docker compose --project-name akb --env-file "$env_file" -f "$compose_file" \
    up -d --no-deps --wait web chat-web

for container in akb-web-1 akb-chat-web-1; do
  revision="$(docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$container")"
  health="$(docker inspect -f '{{.State.Health.Status}}' "$container")"
  [[ "$revision" == "$target_sha" && "$health" == healthy ]]
done

trap - ERR
record="/srv/akb/deployments/fast-web-$(date -u +%Y%m%dT%H%M%SZ)-${target_sha}.txt"
install -d -m 0750 /srv/akb/deployments
{
  printf 'mode=pre-pilot-fast-web\n'
  printf 'target_sha=%s\n' "$target_sha"
  printf 'previous_web_sha=%s\n' "$base_sha"
  printf 'activated_at=%s\n' "$(date -u +%FT%TZ)"
} >"$record"
chmod 0640 "$record"
REMOTE

curl --fail --silent --show-error https://stratos.zeleznalady.cz/akb/api/health >/dev/null
curl --fail --silent --show-error https://stratos.zeleznalady.cz/akb/api/ready >/dev/null
printf 'Fast web deployment complete: %s\n' "$TARGET_SHA"
