#!/usr/bin/env bash
set +x
# shellcheck shell=bash

akl_fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

akl_require_command() {
  command -v "$1" >/dev/null 2>&1 || akl_fail "Required command not found: $1"
}

akl_require_file() {
  [[ -f "$1" ]] || akl_fail "Required file not found: $1"
}

akl_validate_full_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || akl_fail "Git SHA must be the full 40-character lowercase commit id"
}

akl_validate_project_name() {
  [[ "$1" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || akl_fail "Invalid Docker Compose project name: $1"
}

akl_validate_exact_image_reference() {
  local image_reference="$1"
  if [[ "$image_reference" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    return 0
  fi
  [[ "$image_reference" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[0-9a-f]{64}$ \
    && "$image_reference" != *://* \
    && "$image_reference" != *//* ]] \
    || akl_fail "PostgreSQL tool image must be an exact name@sha256:<64 lowercase hex> digest or sha256:<64 lowercase hex> image ID"
}

akl_resolve_local_exact_image_id() {
  local image_reference="$1"
  local image_id repo_digests_json

  akl_validate_exact_image_reference "$image_reference"
  image_id="$(docker image inspect --format '{{.Id}}' "$image_reference" 2>/dev/null)" \
    || akl_fail "Exact PostgreSQL tool image is not present locally; load it before the maintenance window"
  [[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || akl_fail "Local PostgreSQL tool image returned an invalid image ID"

  if [[ "$image_reference" == sha256:* ]]; then
    [[ "$image_id" == "$image_reference" ]] \
      || akl_fail "Local PostgreSQL tool image ID does not match the configured exact ID"
  else
    repo_digests_json="$(docker image inspect --format '{{json .RepoDigests}}' "$image_reference")" \
      || akl_fail "Could not inspect the configured PostgreSQL tool image digest"
    python3 - "$repo_digests_json" "$image_reference" <<'PY' \
      || akl_fail "Configured PostgreSQL tool repository and digest do not match an exact local RepoDigest"
import json
import re
import sys

digests = json.loads(sys.argv[1])
configured = sys.argv[2]

def split_reference(reference: str) -> tuple[str, str]:
    if reference.count("@") != 1:
        raise ValueError("reference must contain exactly one digest separator")
    name, digest = reference.rsplit("@", 1)
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise ValueError("reference digest is invalid")
    slash = name.rfind("/")
    colon = name.rfind(":")
    if colon > slash:
        name = name[:colon]
    if not name or name.endswith("/"):
        raise ValueError("reference repository is invalid")
    return canonical_repository(name), digest

def canonical_repository(repository: str) -> str:
    if repository.startswith("docker.io/"):
        repository = repository[len("docker.io/"):]
    components = repository.split("/")
    if any(not component for component in components):
        raise ValueError("reference repository is invalid")
    first = components[0]
    if "." in first or ":" in first or first == "localhost":
        return repository
    if len(components) == 1:
        components.insert(0, "library")
    return "docker.io/" + "/".join(components)

try:
    expected = split_reference(configured)
except (TypeError, ValueError) as exc:
    raise SystemExit(f"configured PostgreSQL tool reference is invalid: {exc}") from exc

if not isinstance(digests, list):
    raise SystemExit("local RepoDigests metadata is not a list")
for candidate in digests:
    if not isinstance(candidate, str):
        continue
    try:
        if split_reference(candidate) == expected:
            break
    except ValueError:
        continue
else:
    raise SystemExit("configured PostgreSQL tool digest is not an exact local RepoDigest")
PY
  fi
  printf '%s\n' "$image_id"
}

akl_postgres_tool_version() {
  local image_reference="$1"
  local tool_name="$2"
  local version

  case "$tool_name" in
    psql|pg_dump|pg_restore) ;;
    *) akl_fail "Unsupported PostgreSQL release tool: $tool_name" ;;
  esac
  version="$(
    docker run \
      --rm \
      --pull never \
      --network host \
      --read-only \
      --cap-drop ALL \
      --security-opt no-new-privileges \
      --user "$(id -u):$(id -g)" \
      --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m \
      "$image_reference" \
      "$tool_name" --version
  )" || akl_fail "Could not execute $tool_name from the exact PostgreSQL tool image"
  [[ "$version" == *"PostgreSQL"* && "$version" != *$'\n'* && "$version" != *$'\r'* ]] \
    || akl_fail "$tool_name returned an invalid version string"
  printf '%s\n' "$version"
}

akl_fsync_file() {
  local path="$1"
  python3 - "$path" <<'PY'
# AKL_FSYNC_FILE
import os
import stat
import sys
from pathlib import Path

path = Path(sys.argv[1])
if path.is_symlink() or not stat.S_ISREG(path.lstat().st_mode):
    raise SystemExit(f"fsync target must be a regular file: {path}")
fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
try:
    os.fsync(fd)
finally:
    os.close(fd)
PY
}

akl_fsync_directory() {
  local path="$1"
  python3 - "$path" <<'PY'
# AKL_FSYNC_DIRECTORY
import os
import stat
import sys
from pathlib import Path

path = Path(sys.argv[1])
if path.is_symlink() or not stat.S_ISDIR(path.lstat().st_mode):
    raise SystemExit(f"fsync target must be a real directory: {path}")
fd = os.open(path, os.O_RDONLY)
try:
    os.fsync(fd)
finally:
    os.close(fd)
PY
}

akl_fsync_tree() {
  local root="$1"
  python3 - "$root" <<'PY'
# AKL_FSYNC_TREE
import os
import stat
import sys
from pathlib import Path

root = Path(sys.argv[1])
if root.is_symlink() or not stat.S_ISDIR(root.lstat().st_mode):
    raise SystemExit(f"fsync tree root must be a real directory: {root}")

directories = [root]
for directory, directory_names, file_names in os.walk(root, followlinks=False):
    directory_path = Path(directory)
    for name in directory_names:
        candidate = directory_path / name
        if not candidate.is_symlink():
            if not stat.S_ISDIR(candidate.lstat().st_mode):
                raise SystemExit(f"unsupported release tree path: {candidate}")
            directories.append(candidate)
    for name in file_names:
        candidate = directory_path / name
        if candidate.is_symlink():
            continue
        if not stat.S_ISREG(candidate.lstat().st_mode):
            raise SystemExit(f"unsupported release tree path: {candidate}")
        fd = os.open(candidate, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

for directory in sorted(directories, key=lambda item: len(item.parts), reverse=True):
    fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
PY
}

akl_publish_durable_file() {
  local source_path="$1"
  local destination_path="$2"
  local mode="$3"
  python3 - "$source_path" "$destination_path" "$mode" <<'PY'
# AKL_PUBLISH_DURABLE_FILE
import os
import stat
import sys
from pathlib import Path

source = Path(sys.argv[1])
destination = Path(sys.argv[2])
mode = int(sys.argv[3], 8)
if source.is_symlink() or not stat.S_ISREG(source.lstat().st_mode):
    raise SystemExit(f"durable source must be a regular file: {source}")
if source.parent.resolve() != destination.parent.resolve():
    raise SystemExit("durable replacement source and destination must share a parent")
if destination.is_symlink():
    raise SystemExit(f"durable destination must not be a symlink: {destination}")
os.chmod(source, mode)
fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
try:
    os.fsync(fd)
finally:
    os.close(fd)
os.replace(source, destination)
directory_fd = os.open(destination.parent, os.O_RDONLY)
try:
    os.fsync(directory_fd)
finally:
    os.close(directory_fd)
PY
}

akl_assert_release_sha_not_burned() {
  local release_root="$1"
  local target_sha="$2"
  akl_validate_full_sha "$target_sha"
  python3 - "${release_root}/state/burned-shas/${target_sha}" "$target_sha" <<'PY'
from datetime import datetime
import re
import stat
import sys
from pathlib import Path

marker = Path(sys.argv[1])
target_sha = sys.argv[2]
state_dir = marker.parent.parent
burn_dir = marker.parent
if not state_dir.exists() and not state_dir.is_symlink():
    raise SystemExit(0)
state_dir_stat = state_dir.lstat()
if not stat.S_ISDIR(state_dir_stat.st_mode) or state_dir.is_symlink():
    raise SystemExit("burned-SHA state path must be a real directory")
if stat.S_IMODE(state_dir_stat.st_mode) & 0o077:
    raise SystemExit("burned-SHA state directory must be private")
if not burn_dir.exists() and not burn_dir.is_symlink():
    raise SystemExit(0)
burn_dir_stat = burn_dir.lstat()
if not stat.S_ISDIR(burn_dir_stat.st_mode) or burn_dir.is_symlink():
    raise SystemExit("burned-SHA path must be a real directory")
if stat.S_IMODE(burn_dir_stat.st_mode) & 0o077:
    raise SystemExit("burned-SHA directory must be private")
if not marker.exists() and not marker.is_symlink():
    raise SystemExit(0)
marker_stat = marker.lstat()
if not stat.S_ISREG(marker_stat.st_mode) or marker_stat.st_nlink != 1:
    raise SystemExit("burned-SHA marker must be a single-link regular file")
if stat.S_IMODE(marker_stat.st_mode) != 0o600:
    raise SystemExit("burned-SHA marker must have mode 0600")
content = marker.read_bytes()
if not content.endswith(b"\n") or b"\r" in content or b"\0" in content:
    raise SystemExit("burned-SHA marker encoding is invalid")
try:
    lines = content.decode("utf-8").splitlines()
except UnicodeDecodeError as exc:
    raise SystemExit("burned-SHA marker encoding is invalid") from exc
expected_keys = ["schema_version", "target_sha", "reason", "burned_utc"]
if len(lines) != len(expected_keys):
    raise SystemExit("burned-SHA marker schema is invalid")
values: dict[str, str] = {}
for expected_key, line in zip(expected_keys, lines, strict=True):
    if "=" not in line:
        raise SystemExit("burned-SHA marker contains a malformed field")
    key, value = line.split("=", 1)
    if key != expected_key or key in values or not value:
        raise SystemExit("burned-SHA marker keys are invalid")
    values[key] = value
if values["schema_version"] != "1" or values["target_sha"] != target_sha:
    raise SystemExit("burned-SHA marker identity is invalid")
if values["reason"] not in {"build_may_have_started", "immutable_target_tag_exists"}:
    raise SystemExit("burned-SHA marker reason is invalid")
timestamp = values["burned_utc"]
if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", timestamp):
    raise SystemExit("burned-SHA marker timestamp is invalid")
try:
    datetime.strptime(timestamp, "%Y-%m-%dT%H:%M:%SZ")
except ValueError as exc:
    raise SystemExit("burned-SHA marker timestamp is invalid") from exc
raise SystemExit(f"target SHA is permanently burned for image creation: {target_sha}")
PY
}

akl_burn_release_sha() {
  local release_root="$1"
  local target_sha="$2"
  local reason="$3"
  local state_dir="${release_root}/state"
  local burn_dir="${state_dir}/burned-shas"
  local marker="${burn_dir}/${target_sha}"
  local marker_tmp

  akl_validate_full_sha "$target_sha"
  case "$reason" in
    build_may_have_started|immutable_target_tag_exists) ;;
    *) akl_fail "Invalid burned-SHA reason" ;;
  esac
  mkdir -p "$state_dir" "$burn_dir"
  python3 - "$state_dir" "$burn_dir" <<'PY'
import stat
import sys
from pathlib import Path

for raw_path in sys.argv[1:]:
    path = Path(raw_path)
    path_stat = path.lstat()
    if path.is_symlink() or not stat.S_ISDIR(path_stat.st_mode):
        raise SystemExit(f"burned-SHA state path must be a real directory: {path}")
    if stat.S_IMODE(path_stat.st_mode) & 0o077:
        raise SystemExit(f"burned-SHA state path must be private: {path}")
PY
  akl_fsync_directory "$release_root"
  akl_fsync_directory "$state_dir"
  [[ ! -e "$marker" && ! -L "$marker" ]] \
    || akl_fail "Target SHA already has a burned-SHA marker"
  marker_tmp="$(mktemp "${burn_dir}/.${target_sha}.tmp.XXXXXX")"
  printf 'schema_version=1\ntarget_sha=%s\nreason=%s\nburned_utc=%s\n' \
    "$target_sha" "$reason" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$marker_tmp"
  if ! akl_publish_durable_file "$marker_tmp" "$marker" 0600; then
    rm -f "$marker_tmp"
    return 1
  fi
}

akl_env_value() {
  local env_file="$1"
  local key="$2"
  local default_value="${3-}"

  if [[ -n "${AKL_RELEASE_ENV_SNAPSHOT_PATH:-}" ]]; then
    akl_assert_expected_env_snapshot "$env_file"
  fi

  python3 - "$env_file" "$key" "$default_value" <<'PY'
import os
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2]
default = sys.argv[3]
value = None
with path.open(encoding="utf-8") as handle:
    os.lseek(handle.fileno(), 0, os.SEEK_SET)
    content = handle.read()
    os.lseek(handle.fileno(), 0, os.SEEK_SET)
for raw_line in content.splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    candidate, raw_value = line.split("=", 1)
    if candidate.strip() == key:
        value = raw_value.strip().strip('"').strip("'")

print(default if value is None else value)
PY
}

akl_require_private_env_file() {
  local env_file="$1"
  if [[ -n "${AKL_RELEASE_ENV_SNAPSHOT_PATH:-}" ]]; then
    [[ "$env_file" == "$AKL_RELEASE_ENV_SNAPSHOT_PATH" ]] \
      || akl_fail "Production env snapshot path changed"
    akl_assert_expected_env_snapshot "$env_file"
    return 0
  fi
  akl_require_file "$env_file"
  python3 - "$env_file" <<'PY'
import os
import stat
import sys

path = sys.argv[1]
path_stat = os.lstat(path)
if os.path.islink(path) or not stat.S_ISREG(path_stat.st_mode):
    raise SystemExit(f"Production env path must be a regular file, not a symlink: {path}")
if path_stat.st_nlink != 1:
    raise SystemExit(f"Production env file must have exactly one link: {path}")
if path_stat.st_uid != os.geteuid():
    raise SystemExit(f"Production env file must be owned by the release operator: {path}")
mode = stat.S_IMODE(path_stat.st_mode)
if mode != 0o600:
    raise SystemExit(
        f"Production env file must have mode 0600: {path} mode={mode:04o}"
    )
PY
}

akl_require_private_secret_file() {
  local secret_file="$1"
  local minimum_length="${2:-1}"
  [[ "$minimum_length" =~ ^[1-9][0-9]*$ ]] \
    || akl_fail "Private secret minimum length is invalid"
  akl_require_file "$secret_file"
  python3 - "$secret_file" "$minimum_length" <<'PY'
import os
import stat
import sys

path = sys.argv[1]
minimum_length = int(sys.argv[2])
path_stat = os.lstat(path)
if os.path.islink(path) or not stat.S_ISREG(path_stat.st_mode):
    raise SystemExit(f"Private secret path must be a regular file, not a symlink: {path}")
if path_stat.st_nlink != 1:
    raise SystemExit(f"Private secret file must have exactly one link: {path}")
if path_stat.st_uid != os.geteuid():
    raise SystemExit(f"Private secret file must be owned by the release operator: {path}")
mode = stat.S_IMODE(path_stat.st_mode)
if mode != 0o600:
    raise SystemExit(f"Private secret file must have mode 0600: {path} mode={mode:04o}")
with open(path, "rb") as handle:
    secret = handle.read().strip()
if b"\0" in secret or len(secret) < minimum_length:
    raise SystemExit(f"Private secret file content is invalid or too short: {path}")
PY
}

akl_changed_supported_compose_services() {
  local current_compose_file="$1"
  local target_compose_file="$2"
  local changed_services

  akl_require_file "$current_compose_file"
  akl_require_file "$target_compose_file"
  changed_services="$(python3 - "$current_compose_file" "$target_compose_file" <<'PY'
import re
import sys
from pathlib import Path

SUPPORTED = (
    "registry-api",
    "ingestion-service",
    "rag-retrieval-service",
    "web",
)
SERVICE_HEADER = re.compile(r"^  ([a-z0-9][a-z0-9_-]*):(?:[ \t]*#[^\r\n]*)?\r?\n?$")
TOP_LEVEL = re.compile(r"^[A-Za-z0-9_.-]+:")


def split_compose(path: str):
    lines = Path(path).read_text(encoding="utf-8").splitlines(keepends=True)
    service_markers = [index for index, line in enumerate(lines) if line.rstrip("\r\n") == "services:"]
    if len(service_markers) != 1:
        raise SystemExit(f"production Compose must contain exactly one top-level services map: {path}")
    services_index = service_markers[0]
    if lines[services_index].startswith((" ", "\t")):
        raise SystemExit(f"production Compose services map is not top-level: {path}")

    end_index = len(lines)
    for index in range(services_index + 1, len(lines)):
        line = lines[index]
        if line.strip() and not line.startswith((" ", "\t", "#")):
            if not TOP_LEVEL.match(line):
                raise SystemExit(f"malformed top-level production Compose entry: {path}")
            end_index = index
            break

    headers = []
    for index in range(services_index + 1, end_index):
        match = SERVICE_HEADER.fullmatch(lines[index])
        if match:
            headers.append((index, match.group(1)))
    if not headers or headers[0][0] != services_index + 1:
        raise SystemExit(f"production Compose services map has an unsupported layout: {path}")
    names = [name for _, name in headers]
    if len(names) != len(set(names)):
        raise SystemExit(f"production Compose contains duplicate service names: {path}")

    top_level_comment_indexes = {
        index
        for index in range(services_index + 1, end_index)
        if lines[index].startswith("#")
    }

    blocks = {}
    for position, (start, name) in enumerate(headers):
        stop = headers[position + 1][0] if position + 1 < len(headers) else end_index
        blocks[name] = "".join(
            line
            for index, line in enumerate(lines[start:stop], start=start)
            if index not in top_level_comment_indexes
        )
    envelope = "".join(
        lines[: services_index + 1]
        + [lines[index] for index in sorted(top_level_comment_indexes)]
        + lines[end_index:]
    )
    return envelope, blocks


current_envelope, current_services = split_compose(sys.argv[1])
target_envelope, target_services = split_compose(sys.argv[2])
if current_envelope != target_envelope:
    raise SystemExit(
        "shared production Compose change modifies top-level configuration outside the four-service release boundary"
    )
if current_services.keys() != target_services.keys():
    raise SystemExit("shared production Compose change adds or removes a service")

changed = [
    name
    for name in target_services
    if current_services[name] != target_services[name]
]
unsupported = [name for name in changed if name not in SUPPORTED]
if unsupported:
    raise SystemExit(
        "shared production Compose change modifies unsupported service(s): "
        + ",".join(sorted(unsupported))
    )
if not changed:
    raise SystemExit(
        "shared production Compose change has no service-block change inside the four-service release boundary"
    )
for name in SUPPORTED:
    if name in changed:
        print(name)
PY
)" || akl_fail "Shared production Compose change is outside the coordinated four-service release boundary"
  [[ -n "$changed_services" ]] \
    || akl_fail "Shared production Compose change selected no managed service"
  printf '%s\n' "$changed_services"
}

akl_assert_private_env_snapshot_root() {
  local snapshot_root="$1"
  python3 - "$snapshot_root" <<'PY'
import os
import stat
import sys
from pathlib import Path

root = Path(sys.argv[1])
root_stat = root.lstat()
if root.is_symlink() or not stat.S_ISDIR(root_stat.st_mode):
    raise SystemExit(f"env snapshot root must be a real directory: {root}")
if root_stat.st_uid != os.geteuid() or stat.S_IMODE(root_stat.st_mode) != 0o700:
    raise SystemExit(f"env snapshot root must be operator-owned mode 0700: {root}")
PY
}

akl_assert_no_stale_private_env_snapshots() {
  local snapshot_root="$1"
  akl_assert_private_env_snapshot_root "$snapshot_root"
  python3 - "$snapshot_root" <<'PY'
import os
import sys
from pathlib import Path

root = Path(sys.argv[1])
stale = sorted(
    entry.name
    for entry in os.scandir(root)
    if entry.name.startswith(".akl-release-env.")
)
if stale:
    raise SystemExit(
        "stale private release env snapshot requires explicit recovery: "
        + ", ".join(str(root / name) for name in stale)
    )
PY
}

akl_create_private_env_snapshot() {
  local source_path="$1"
  local destination_path="$2"
  python3 - "$source_path" "$destination_path" <<'PY'
import os
import stat
import sys
from pathlib import Path

source = Path(sys.argv[1])
destination = Path(sys.argv[2])
parent = destination.parent
snapshot_root = parent.parent
euid = os.geteuid()
if source.parent != snapshot_root:
    raise SystemExit("env snapshot must be created below the canonical production env directory")
root_stat = snapshot_root.lstat()
if (
    snapshot_root.is_symlink()
    or not stat.S_ISDIR(root_stat.st_mode)
    or root_stat.st_uid != euid
    or stat.S_IMODE(root_stat.st_mode) != 0o700
):
    raise SystemExit("env snapshot root must be an operator-owned mode-0700 real directory")
parent_stat = parent.lstat()
if (
    parent.is_symlink()
    or not stat.S_ISDIR(parent_stat.st_mode)
    or parent_stat.st_uid != euid
    or stat.S_IMODE(parent_stat.st_mode) != 0o700
    or parent_stat.st_dev != root_stat.st_dev
):
    raise SystemExit("env snapshot parent must be an operator-owned mode-0700 real directory on the env filesystem")
if destination.name != "akl.prod.env":
    raise SystemExit("env snapshot destination name is invalid")
if os.path.lexists(destination):
    raise SystemExit("env snapshot destination already exists")

source_fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
try:
    source_stat_before = os.fstat(source_fd)
    if (
        not stat.S_ISREG(source_stat_before.st_mode)
        or source_stat_before.st_nlink != 1
        or source_stat_before.st_uid != euid
        or stat.S_IMODE(source_stat_before.st_mode) != 0o600
        or source_stat_before.st_dev != root_stat.st_dev
    ):
        raise SystemExit("production env source must be an operator-owned single-link mode-0600 regular file on the env filesystem")
    content = bytearray()
    while True:
        chunk = os.read(source_fd, 1024 * 1024)
        if not chunk:
            break
        content.extend(chunk)
    source_stat_after = os.fstat(source_fd)
    stable_fields_before = (
        source_stat_before.st_dev,
        source_stat_before.st_ino,
        source_stat_before.st_size,
        source_stat_before.st_mtime_ns,
        source_stat_before.st_ctime_ns,
    )
    stable_fields_after = (
        source_stat_after.st_dev,
        source_stat_after.st_ino,
        source_stat_after.st_size,
        source_stat_after.st_mtime_ns,
        source_stat_after.st_ctime_ns,
    )
    if stable_fields_before != stable_fields_after or len(content) != source_stat_after.st_size:
        raise SystemExit("production env source changed while the private snapshot was copied")
finally:
    os.close(source_fd)

directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
root_fd = os.open(snapshot_root, directory_flags)
parent_fd = None
destination_fd = None
destination_created = False
try:
    opened_root_stat = os.fstat(root_fd)
    if (
        not stat.S_ISDIR(opened_root_stat.st_mode)
        or opened_root_stat.st_dev != root_stat.st_dev
        or opened_root_stat.st_ino != root_stat.st_ino
        or opened_root_stat.st_uid != euid
        or stat.S_IMODE(opened_root_stat.st_mode) != 0o700
    ):
        raise SystemExit("env snapshot root identity changed while opening it")
    parent_fd = os.open(parent.name, directory_flags, dir_fd=root_fd)
    opened_parent_stat = os.fstat(parent_fd)
    if (
        not stat.S_ISDIR(opened_parent_stat.st_mode)
        or opened_parent_stat.st_dev != parent_stat.st_dev
        or opened_parent_stat.st_ino != parent_stat.st_ino
        or opened_parent_stat.st_uid != euid
        or stat.S_IMODE(opened_parent_stat.st_mode) != 0o700
    ):
        raise SystemExit("env snapshot parent identity changed while opening it")
    destination_fd = os.open(
        destination.name,
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_NOFOLLOW", 0),
        0o600,
        dir_fd=parent_fd,
    )
    destination_created = True
    destination_stat = os.fstat(destination_fd)
    if (
        not stat.S_ISREG(destination_stat.st_mode)
        or destination_stat.st_nlink != 1
        or destination_stat.st_uid != euid
        or stat.S_IMODE(destination_stat.st_mode) != 0o600
        or destination_stat.st_dev != root_stat.st_dev
    ):
        raise SystemExit("private env snapshot identity or filesystem is invalid")
    view = memoryview(content)
    while view:
        written = os.write(destination_fd, view)
        view = view[written:]
    os.fchmod(destination_fd, 0o600)
    os.fsync(destination_fd)
    os.fsync(parent_fd)
    os.fsync(root_fd)
except BaseException:
    if destination_fd is not None:
        os.close(destination_fd)
        destination_fd = None
    if destination_created:
        try:
            os.unlink(destination.name, dir_fd=parent_fd)
            os.fsync(parent_fd)
            os.fsync(root_fd)
        except FileNotFoundError:
            pass
    raise
finally:
    if destination_fd is not None:
        os.close(destination_fd)
    if parent_fd is not None:
        os.close(parent_fd)
    os.close(root_fd)
PY
}

akl_env_snapshot_identity() {
  local env_file="$1"
  python3 - "$env_file" <<'PY'
import hashlib
import os
import stat
import sys
from pathlib import Path

path = Path(sys.argv[1])
parent = path.parent
snapshot_root = parent.parent
euid = os.geteuid()
root_stat = snapshot_root.lstat()
if (
    snapshot_root.is_symlink()
    or not stat.S_ISDIR(root_stat.st_mode)
    or root_stat.st_uid != euid
    or stat.S_IMODE(root_stat.st_mode) != 0o700
):
    raise SystemExit("env snapshot root must be an operator-owned mode-0700 real directory")
parent_stat = parent.lstat()
if (
    parent.is_symlink()
    or not stat.S_ISDIR(parent_stat.st_mode)
    or parent_stat.st_uid != euid
    or stat.S_IMODE(parent_stat.st_mode) != 0o700
    or parent_stat.st_dev != root_stat.st_dev
):
    raise SystemExit("env snapshot parent must be an operator-owned mode-0700 real directory")
path_stat = path.lstat()
if (
    path.is_symlink()
    or not stat.S_ISREG(path_stat.st_mode)
    or path_stat.st_nlink != 1
    or path_stat.st_uid != euid
    or stat.S_IMODE(path_stat.st_mode) != 0o600
    or path_stat.st_dev != root_stat.st_dev
):
    raise SystemExit("env snapshot must be an operator-owned single-link mode-0600 regular file on the env filesystem")
fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
try:
    opened_stat = os.fstat(fd)
    digest = hashlib.sha256()
    while True:
        chunk = os.read(fd, 1024 * 1024)
        if not chunk:
            break
        digest.update(chunk)
finally:
    os.close(fd)
if (
    (opened_stat.st_dev, opened_stat.st_ino) != (path_stat.st_dev, path_stat.st_ino)
    or opened_stat.st_uid != euid
    or opened_stat.st_nlink != 1
    or stat.S_IMODE(opened_stat.st_mode) != 0o600
):
    raise SystemExit("env snapshot changed while its identity was captured")
print(
    f"{root_stat.st_dev}:{root_stat.st_ino}:"
    f"{parent_stat.st_dev}:{parent_stat.st_ino}:"
    f"{path_stat.st_dev}:{path_stat.st_ino}:{path_stat.st_size}:{digest.hexdigest()}"
)
PY
}

akl_assert_expected_env_snapshot() {
  local env_file="$1"
  local expected_device="${AKL_RELEASE_ENV_SNAPSHOT_DEVICE:-}"
  local expected_inode="${AKL_RELEASE_ENV_SNAPSHOT_INODE:-}"
  local expected_size="${AKL_RELEASE_ENV_SNAPSHOT_SIZE:-}"
  local expected_sha256="${AKL_RELEASE_ENV_SNAPSHOT_SHA256:-}"
  local expected_path="${AKL_RELEASE_ENV_SNAPSHOT_PATH:-}"
  local expected_dir="${AKL_RELEASE_ENV_SNAPSHOT_DIR:-}"
  local expected_dir_device="${AKL_RELEASE_ENV_SNAPSHOT_DIR_DEVICE:-}"
  local expected_dir_inode="${AKL_RELEASE_ENV_SNAPSHOT_DIR_INODE:-}"
  local expected_root="${AKL_RELEASE_ENV_SNAPSHOT_ROOT:-}"
  local expected_root_device="${AKL_RELEASE_ENV_SNAPSHOT_ROOT_DEVICE:-}"
  local expected_root_inode="${AKL_RELEASE_ENV_SNAPSHOT_ROOT_INODE:-}"

  if [[ -z "$expected_device" && -z "$expected_inode" \
    && -z "$expected_size" && -z "$expected_sha256" && -z "$expected_path" \
    && -z "$expected_dir" && -z "$expected_dir_device" && -z "$expected_dir_inode" \
    && -z "$expected_root" && -z "$expected_root_device" && -z "$expected_root_inode" ]]; then
    return 0
  fi
  [[ "$expected_device" =~ ^[0-9]+$ \
    && "$expected_inode" =~ ^[0-9]+$ \
    && "$expected_size" =~ ^[0-9]+$ \
    && "$expected_sha256" =~ ^[0-9a-f]{64}$ \
    && "$expected_dir_device" =~ ^[0-9]+$ \
    && "$expected_dir_inode" =~ ^[0-9]+$ \
    && "$expected_root_device" =~ ^[0-9]+$ \
    && "$expected_root_inode" =~ ^[0-9]+$ \
    && "$env_file" == "$expected_path" \
    && "$expected_path" == "${expected_dir}/akl.prod.env" ]] \
    || akl_fail "Env snapshot identity contract is incomplete or invalid"

  python3 - \
    "$env_file" \
    "$expected_path" \
    "$expected_dir" \
    "$expected_dir_device" \
    "$expected_dir_inode" \
    "$expected_root" \
    "$expected_root_device" \
    "$expected_root_inode" \
    "$expected_device" \
    "$expected_inode" \
    "$expected_size" \
    "$expected_sha256" <<'PY'
import hashlib
import os
import stat
import sys
from pathlib import Path

path = Path(sys.argv[1])
expected_path = Path(sys.argv[2])
directory = Path(sys.argv[3])
expected_directory_device = int(sys.argv[4])
expected_directory_inode = int(sys.argv[5])
root = Path(sys.argv[6])
expected_root_device = int(sys.argv[7])
expected_root_inode = int(sys.argv[8])
expected_device = int(sys.argv[9])
expected_inode = int(sys.argv[10])
expected_size = int(sys.argv[11])
expected_digest = sys.argv[12]
euid = os.geteuid()
if path != expected_path or path.parent != directory or directory.parent != root:
    raise SystemExit("env snapshot path contract changed")
root_stat = root.lstat()
if (
    root.is_symlink()
    or not stat.S_ISDIR(root_stat.st_mode)
    or root_stat.st_uid != euid
    or stat.S_IMODE(root_stat.st_mode) != 0o700
    or (root_stat.st_dev, root_stat.st_ino) != (expected_root_device, expected_root_inode)
):
    raise SystemExit("env snapshot root identity changed")
directory_stat = directory.lstat()
if (
    directory.is_symlink()
    or not stat.S_ISDIR(directory_stat.st_mode)
    or directory_stat.st_uid != euid
    or stat.S_IMODE(directory_stat.st_mode) != 0o700
    or (directory_stat.st_dev, directory_stat.st_ino) != (expected_directory_device, expected_directory_inode)
    or directory_stat.st_dev != root_stat.st_dev
):
    raise SystemExit("env snapshot directory identity changed")
path_stat = path.lstat()
if (
    path.is_symlink()
    or not stat.S_ISREG(path_stat.st_mode)
    or path_stat.st_uid != euid
    or path_stat.st_nlink != 1
    or stat.S_IMODE(path_stat.st_mode) != 0o600
    or (path_stat.st_dev, path_stat.st_ino) != (expected_device, expected_inode)
    or path_stat.st_dev != root_stat.st_dev
):
    raise SystemExit("env snapshot path identity changed")
fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
try:
    opened_stat = os.fstat(fd)
    digest = hashlib.sha256()
    while True:
        chunk = os.read(fd, 1024 * 1024)
        if not chunk:
            break
        digest.update(chunk)
finally:
    os.close(fd)
if (
    not stat.S_ISREG(opened_stat.st_mode)
    or opened_stat.st_nlink != 1
    or opened_stat.st_uid != euid
    or stat.S_IMODE(opened_stat.st_mode) != 0o600
    or opened_stat.st_dev != expected_device
    or opened_stat.st_ino != expected_inode
    or opened_stat.st_size != expected_size
    or digest.hexdigest() != expected_digest
):
    raise SystemExit("env snapshot content or inode changed")
PY
}

akl_cleanup_expected_env_snapshot() {
  local env_file="$1"
  akl_assert_expected_env_snapshot "$env_file"
  python3 - \
    "$AKL_RELEASE_ENV_SNAPSHOT_ROOT" \
    "$AKL_RELEASE_ENV_SNAPSHOT_ROOT_DEVICE" \
    "$AKL_RELEASE_ENV_SNAPSHOT_ROOT_INODE" \
    "$AKL_RELEASE_ENV_SNAPSHOT_DIR" \
    "$AKL_RELEASE_ENV_SNAPSHOT_DIR_DEVICE" \
    "$AKL_RELEASE_ENV_SNAPSHOT_DIR_INODE" \
    "$AKL_RELEASE_ENV_SNAPSHOT_PATH" \
    "$AKL_RELEASE_ENV_SNAPSHOT_DEVICE" \
    "$AKL_RELEASE_ENV_SNAPSHOT_INODE" \
    "$AKL_RELEASE_ENV_SNAPSHOT_SIZE" \
    "$AKL_RELEASE_ENV_SNAPSHOT_SHA256" <<'PY'
import hashlib
import os
import stat
import sys
from pathlib import Path

root = Path(sys.argv[1])
expected_root_identity = (int(sys.argv[2]), int(sys.argv[3]))
directory = Path(sys.argv[4])
expected_directory_identity = (int(sys.argv[5]), int(sys.argv[6]))
snapshot = Path(sys.argv[7])
expected_file_identity = (int(sys.argv[8]), int(sys.argv[9]))
expected_size = int(sys.argv[10])
expected_digest = sys.argv[11]
euid = os.geteuid()
if directory.parent != root or snapshot.parent != directory or snapshot.name != "akl.prod.env":
    raise SystemExit("env snapshot cleanup path contract is invalid")
flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
root_fd = os.open(root, flags)
directory_fd = None
file_fd = None
try:
    root_stat = os.fstat(root_fd)
    if (
        not stat.S_ISDIR(root_stat.st_mode)
        or root_stat.st_uid != euid
        or stat.S_IMODE(root_stat.st_mode) != 0o700
        or (root_stat.st_dev, root_stat.st_ino) != expected_root_identity
    ):
        raise SystemExit("env snapshot cleanup root identity changed")
    directory_fd = os.open(directory.name, flags, dir_fd=root_fd)
    directory_stat = os.fstat(directory_fd)
    if (
        not stat.S_ISDIR(directory_stat.st_mode)
        or directory_stat.st_uid != euid
        or stat.S_IMODE(directory_stat.st_mode) != 0o700
        or (directory_stat.st_dev, directory_stat.st_ino) != expected_directory_identity
        or directory_stat.st_dev != root_stat.st_dev
    ):
        raise SystemExit("env snapshot cleanup directory identity changed")
    if sorted(os.listdir(directory_fd)) != [snapshot.name]:
        raise SystemExit("env snapshot cleanup directory contains unexpected entries")
    file_fd = os.open(snapshot.name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=directory_fd)
    file_stat = os.fstat(file_fd)
    digest = hashlib.sha256()
    while True:
        chunk = os.read(file_fd, 1024 * 1024)
        if not chunk:
            break
        digest.update(chunk)
    if (
        not stat.S_ISREG(file_stat.st_mode)
        or file_stat.st_uid != euid
        or file_stat.st_nlink != 1
        or stat.S_IMODE(file_stat.st_mode) != 0o600
        or (file_stat.st_dev, file_stat.st_ino) != expected_file_identity
        or file_stat.st_size != expected_size
        or digest.hexdigest() != expected_digest
    ):
        raise SystemExit("env snapshot cleanup file identity changed")
    os.close(file_fd)
    file_fd = None
    os.unlink(snapshot.name, dir_fd=directory_fd)
    os.fsync(directory_fd)
    os.close(directory_fd)
    directory_fd = None
    os.rmdir(directory.name, dir_fd=root_fd)
    os.fsync(root_fd)
finally:
    if file_fd is not None:
        os.close(file_fd)
    if directory_fd is not None:
        os.close(directory_fd)
    os.close(root_fd)
PY
}

akl_cleanup_stale_private_env_snapshot() {
  local snapshot_root="$1"
  local snapshot_dir="$2"
  python3 - "$snapshot_root" "$snapshot_dir" <<'PY'
import hashlib
import os
import re
import stat
import sys
from pathlib import Path

root = Path(sys.argv[1])
directory = Path(sys.argv[2])
euid = os.geteuid()
if directory.parent != root or not re.fullmatch(r"\.akl-release-env\.[0-9a-f]{40}\.[A-Za-z0-9]+", directory.name):
    raise SystemExit("stale env snapshot recovery path is outside the narrow release pattern")
flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
root_fd = os.open(root, flags)
directory_fd = None
file_fd = None
try:
    root_stat = os.fstat(root_fd)
    if not stat.S_ISDIR(root_stat.st_mode) or root_stat.st_uid != euid or stat.S_IMODE(root_stat.st_mode) != 0o700:
        raise SystemExit("stale env snapshot root must be operator-owned mode 0700")
    directory_fd = os.open(directory.name, flags, dir_fd=root_fd)
    directory_stat = os.fstat(directory_fd)
    if (
        not stat.S_ISDIR(directory_stat.st_mode)
        or directory_stat.st_uid != euid
        or stat.S_IMODE(directory_stat.st_mode) != 0o700
        or directory_stat.st_dev != root_stat.st_dev
    ):
        raise SystemExit("stale env snapshot directory identity is unsafe")
    entries = sorted(os.listdir(directory_fd))
    if entries not in ([], ["akl.prod.env"]):
        raise SystemExit("stale env snapshot directory contains unexpected entries")
    if entries:
        file_fd = os.open("akl.prod.env", os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=directory_fd)
        file_stat = os.fstat(file_fd)
        digest = hashlib.sha256()
        while True:
            chunk = os.read(file_fd, 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
        if (
            not stat.S_ISREG(file_stat.st_mode)
            or file_stat.st_uid != euid
            or file_stat.st_nlink != 1
            or stat.S_IMODE(file_stat.st_mode) != 0o600
            or file_stat.st_dev != root_stat.st_dev
        ):
            raise SystemExit("stale env snapshot file identity is unsafe")
        os.close(file_fd)
        file_fd = None
        os.unlink("akl.prod.env", dir_fd=directory_fd)
        os.fsync(directory_fd)
    os.close(directory_fd)
    directory_fd = None
    os.rmdir(directory.name, dir_fd=root_fd)
    os.fsync(root_fd)
finally:
    if file_fd is not None:
        os.close(file_fd)
    if directory_fd is not None:
        os.close(directory_fd)
    os.close(root_fd)
PY
}

akl_postgres_credentials_dir_path() {
  local release_root="$1"
  local deployment_id="$2"
  local purpose="$3"

  akl_validate_deployment_id "$deployment_id"
  [[ "$purpose" =~ ^[a-z0-9][a-z0-9-]*$ ]] \
    || akl_fail "PostgreSQL credential purpose is invalid"
  printf '%s\n' \
    "${release_root}/state/postgres-credentials/${deployment_id}--${purpose}"
}

akl_assert_no_stale_private_postgres_credentials() {
  local release_root="$1"
  python3 - "$release_root" <<'PY'
import os
import stat
import sys
from pathlib import Path

release_root = Path(sys.argv[1])
state_dir = release_root / "state"
credentials_root = state_dir / "postgres-credentials"
euid = os.geteuid()

if not credentials_root.exists() and not credentials_root.is_symlink():
    raise SystemExit(0)
for path, label, required_private in (
    (release_root, "release root", False),
    (state_dir, "release state", True),
    (credentials_root, "PostgreSQL credential root", True),
):
    path_stat = path.lstat()
    if path.is_symlink() or not stat.S_ISDIR(path_stat.st_mode):
        raise SystemExit(f"{label} must be a real directory")
    forbidden_mode = 0o077 if required_private else 0o022
    if path_stat.st_uid != euid or stat.S_IMODE(path_stat.st_mode) & forbidden_mode:
        raise SystemExit(f"{label} has unsafe ownership or mode")
    if required_private and path == credentials_root and stat.S_IMODE(path_stat.st_mode) != 0o700:
        raise SystemExit(f"{label} must have mode 0700")

entries = sorted(entry.name for entry in os.scandir(credentials_root))
if entries:
    raise SystemExit(
        "stale private PostgreSQL credentials require explicit recovery: "
        + ", ".join(str(credentials_root / name) for name in entries)
    )
PY
}

akl_create_private_postgres_credentials_dir() {
  local release_root="$1"
  local deployment_id="$2"
  local purpose="$3"
  local credentials_dir

  credentials_dir="$(
    akl_postgres_credentials_dir_path "$release_root" "$deployment_id" "$purpose"
  )"
  python3 - "$release_root" "$credentials_dir" "$deployment_id" "$purpose" <<'PY'
import datetime as dt
import os
import stat
import sys
from pathlib import Path

release_root = Path(sys.argv[1])
credentials_dir = Path(sys.argv[2])
deployment_id = sys.argv[3]
purpose = sys.argv[4]
state_dir = release_root / "state"
credentials_root = state_dir / "postgres-credentials"
euid = os.geteuid()

for path in (release_root, state_dir):
    if path.exists() or path.is_symlink():
        path_stat = path.lstat()
        if (
            path.is_symlink()
            or not stat.S_ISDIR(path_stat.st_mode)
            or path_stat.st_uid != euid
            or stat.S_IMODE(path_stat.st_mode) & (0o022 if path == release_root else 0o077)
        ):
            raise SystemExit("PostgreSQL credential parent is not a trusted private directory")
    else:
        path.mkdir(mode=0o700)
        parent_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)

if credentials_root.exists() or credentials_root.is_symlink():
    root_stat = credentials_root.lstat()
    if (
        credentials_root.is_symlink()
        or not stat.S_ISDIR(root_stat.st_mode)
        or root_stat.st_uid != euid
        or stat.S_IMODE(root_stat.st_mode) != 0o700
    ):
        raise SystemExit("PostgreSQL credential root is not an operator-owned mode-0700 directory")
else:
    credentials_root.mkdir(mode=0o700)
    state_fd = os.open(state_dir, os.O_RDONLY)
    try:
        os.fsync(state_fd)
    finally:
        os.close(state_fd)

if credentials_dir.parent != credentials_root:
    raise SystemExit("PostgreSQL credential path escaped its private root")

flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
release_fd = os.open(release_root, flags)
state_fd = None
root_fd = None
directory_fd = None
evidence_fd = None
try:
    release_stat = os.fstat(release_fd)
    if (
        not stat.S_ISDIR(release_stat.st_mode)
        or release_stat.st_uid != euid
        or stat.S_IMODE(release_stat.st_mode) & 0o022
    ):
        raise SystemExit("PostgreSQL credential release root identity is unsafe")
    state_fd = os.open("state", flags, dir_fd=release_fd)
    state_stat = os.fstat(state_fd)
    if (
        not stat.S_ISDIR(state_stat.st_mode)
        or state_stat.st_uid != euid
        or stat.S_IMODE(state_stat.st_mode) != 0o700
        or state_stat.st_dev != release_stat.st_dev
    ):
        raise SystemExit("PostgreSQL credential state directory identity is unsafe")
    root_fd = os.open("postgres-credentials", flags, dir_fd=state_fd)
    root_stat = os.fstat(root_fd)
    if (
        not stat.S_ISDIR(root_stat.st_mode)
        or root_stat.st_uid != euid
        or stat.S_IMODE(root_stat.st_mode) != 0o700
        or root_stat.st_dev != state_stat.st_dev
    ):
        raise SystemExit("PostgreSQL credential root identity is unsafe")
    if os.listdir(root_fd):
        raise SystemExit("stale private PostgreSQL credentials require explicit recovery")
    os.mkdir(credentials_dir.name, mode=0o700, dir_fd=root_fd)
    os.fsync(root_fd)
    directory_fd = os.open(
        credentials_dir.name,
        os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
        dir_fd=root_fd,
    )
    evidence_fd = os.open(
        "evidence.env",
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
        0o600,
        dir_fd=directory_fd,
    )
    timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    evidence = (
        "schema_version=1\n"
        f"deployment_id={deployment_id}\n"
        f"purpose={purpose}\n"
        f"creator_pid={os.getppid()}\n"
        f"created_utc={timestamp}\n"
    ).encode("utf-8")
    os.write(evidence_fd, evidence)
    os.fsync(evidence_fd)
    os.fsync(directory_fd)
finally:
    if evidence_fd is not None:
        os.close(evidence_fd)
    if directory_fd is not None:
        os.close(directory_fd)
    if root_fd is not None:
        os.close(root_fd)
    if state_fd is not None:
        os.close(state_fd)
    os.close(release_fd)
PY
}

akl_cleanup_private_postgres_credentials_dir() {
  local release_root="$1"
  local credentials_dir="$2"
  python3 - "$release_root" "$credentials_dir" <<'PY'
import os
import re
import stat
import sys
from pathlib import Path

release_root = Path(sys.argv[1])
credentials_dir = Path(sys.argv[2])
state_dir = release_root / "state"
credentials_root = state_dir / "postgres-credentials"
euid = os.geteuid()

if credentials_dir.parent != credentials_root or not re.fullmatch(
    r"[0-9A-Za-z._:-]+--[a-z0-9][a-z0-9-]*", credentials_dir.name
):
    raise SystemExit("PostgreSQL credential cleanup path is invalid")

flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
release_fd = os.open(release_root, flags)
state_fd = None
root_fd = None
directory_fd = None
try:
    release_stat = os.fstat(release_fd)
    if (
        not stat.S_ISDIR(release_stat.st_mode)
        or release_stat.st_uid != euid
        or stat.S_IMODE(release_stat.st_mode) & 0o022
    ):
        raise SystemExit("PostgreSQL credential cleanup release root identity is unsafe")
    state_fd = os.open("state", flags, dir_fd=release_fd)
    state_stat = os.fstat(state_fd)
    if (
        not stat.S_ISDIR(state_stat.st_mode)
        or state_stat.st_uid != euid
        or stat.S_IMODE(state_stat.st_mode) != 0o700
        or state_stat.st_dev != release_stat.st_dev
    ):
        raise SystemExit("PostgreSQL credential cleanup state identity is unsafe")
    root_fd = os.open("postgres-credentials", flags, dir_fd=state_fd)
    root_stat = os.fstat(root_fd)
    if (
        not stat.S_ISDIR(root_stat.st_mode)
        or root_stat.st_uid != euid
        or stat.S_IMODE(root_stat.st_mode) != 0o700
        or root_stat.st_dev != state_stat.st_dev
    ):
        raise SystemExit("PostgreSQL credential root identity is unsafe")
    directory_fd = os.open(credentials_dir.name, flags, dir_fd=root_fd)
    directory_stat = os.fstat(directory_fd)
    if (
        not stat.S_ISDIR(directory_stat.st_mode)
        or directory_stat.st_uid != euid
        or stat.S_IMODE(directory_stat.st_mode) != 0o700
        or directory_stat.st_dev != root_stat.st_dev
    ):
        raise SystemExit("PostgreSQL credential directory identity is unsafe")

    allowed = {"evidence.env", "identity.env", "pgpass"}
    entries = sorted(os.listdir(directory_fd))
    if any(name not in allowed for name in entries):
        raise SystemExit("PostgreSQL credential directory contains unexpected entries")
    for name in entries:
        file_fd = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=directory_fd)
        try:
            file_stat = os.fstat(file_fd)
            if (
                not stat.S_ISREG(file_stat.st_mode)
                or file_stat.st_uid != euid
                or file_stat.st_nlink != 1
                or stat.S_IMODE(file_stat.st_mode) != 0o600
                or file_stat.st_dev != root_stat.st_dev
            ):
                raise SystemExit("PostgreSQL credential file identity is unsafe")
        finally:
            os.close(file_fd)
    for name in entries:
        os.unlink(name, dir_fd=directory_fd)
    os.fsync(directory_fd)
    os.close(directory_fd)
    directory_fd = None
    os.rmdir(credentials_dir.name, dir_fd=root_fd)
    os.fsync(root_fd)
finally:
    if directory_fd is not None:
        os.close(directory_fd)
    if root_fd is not None:
        os.close(root_fd)
    if state_fd is not None:
        os.close(state_fd)
    os.close(release_fd)
PY
}

akl_assert_no_ambient_env_file_overrides() {
  local env_file="$1"
  if [[ -n "${AKL_RELEASE_ENV_SNAPSHOT_PATH:-}" ]]; then
    akl_assert_expected_env_snapshot "$env_file"
  fi
  python3 - "$env_file" <<'PY'
import os
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
keys: set[str] = set()
with path.open(encoding="utf-8") as handle:
    os.lseek(handle.fileno(), 0, os.SEEK_SET)
    content = handle.read()
    os.lseek(handle.fileno(), 0, os.SEEK_SET)
for line_number, raw_line in enumerate(content.splitlines(), 1):
    line = raw_line.strip()
    if not line or line.startswith("#"):
        continue
    if "=" not in line:
        raise SystemExit(
            f"production env contains a non-hermetic bare key at line {line_number}"
        )
    raw_key, raw_value = line.split("=", 1)
    key = raw_key.strip()
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
        raise SystemExit(f"production env contains an invalid key at line {line_number}")
    if key in keys:
        raise SystemExit(f"production env contains a duplicate key: {key}")
    if "$" in raw_value:
        raise SystemExit(
            f"production env values must be literal and must not contain Compose interpolation at line {line_number}"
        )
    keys.add(key)

collisions = sorted(key for key in keys if key in os.environ)
if collisions:
    raise SystemExit(
        "ambient environment overrides production env-file keys; unset: "
        + ", ".join(collisions)
    )
PY
}

akl_assert_hermetic_git_environment() {
  python3 <<'PY'
import os

# Display-only pager configuration cannot change Git object identity. Every
# other GIT_* input is rejected instead of trying to maintain an incomplete
# deny-list for repository discovery, config injection, alternates or replace
# refs.
allowed = {"GIT_PAGER"}
dangerous = sorted(
    key for key in os.environ
    if key.startswith("GIT_") and key not in allowed
)
if dangerous:
    raise SystemExit(
        "ambient Git environment is not permitted for immutable release provenance; unset: "
        + ", ".join(dangerous)
    )
PY
}

akl_assert_local_docker_daemon_environment() {
  local context_name endpoint
  python3 <<'PY'
import os

routing_keys = {
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_CONFIG",
    "DOCKER_TLS",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
}
collisions = sorted(key for key in routing_keys if key in os.environ)
if collisions:
    raise SystemExit(
        "ambient Docker daemon routing is forbidden for immutable production releases; unset: "
        + ", ".join(collisions)
    )
PY
  context_name="$(docker context show)" \
    || akl_fail "Could not determine the Docker context"
  [[ "$context_name" == "default" ]] \
    || akl_fail "Immutable production releases require the local default Docker context"
  endpoint="$(docker context inspect default --format '{{.Endpoints.docker.Host}}')" \
    || akl_fail "Could not inspect the default Docker endpoint"
  [[ "$endpoint" == "unix:///var/run/docker.sock" ]] \
    || akl_fail "Immutable production releases require unix:///var/run/docker.sock"
}

akl_assert_git_mirror_has_no_replace_refs() {
  local git_dir="$1"
  local replace_refs
  replace_refs="$(
    git --no-replace-objects --git-dir="$git_dir" \
      for-each-ref --format='%(refname)' refs/replace/
  )" || akl_fail "Could not inspect release Git replace refs"
  [[ -z "$replace_refs" ]] \
    || akl_fail "Release Git mirror contains forbidden refs/replace provenance overrides"
}

akl_assert_git_mirror_is_self_contained() {
  local git_dir="$1"
  local include_config config_status
  python3 - "$git_dir" <<'PY' \
    || akl_fail "Release Git mirror contains unsafe object/ref provenance paths"
import os
import stat
import sys
from pathlib import Path

git_dir = Path(sys.argv[1])
euid = os.geteuid()


def lexists(path: Path) -> bool:
    return os.path.lexists(path)


for forbidden in (
    git_dir / "objects" / "info" / "alternates",
    git_dir / "objects" / "info" / "http-alternates",
    git_dir / "info" / "grafts",
    git_dir / "shallow",
    git_dir / "commondir",
    git_dir / "gitdir",
):
    if lexists(forbidden):
        raise SystemExit(f"release Git mirror contains forbidden external or incomplete object metadata: {forbidden}")

for root_name in ("objects", "refs"):
    root = git_dir / root_name
    root_stat = root.lstat()
    if root.is_symlink() or not stat.S_ISDIR(root_stat.st_mode):
        raise SystemExit(f"release Git mirror {root_name} must be a real directory")
    for directory, directory_names, file_names in os.walk(root, followlinks=False):
        directory_path = Path(directory)
        directory_stat = directory_path.lstat()
        if (
            directory_path.is_symlink()
            or not stat.S_ISDIR(directory_stat.st_mode)
            or directory_stat.st_uid != euid
            or stat.S_IMODE(directory_stat.st_mode) & 0o022
        ):
            raise SystemExit(f"release Git mirror directory is not trusted: {directory_path}")
        for name in [*directory_names, *file_names]:
            candidate = directory_path / name
            candidate_stat = candidate.lstat()
            if stat.S_ISLNK(candidate_stat.st_mode):
                raise SystemExit(f"release Git mirror contains a forbidden symlink: {candidate}")
            if candidate_stat.st_uid != euid or stat.S_IMODE(candidate_stat.st_mode) & 0o022:
                raise SystemExit(f"release Git mirror path has unsafe ownership or mode: {candidate}")
            if stat.S_ISREG(candidate_stat.st_mode):
                if candidate_stat.st_nlink != 1:
                    raise SystemExit(f"release Git mirror file is hard-linked: {candidate}")
            elif not stat.S_ISDIR(candidate_stat.st_mode):
                raise SystemExit(f"release Git mirror path has an unsupported type: {candidate}")

for metadata in (git_dir / "HEAD", git_dir / "config", git_dir / "packed-refs"):
    if not lexists(metadata):
        continue
    metadata_stat = metadata.lstat()
    if (
        metadata.is_symlink()
        or not stat.S_ISREG(metadata_stat.st_mode)
        or metadata_stat.st_nlink != 1
        or metadata_stat.st_uid != euid
        or stat.S_IMODE(metadata_stat.st_mode) & 0o022
    ):
        raise SystemExit(f"release Git mirror metadata is not trusted: {metadata}")
PY

  if include_config="$(
    git --no-replace-objects --git-dir="$git_dir" \
      config --local --get-regexp '^(include|includeIf)\.' 2>/dev/null
  )"; then
    [[ -z "$include_config" ]] \
      || akl_fail "Release Git mirror config contains forbidden external includes"
  else
    config_status=$?
    [[ "$config_status" -eq 1 ]] \
      || akl_fail "Could not inspect release Git mirror config includes"
  fi
}

akl_assert_no_ambient_compose_overrides() {
  local compose_file="$1"
  shift
  python3 - "$compose_file" "$@" <<'PY'
import os
import re
import sys
from pathlib import Path

compose_path = Path(sys.argv[1])
allowed = set(sys.argv[2:])
content = compose_path.read_text(encoding="utf-8")
braced = re.compile(r"(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)[^}]*\}")
plain = re.compile(r"(?<!\$)\$(?!\$|\{)([A-Za-z_][A-Za-z0-9_]*)")
variables = {match.group(1) for match in braced.finditer(content)}
variables.update(match.group(1) for match in plain.finditer(content))
collisions = sorted(
    variable for variable in variables
    if variable in os.environ and variable not in allowed
)
if collisions:
    raise SystemExit(
        "ambient environment overrides target Compose interpolation; unset: "
        + ", ".join(collisions)
    )
PY
}

akl_require_read_only_release_tree() {
  local release_dir="$1"
  python3 - "$release_dir" <<'PY'
import os
import sys
from pathlib import Path

root = Path(sys.argv[1])
for directory, directory_names, file_names in os.walk(root, followlinks=False):
    for name in [*directory_names, *file_names]:
        candidate = Path(directory) / name
        if candidate.is_symlink():
            continue
        if candidate.lstat().st_mode & 0o222:
            raise SystemExit(f"release path is writable: {candidate}")
if root.lstat().st_mode & 0o222:
    raise SystemExit(f"release path is writable: {root}")
PY
}

akl_runtime_marker_value() {
  local release_root="$1"
  local key="$2"
  python3 - "$release_root" "$key" <<'PY'
import os
import re
import stat
import sys
from pathlib import Path

marker = Path(sys.argv[1]) / "state" / "applied-runtime.env"
key = sys.argv[2]
required = {
    "schema_version",
    "applied_sha",
    "state",
    "phase",
    "services",
    "migration_started",
    "deployment_id",
    "updated_utc",
}
if key not in required:
    raise SystemExit(f"unsupported runtime marker key: {key}")
if not marker.exists() and not marker.is_symlink():
    raise SystemExit(0)
if marker.is_symlink() or not stat.S_ISREG(marker.lstat().st_mode):
    raise SystemExit(f"runtime marker must be a regular file: {marker}")
mode = stat.S_IMODE(marker.stat().st_mode)
if mode != 0o600:
    raise SystemExit(f"runtime marker must have mode 0600: {marker} mode={mode:04o}")

values: dict[str, str] = {}
for raw_line in marker.read_text(encoding="utf-8").splitlines():
    if not raw_line or "=" not in raw_line:
        raise SystemExit("runtime marker contains an invalid line")
    candidate, value = raw_line.split("=", 1)
    if candidate in values:
        raise SystemExit(f"runtime marker contains a duplicate key: {candidate}")
    values[candidate] = value
if set(values) != required:
    raise SystemExit("runtime marker keys do not match the required schema")
if values["schema_version"] != "1":
    raise SystemExit("runtime marker schema version is unsupported")
if not re.fullmatch(r"[0-9a-f]{40}", values["applied_sha"]):
    raise SystemExit("runtime marker applied SHA is invalid")
if values["state"] not in {"applying", "failed", "verified"}:
    raise SystemExit("runtime marker state is invalid")
if values["phase"] not in {
    "seeded",
    "migrating",
    "migrated",
    "restarting",
    "verifying",
    "verified",
}:
    raise SystemExit("runtime marker phase is invalid")
if not re.fullmatch(r"(?:none|legacy|(?:registry-api|ingestion-service|rag-retrieval-service|web)(?:,(?:registry-api|ingestion-service|rag-retrieval-service|web))*)", values["services"]):
    raise SystemExit("runtime marker services are invalid")
if values["migration_started"] not in {"true", "false"}:
    raise SystemExit("runtime marker migration flag is invalid")
if not re.fullmatch(r"[0-9A-Za-z._:-]+", values["deployment_id"]):
    raise SystemExit("runtime marker deployment id is invalid")
if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", values["updated_utc"]):
    raise SystemExit("runtime marker timestamp is invalid")
print(values[key])
PY
}

akl_write_runtime_marker() {
  local release_root="$1"
  local applied_sha="$2"
  local state="$3"
  local phase="$4"
  local services="$5"
  local migration_started="$6"
  local deployment_id="$7"

  akl_validate_full_sha "$applied_sha"
  python3 - \
    "$release_root" \
    "$applied_sha" \
    "$state" \
    "$phase" \
    "$services" \
    "$migration_started" \
    "$deployment_id" <<'PY'
import datetime as dt
import os
import re
import stat
import sys
from pathlib import Path

release_root, applied_sha, state, phase, services, migration_started, deployment_id = sys.argv[1:]
if state not in {"applying", "failed", "verified"}:
    raise SystemExit("invalid runtime marker state")
if phase not in {"seeded", "migrating", "migrated", "restarting", "verifying", "verified"}:
    raise SystemExit("invalid runtime marker phase")
if not re.fullmatch(r"(?:none|legacy|(?:registry-api|ingestion-service|rag-retrieval-service|web)(?:,(?:registry-api|ingestion-service|rag-retrieval-service|web))*)", services):
    raise SystemExit("invalid runtime marker services")
if migration_started not in {"true", "false"}:
    raise SystemExit("invalid runtime marker migration flag")
if not re.fullmatch(r"[0-9A-Za-z._:-]+", deployment_id):
    raise SystemExit("invalid runtime marker deployment id")

state_dir = Path(release_root) / "state"
state_dir_created = False
if state_dir.exists() or state_dir.is_symlink():
    if state_dir.is_symlink() or not state_dir.is_dir():
        raise SystemExit(f"runtime state path must be a real directory: {state_dir}")
else:
    state_dir.mkdir(mode=0o700)
    state_dir_created = True
if state_dir_created:
    release_root_fd = os.open(Path(release_root), os.O_RDONLY)
    try:
        os.fsync(release_root_fd)
    finally:
        os.close(release_root_fd)
directory_mode = stat.S_IMODE(state_dir.stat().st_mode)
if directory_mode & 0o077:
    raise SystemExit(f"runtime state directory must not be group/world accessible: {state_dir}")

marker = state_dir / "applied-runtime.env"
if marker.is_symlink():
    raise SystemExit(f"runtime marker must not be a symlink: {marker}")
timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
content = (
    "schema_version=1\n"
    f"applied_sha={applied_sha}\n"
    f"state={state}\n"
    f"phase={phase}\n"
    f"services={services}\n"
    f"migration_started={migration_started}\n"
    f"deployment_id={deployment_id}\n"
    f"updated_utc={timestamp}\n"
).encode("utf-8")
temporary = state_dir / f".applied-runtime.{os.getpid()}.tmp"
fd = None
try:
# AKL_WRITE_RUNTIME_MARKER
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb", closefd=True) as handle:
        fd = None
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, marker)
    os.chmod(marker, 0o600)
    directory_fd = os.open(state_dir, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
finally:
    if fd is not None:
        os.close(fd)
    try:
        temporary.unlink()
    except FileNotFoundError:
        pass
PY
}

akl_current_release_sha() {
  local release_root="$1"
  local current_link="${release_root}/current"

  if [[ ! -e "$current_link" && ! -L "$current_link" ]]; then
    return 0
  fi
  [[ -L "$current_link" ]] || akl_fail "${current_link} must be a symlink"

  local target
  target="$(python3 - "$current_link" <<'PY'
import os
import sys
print(os.path.realpath(sys.argv[1]))
PY
)"
  case "$target" in
    "${release_root}/releases/"*) ;;
    *) akl_fail "current symlink points outside ${release_root}/releases" ;;
  esac

  local sha
  sha="$(akl_read_exact_release_marker "$target")" \
    || akl_fail "current release has invalid Git SHA metadata"
  [[ "$target" == "${release_root}/releases/${sha}" ]] \
    || akl_fail "current release directory does not match its Git SHA marker"
  printf '%s\n' "$sha"
}

akl_read_exact_release_marker() {
  local release_dir="$1"
  python3 - "$release_dir" <<'PY'
import re
import stat
import sys
from pathlib import Path

marker = Path(sys.argv[1]) / ".akl-release-sha"
try:
    marker_stat = marker.lstat()
except FileNotFoundError as exc:
    raise SystemExit("release SHA marker is missing") from exc
if not stat.S_ISREG(marker_stat.st_mode):
    raise SystemExit("release SHA marker must be a regular file, not a symlink")
if marker_stat.st_nlink != 1:
    raise SystemExit("release SHA marker must not be hard-linked")
content = marker.read_bytes()
if not re.fullmatch(rb"[0-9a-f]{40}\n", content):
    raise SystemExit("release SHA marker must contain exactly one full lowercase SHA")
print(content[:-1].decode("ascii"))
PY
}

akl_verify_release_tree() {
  local git_dir="$1"
  local sha="$2"
  local release_dir="$3"
  local trusted_ref="$4"

  akl_validate_full_sha "$sha"
  python3 - "$git_dir" "$sha" "$release_dir" "$trusted_ref" <<'PY'
from datetime import datetime
import hashlib
import os
import re
import stat
import subprocess
import sys
from pathlib import Path

git_dir, sha, raw_release_dir, trusted_ref = sys.argv[1:]
release_dir = Path(raw_release_dir)
metadata_names = {".akl-release-manifest", ".akl-release-sha"}


def require_single_regular_file(path: Path, label: str) -> bytes:
    try:
        file_stat = path.lstat()
    except FileNotFoundError as exc:
        raise SystemExit(f"{label} is missing") from exc
    if not stat.S_ISREG(file_stat.st_mode):
        raise SystemExit(f"{label} must be a regular file, not a symlink")
    if file_stat.st_nlink != 1:
        raise SystemExit(f"{label} must not be hard-linked")
    return path.read_bytes()


marker_content = require_single_regular_file(
    release_dir / ".akl-release-sha", "release SHA marker"
)
if marker_content != f"{sha}\n".encode("ascii"):
    raise SystemExit("release SHA marker does not exactly match target SHA")

manifest_content = require_single_regular_file(
    release_dir / ".akl-release-manifest", "release manifest"
)
try:
    manifest_text = manifest_content.decode("utf-8")
except UnicodeDecodeError as exc:
    raise SystemExit("release manifest is not valid UTF-8") from exc
if not manifest_text.endswith("\n") or "\r" in manifest_text:
    raise SystemExit("release manifest must be newline-terminated UTF-8")
manifest_lines = manifest_text[:-1].split("\n")
manifest_keys = ["git_sha", "trusted_ref", "prepared_utc"]
if len(manifest_lines) != len(manifest_keys):
    raise SystemExit("release manifest has missing, duplicate, or extra keys")
manifest: dict[str, str] = {}
for expected_key, line in zip(manifest_keys, manifest_lines, strict=True):
    if "=" not in line:
        raise SystemExit("release manifest contains a malformed field")
    key, value = line.split("=", 1)
    if key != expected_key or key in manifest or not value:
        raise SystemExit("release manifest schema or key order is invalid")
    manifest[key] = value
if manifest["git_sha"] != sha:
    raise SystemExit("release manifest Git SHA does not match target SHA")
if manifest["trusted_ref"] != trusted_ref:
    raise SystemExit("release manifest trusted ref does not match configuration")
prepared_utc = manifest["prepared_utc"]
if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", prepared_utc):
    raise SystemExit("release manifest timestamp is not canonical UTC")
try:
    datetime.strptime(prepared_utc, "%Y-%m-%dT%H:%M:%SZ")
except ValueError as exc:
    raise SystemExit("release manifest timestamp is invalid") from exc

raw_tree = subprocess.check_output(
    ["git", "--no-replace-objects", f"--git-dir={git_dir}", "ls-tree", "-rz", sha]
)
expected: dict[str, tuple[str, str]] = {}
for record in raw_tree.split(b"\0"):
    if not record:
        continue
    metadata, raw_path = record.split(b"\t", 1)
    mode, object_type, object_id = metadata.decode("ascii").split()
    if object_type != "blob":
        raise SystemExit(f"unsupported Git object in release tree: {object_type}")
    expected[os.fsdecode(raw_path)] = (mode, object_id)

expected_directories: set[str] = set()
for relative_path in expected:
    parent = Path(relative_path).parent
    while parent != Path("."):
        expected_directories.add(parent.as_posix())
        parent = parent.parent

actual: set[str] = set()
actual_directories: set[str] = set()
for root, directory_names, file_names in os.walk(release_dir, followlinks=False):
    root_path = Path(root)
    for name in list(directory_names):
        candidate = root_path / name
        if candidate.is_symlink():
            actual.add(candidate.relative_to(release_dir).as_posix())
            directory_names.remove(name)
        else:
            actual_directories.add(candidate.relative_to(release_dir).as_posix())
    for name in file_names:
        if root_path == release_dir and name in metadata_names:
            continue
        actual.add((root_path / name).relative_to(release_dir).as_posix())

if actual != set(expected):
    missing = sorted(set(expected) - actual)
    extra = sorted(actual - set(expected))
    raise SystemExit(
        f"release tree path mismatch; missing={missing[:5]} extra={extra[:5]}"
    )
if actual_directories != expected_directories:
    missing = sorted(expected_directories - actual_directories)
    extra = sorted(actual_directories - expected_directories)
    raise SystemExit(
        f"release tree directory mismatch; missing={missing[:5]} extra={extra[:5]}"
    )

for relative_path, (mode, object_id) in expected.items():
    candidate = release_dir / relative_path
    file_stat = candidate.lstat()
    if mode == "120000":
        if not stat.S_ISLNK(file_stat.st_mode):
            raise SystemExit(f"expected symlink in release tree: {relative_path}")
        content = os.fsencode(os.readlink(candidate))
    elif mode in {"100644", "100755"}:
        if not stat.S_ISREG(file_stat.st_mode):
            raise SystemExit(f"expected regular file in release tree: {relative_path}")
        if file_stat.st_nlink != 1:
            raise SystemExit(f"hard-linked file is not allowed in release tree: {relative_path}")
        content = candidate.read_bytes()
        executable = bool(file_stat.st_mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH))
        if executable != (mode == "100755"):
            raise SystemExit(f"executable mode mismatch in release tree: {relative_path}")
    else:
        raise SystemExit(f"unsupported Git mode in release tree: {mode}")
    digest = hashlib.sha1(
        f"blob {len(content)}\0".encode("ascii") + content,
        usedforsecurity=False,
    ).hexdigest()
    if digest != object_id:
        raise SystemExit(f"content mismatch in release tree: {relative_path}")

resolved_root = release_dir.resolve()
for candidate in release_dir.rglob("*"):
    if not candidate.is_symlink():
        continue
    target = (candidate.parent / os.readlink(candidate)).resolve()
    try:
        target.relative_to(resolved_root)
    except ValueError as exc:
        raise SystemExit(f"release contains an escaping symlink: {candidate}") from exc
PY
}

akl_assert_no_active_deploy_lock() {
  local release_root="$1"
  python3 - "$release_root" <<'PY'
import os
import sys

lock_path = os.path.join(sys.argv[1], ".immutable-deploy.lock")
if os.path.lexists(lock_path):
    raise SystemExit(f"an immutable deployment lock already exists: {lock_path}")
PY
}

akl_assert_deploy_lock_owned_by_current_process() {
  local release_root="$1"
  python3 - "$release_root" "$$" <<'PY'
import os
import re
import stat
import sys
from pathlib import Path

release_root = Path(sys.argv[1])
expected_pid = sys.argv[2]
lock_dir = release_root / ".immutable-deploy.lock"
owner = lock_dir / "owner"

lock_stat = lock_dir.lstat()
if lock_dir.is_symlink() or not stat.S_ISDIR(lock_stat.st_mode):
    raise SystemExit("active immutable deployment lock must be a real directory")
if lock_stat.st_uid != os.geteuid() or stat.S_IMODE(lock_stat.st_mode) & 0o077:
    raise SystemExit("active immutable deployment lock has unsafe ownership or mode")
owner_stat = owner.lstat()
if (
    owner.is_symlink()
    or not stat.S_ISREG(owner_stat.st_mode)
    or owner_stat.st_nlink != 1
    or owner_stat.st_uid != os.geteuid()
    or stat.S_IMODE(owner_stat.st_mode) != 0o600
):
    raise SystemExit("active immutable deployment lock owner file is not trusted")
raw = owner.read_bytes()
if not raw.endswith(b"\n") or b"\r" in raw or b"\0" in raw:
    raise SystemExit("active immutable deployment lock owner encoding is invalid")
lines = raw.decode("utf-8").splitlines()
keys = ["pid", "host", "started_utc"]
if len(lines) != len(keys):
    raise SystemExit("active immutable deployment lock owner schema is invalid")
values = {}
for expected_key, line in zip(keys, lines, strict=True):
    if "=" not in line:
        raise SystemExit("active immutable deployment lock owner field is malformed")
    key, value = line.split("=", 1)
    if key != expected_key or key in values or not value:
        raise SystemExit("active immutable deployment lock owner keys are invalid")
    values[key] = value
if values["pid"] != expected_pid or not values["pid"].isdigit():
    raise SystemExit("active immutable deployment lock is not owned by this orchestrator")
if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", values["started_utc"]):
    raise SystemExit("active immutable deployment lock timestamp is invalid")
PY
}

akl_require_existing_current_transition_trust() {
  local release_root="$1"
  local env_source_file="$2"
  local git_dir="$3"
  local target_sha="$4"
  local current_sha="$5"

  python3 - \
    "$release_root" \
    "$env_source_file" \
    "$git_dir" \
    "$target_sha" \
    "$current_sha" <<'PY'
import os
import stat
import sys
from pathlib import Path

raw_root, raw_env, raw_git, target_sha, current_sha = sys.argv[1:]
euid = os.geteuid()
root = Path(raw_root)
env_file = Path(raw_env)
git_dir = Path(raw_git)
releases = root / "releases"
target = releases / target_sha
current_release = releases / current_sha
current_link = root / "current"

for path, label in ((root, "release root"), (env_file, "production env"), (git_dir, "Git mirror")):
    if not path.is_absolute():
        raise SystemExit(f"transition {label} path must be absolute")
if env_file != root / "env" / "akl.prod.env":
    raise SystemExit("transition requires the canonical production env path")
if git_dir != root / "git" / "AI-KnowledgeBase.git":
    raise SystemExit("transition requires the canonical bare Git mirror path")


def require_trusted_directory(path: Path, label: str, *, read_only: bool = False) -> None:
    try:
        path_stat = path.lstat()
    except FileNotFoundError as exc:
        raise SystemExit(f"transition {label} is missing: {path}") from exc
    if path.is_symlink() or not stat.S_ISDIR(path_stat.st_mode):
        raise SystemExit(f"transition {label} must be a real directory: {path}")
    if path_stat.st_uid != euid:
        raise SystemExit(f"transition {label} must be owned by the release operator: {path}")
    mode = stat.S_IMODE(path_stat.st_mode)
    if mode & 0o022:
        raise SystemExit(f"transition {label} must not be group/world writable: {path}")
    if read_only and mode & 0o222:
        raise SystemExit(f"transition {label} must be read-only: {path}")


for directory, label in (
    (root, "release root"),
    (root / "env", "env directory"),
    (root / "backups", "backup directory"),
    (root / "deployments", "deployment-record directory"),
    (releases, "releases directory"),
    (root / "git", "Git mirror parent"),
    (git_dir, "Git mirror"),
    (root / "state", "state directory"),
):
    require_trusted_directory(directory, label)

env_stat = env_file.lstat()
if (
    env_file.is_symlink()
    or not stat.S_ISREG(env_stat.st_mode)
    or env_stat.st_nlink != 1
    or env_stat.st_uid != euid
    or stat.S_IMODE(env_stat.st_mode) != 0o600
):
    raise SystemExit("transition production env must be an operator-owned single-link mode-0600 regular file")

marker = root / "state" / "applied-runtime.env"
marker_stat = marker.lstat()
if (
    marker.is_symlink()
    or not stat.S_ISREG(marker_stat.st_mode)
    or marker_stat.st_nlink != 1
    or marker_stat.st_uid != euid
    or stat.S_IMODE(marker_stat.st_mode) != 0o600
):
    raise SystemExit("transition runtime marker must be an operator-owned single-link mode-0600 regular file")

link_stat = current_link.lstat()
if not stat.S_ISLNK(link_stat.st_mode) or link_stat.st_uid != euid:
    raise SystemExit("transition current must be an operator-owned symlink")
if Path(os.path.realpath(current_link)) != current_release:
    raise SystemExit("transition current symlink does not resolve to its exact release directory")


def require_trusted_release_tree(release: Path, label: str) -> None:
    require_trusted_directory(release, label, read_only=True)
    for directory, directory_names, file_names in os.walk(release, followlinks=False):
        directory_path = Path(directory)
        directory_stat = directory_path.lstat()
        if directory_stat.st_uid != euid or stat.S_IMODE(directory_stat.st_mode) & 0o222:
            raise SystemExit(f"transition release directory is not operator-owned and read-only: {directory_path}")
        for name in [*directory_names, *file_names]:
            candidate = directory_path / name
            candidate_stat = candidate.lstat()
            if candidate_stat.st_uid != euid:
                raise SystemExit(f"transition release path has the wrong owner: {candidate}")
            if stat.S_ISLNK(candidate_stat.st_mode):
                continue
            if stat.S_IMODE(candidate_stat.st_mode) & 0o222:
                raise SystemExit(f"transition release path is writable: {candidate}")
            if stat.S_ISREG(candidate_stat.st_mode):
                if candidate_stat.st_nlink != 1:
                    raise SystemExit(f"transition release file is hard-linked: {candidate}")
            elif not stat.S_ISDIR(candidate_stat.st_mode):
                raise SystemExit(f"transition release path has an unsupported type: {candidate}")


require_trusted_release_tree(current_release, "current release")
if target != current_release:
    require_trusted_release_tree(target, "target release")

for script in (
    target / "scripts" / "bootstrap_docker_home_target.sh",
    target / "scripts" / "deploy_docker_home_release.sh",
    target / "scripts" / "lib" / "immutable_release_common.sh",
    current_release / "scripts" / "deploy_docker_home_release.sh",
    current_release / "scripts" / "lib" / "immutable_release_common.sh",
):
    script_stat = script.lstat()
    if (
        script.is_symlink()
        or not stat.S_ISREG(script_stat.st_mode)
        or script_stat.st_nlink != 1
        or script_stat.st_uid != euid
        or stat.S_IMODE(script_stat.st_mode) & 0o222
    ):
        raise SystemExit(f"transition target entry script is not trusted: {script}")
PY
}

akl_assert_existing_current_transition_state() {
  local release_root="$1"
  local env_file="$2"
  local env_source_file="$3"
  local git_dir="$4"
  local target_sha="$5"
  local validation_phase="$6"
  local current_sha git_url trusted_ref resolved_sha
  local marker_sha marker_state marker_phase transition_mode target_image

  akl_validate_full_sha "$target_sha"
  case "$validation_phase" in
    preflight)
      akl_assert_no_active_deploy_lock "$release_root" \
        || akl_fail "Existing-current transition preflight lock validation failed"
      ;;
    locked)
      akl_assert_deploy_lock_owned_by_current_process "$release_root" \
        || akl_fail "Existing-current transition lock ownership validation failed"
      ;;
    *) akl_fail "Unsupported existing-current transition validation phase" ;;
  esac

  if [[ "$env_source_file" == "$env_file" ]]; then
    akl_require_private_env_file "$env_source_file" \
      || akl_fail "Transition production env source is not private"
  else
    akl_require_private_env_file "$env_file" \
      || akl_fail "Transition env snapshot is not private"
  fi
  akl_assert_expected_env_snapshot "$env_file" \
    || akl_fail "Transition env snapshot identity changed"
  akl_assert_no_ambient_env_file_overrides "$env_file" \
    || akl_fail "Transition production env has ambient overrides"
  akl_assert_hermetic_git_environment \
    || akl_fail "Transition Git environment is not hermetic"
  akl_assert_local_docker_daemon_environment \
    || akl_fail "Transition Docker daemon environment is not local and hermetic"

  current_sha="$(akl_current_release_sha "$release_root")" \
    || akl_fail "Transition current symlink or marker is invalid"
  [[ -n "$current_sha" ]] \
    || akl_fail "Existing-current transition requires an exact current release"
  akl_require_existing_current_transition_trust \
    "$release_root" "$env_source_file" "$git_dir" "$target_sha" "$current_sha" \
    || akl_fail "Existing-current transition host trust validation failed"

  git_url="$(akl_env_value "$env_file" AKL_RELEASE_GIT_URL https://github.com/voldzi/AI-KnowledgeBase.git)"
  trusted_ref="$(akl_env_value "$env_file" AKL_RELEASE_TRUSTED_REF refs/remotes/origin/main)"
  [[ -n "$git_url" && ! "$git_url" =~ ^https?://[^/]*@ ]] \
    || akl_fail "Transition Git origin is empty or contains embedded credentials"
  [[ "$trusted_ref" == refs/remotes/origin/* ]] \
    || akl_fail "Transition trusted release ref must be an origin remote-tracking ref"
  git --no-replace-objects check-ref-format "$trusted_ref" >/dev/null 2>&1 \
    || akl_fail "Transition trusted release ref is invalid"
  [[ "$(git --no-replace-objects --git-dir="$git_dir" rev-parse --is-bare-repository)" == "true" ]] \
    || akl_fail "Transition Git directory is not bare"
  [[ "$(git --no-replace-objects --git-dir="$git_dir" remote get-url origin)" == "$git_url" ]] \
    || akl_fail "Transition Git mirror origin does not match production configuration"
  akl_assert_git_mirror_has_no_replace_refs "$git_dir" \
    || akl_fail "Transition Git mirror replace-ref validation failed"
  akl_assert_git_mirror_is_self_contained "$git_dir" \
    || akl_fail "Transition Git mirror is not self-contained and trusted"
  git --no-replace-objects --git-dir="$git_dir" show-ref --verify --quiet "$trusted_ref" \
    || akl_fail "Transition trusted release ref is missing"
  resolved_sha="$(git --no-replace-objects --git-dir="$git_dir" rev-parse --verify "${target_sha}^{commit}")"
  [[ "$resolved_sha" == "$target_sha" ]] \
    || akl_fail "Transition target SHA did not resolve exactly"
  git --no-replace-objects --git-dir="$git_dir" cat-file -e "${current_sha}^{commit}" \
    || akl_fail "Transition current SHA is missing from the trusted mirror"
  git --no-replace-objects --git-dir="$git_dir" merge-base --is-ancestor "$target_sha" "$trusted_ref" \
    || akl_fail "Transition target SHA is not reachable from the trusted ref"
  git --no-replace-objects --git-dir="$git_dir" merge-base --is-ancestor "$current_sha" "$target_sha" \
    || akl_fail "Transition target SHA must descend from current"

  akl_require_read_only_release_tree "${release_root}/releases/${current_sha}" \
    || akl_fail "Transition current release is writable"
  akl_verify_release_tree \
    "$git_dir" "$current_sha" "${release_root}/releases/${current_sha}" "$trusted_ref" \
    || akl_fail "Transition current release does not match the trusted Git tree"
  if [[ "$target_sha" != "$current_sha" ]]; then
    akl_require_read_only_release_tree "${release_root}/releases/${target_sha}" \
      || akl_fail "Transition target release is writable"
    akl_verify_release_tree \
      "$git_dir" "$target_sha" "${release_root}/releases/${target_sha}" "$trusted_ref" \
      || akl_fail "Transition target release does not match the trusted Git tree"
  fi
  grep -Fxq 'AKL_IMMUTABLE_ORCHESTRATOR_CONTRACT=2' \
    "${release_root}/releases/${target_sha}/scripts/deploy_docker_home_release.sh" \
    || akl_fail "Transition target does not contain hardened orchestrator contract 2"

  marker_sha="$(akl_runtime_marker_value "$release_root" applied_sha)" \
    || akl_fail "Transition runtime marker SHA is invalid"
  marker_state="$(akl_runtime_marker_value "$release_root" state)" \
    || akl_fail "Transition runtime marker state is invalid"
  marker_phase="$(akl_runtime_marker_value "$release_root" phase)" \
    || akl_fail "Transition runtime marker phase is invalid"
  if [[ "$marker_sha" == "$target_sha" \
    && "$marker_state" == "verified" \
    && "$marker_phase" == "verified" ]]; then
    transition_mode="verified-reconciliation"
  elif [[ "$marker_sha" == "$current_sha" \
    && "$marker_state" == "verified" \
    && "$marker_phase" == "verified" \
    && "$current_sha" != "$target_sha" ]]; then
    if grep -Fxq 'AKL_IMMUTABLE_ORCHESTRATOR_CONTRACT=2' \
      "${release_root}/releases/${current_sha}/scripts/deploy_docker_home_release.sh"; then
      akl_fail "Existing current already uses hardened orchestrator contract 2; deploy through current"
    fi
    transition_mode="clean"
  elif [[ "$marker_state" == "failed" || "$marker_state" == "applying" ]]; then
    akl_fail "Transition runtime is not verified; recover through the exact applied release rollback/forward-fix entry point"
  else
    akl_fail "Transition requires verified/verified runtime state bound to current or target reconciliation"
  fi

  if [[ "$transition_mode" == "clean" ]]; then
    akl_assert_release_sha_not_burned "$release_root" "$target_sha" \
      || akl_fail "Clean transition target has durable burned-SHA evidence; prepare a reviewed descendant"
    for target_image in \
      "akl/registry-api:${target_sha}" \
      "akl/ingestion-service:${target_sha}" \
      "akl/rag-retrieval-service:${target_sha}" \
      "akl/web:${target_sha}"; do
      if docker image inspect "$target_image" >/dev/null 2>&1; then
        akl_fail "Clean transition target image tag already exists: $target_image"
      fi
    done
  fi

  printf '%s\n' "$transition_mode"
}

akl_atomic_current_symlink() {
  local release_root="$1"
  local release_dir="$2"
  local temporary_link="${release_root}/.current.$$.tmp"
  local current_link="${release_root}/current"

  case "$release_dir" in
    "${release_root}/releases/"*) ;;
    *) akl_fail "Refusing to activate a release outside ${release_root}/releases" ;;
  esac
  [[ -d "$release_dir" && ! -L "$release_dir" ]] \
    || akl_fail "Release activation target must be a real directory"
  local release_sha
  release_sha="$(basename "$release_dir")"
  akl_validate_full_sha "$release_sha"
  [[ "$(akl_read_exact_release_marker "$release_dir")" == "$release_sha" ]] \
    || akl_fail "Release directory and Git SHA marker do not match"

  rm -f "$temporary_link"
  ln -s "$release_dir" "$temporary_link"
  python3 - "$temporary_link" "$current_link" <<'PY'
# AKL_ATOMIC_CURRENT_SYMLINK
import os
import sys
os.replace(sys.argv[1], sys.argv[2])
directory_fd = os.open(os.path.dirname(sys.argv[2]), os.O_RDONLY)
try:
    os.fsync(directory_fd)
finally:
    os.close(directory_fd)
PY
}

akl_validate_deployment_id() {
  [[ "$1" =~ ^[0-9A-Za-z._:-]+$ ]] \
    || akl_fail "Immutable deployment id is invalid"
}

akl_assert_registry_container_quiescent_state() {
  local project_name="$1"
  local expected_container_id="$2"
  local phase="$3"
  local registry_ps_output running restarting container_status compose_project compose_service
  local -a registry_container_ids=()

  akl_validate_project_name "$project_name"
  [[ "$expected_container_id" == "none" \
    || ( -n "$expected_container_id" \
      && "$expected_container_id" != *$'\n'* \
      && "$expected_container_id" != *$'\r'* \
      && "$expected_container_id" != *[[:space:]]* ) ]] \
    || akl_fail "Registry predecessor container id is invalid"
  [[ "$phase" =~ ^[a-z0-9-]+$ ]] \
    || akl_fail "Registry quiescence verification phase is invalid"

  registry_ps_output="$(
    AKL_RELEASE_QUIESCE_CHECK_PHASE="$phase" \
      docker ps -a \
        --no-trunc \
        --filter "label=com.docker.compose.project=${project_name}" \
        --filter 'label=com.docker.compose.service=registry-api' \
        --format '{{.ID}}'
  )" || akl_fail "Could not enumerate Registry project containers during ${phase}"
  if [[ -n "$registry_ps_output" ]]; then
    mapfile -t registry_container_ids <<<"$registry_ps_output"
  fi

  if [[ "$expected_container_id" == "none" ]]; then
    [[ ${#registry_container_ids[@]} -eq 0 ]] \
      || akl_fail "A Registry writer appeared after the zero-predecessor quiesce boundary during ${phase}"
    return 0
  fi
  [[ ${#registry_container_ids[@]} -eq 1 \
    && "${registry_container_ids[0]}" == "$expected_container_id" ]] \
    || akl_fail "Registry predecessor identity changed after the quiesce boundary during ${phase}"

  compose_project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$expected_container_id")" \
    || akl_fail "Could not inspect the quiesced Registry predecessor project label"
  compose_service="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$expected_container_id")" \
    || akl_fail "Could not inspect the quiesced Registry predecessor service label"
  [[ "$compose_project" == "$project_name" && "$compose_service" == "registry-api" ]] \
    || akl_fail "Quiesced Registry predecessor Compose identity changed"

  running="$(docker inspect --format '{{.State.Running}}' "$expected_container_id")" \
    || akl_fail "Could not inspect the quiesced Registry predecessor running state"
  restarting="$(docker inspect --format '{{.State.Restarting}}' "$expected_container_id")" \
    || akl_fail "Could not inspect the quiesced Registry predecessor restart state"
  container_status="$(docker inspect --format '{{.State.Status}}' "$expected_container_id")" \
    || akl_fail "Could not inspect the quiesced Registry predecessor status"
  [[ "$running" == "false" && "$restarting" == "false" \
    && ( "$container_status" == "exited" || "$container_status" == "created" ) ]] \
    || akl_fail "Registry writer is running, restarting, or in an unsafe state during ${phase}"
}

akl_record_registry_quiescence() {
  local release_root="$1"
  local deployment_id="$2"
  local project_name="$3"
  local predecessor_container_id="$4"
  local predecessor_was_active="$5"
  local state_dir="${release_root}/state"
  local evidence_dir="${state_dir}/registry-quiescence"
  local evidence_path="${evidence_dir}/${deployment_id}.env"
  local evidence_tmp
  local previous_umask

  akl_validate_deployment_id "$deployment_id"
  akl_validate_project_name "$project_name"
  [[ "$predecessor_was_active" == "true" || "$predecessor_was_active" == "false" ]] \
    || akl_fail "Registry predecessor active-state evidence is invalid"
  akl_assert_registry_container_quiescent_state \
    "$project_name" "$predecessor_container_id" post-stop-record

  python3 - "$release_root" "$deployment_id" "$$" <<'PY'
import re
import stat
import sys
from pathlib import Path

release_root = Path(sys.argv[1])
deployment_id = sys.argv[2]
expected_pid = sys.argv[3]
lock_dir = release_root / ".immutable-deploy.lock"
owner = lock_dir / "owner"
if lock_dir.is_symlink() or not stat.S_ISDIR(lock_dir.lstat().st_mode):
    raise SystemExit("deployment lock must be a real directory before recording quiescence")
owner_stat = owner.lstat()
if owner.is_symlink() or not stat.S_ISREG(owner_stat.st_mode) or owner_stat.st_nlink != 1:
    raise SystemExit("deployment lock owner must be a single-link regular file")
lines = owner.read_text(encoding="utf-8").splitlines()
if len(lines) != 3 or [line.split("=", 1)[0] for line in lines] != ["pid", "host", "started_utc"]:
    raise SystemExit("deployment lock owner schema is invalid")
values = dict(line.split("=", 1) for line in lines)
if values["pid"] != expected_pid or not values["host"]:
    raise SystemExit("deployment lock is not owned by the release orchestrator")
if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", values["started_utc"]):
    raise SystemExit("deployment lock timestamp is invalid")
if not re.fullmatch(r"[0-9A-Za-z._:-]+", deployment_id):
    raise SystemExit("deployment id is invalid")
PY

  previous_umask="$(umask)"
  umask 077
  mkdir -p "$state_dir" "$evidence_dir"
  umask "$previous_umask"
  python3 - "$state_dir" "$evidence_dir" <<'PY'
import stat
import sys
from pathlib import Path

for raw_path in sys.argv[1:]:
    path = Path(raw_path)
    path_stat = path.lstat()
    if path.is_symlink() or not stat.S_ISDIR(path_stat.st_mode):
        raise SystemExit(f"Registry quiescence state path must be a real directory: {path}")
    if stat.S_IMODE(path_stat.st_mode) & 0o077:
        raise SystemExit(f"Registry quiescence state path must be private: {path}")
PY
  akl_fsync_directory "$release_root"
  akl_fsync_directory "$state_dir"
  [[ ! -e "$evidence_path" && ! -L "$evidence_path" ]] \
    || akl_fail "Registry quiescence evidence already exists for this deployment"
  evidence_tmp="$(mktemp "${evidence_dir}/.${deployment_id}.tmp.XXXXXX")"
  printf 'schema_version=1\ndeployment_id=%s\norchestrator_pid=%s\ncompose_project=%s\npredecessor_container_id=%s\npredecessor_was_active=%s\nverified_utc=%s\n' \
    "$deployment_id" "$$" "$project_name" "$predecessor_container_id" \
    "$predecessor_was_active" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$evidence_tmp"
  if ! akl_publish_durable_file "$evidence_tmp" "$evidence_path" 0600; then
    rm -f "$evidence_tmp"
    return 1
  fi
}

akl_assert_registry_writer_quiesced() {
  local release_root="$1"
  local deployment_id="$2"
  local phase="$3"
  local evidence_path="${release_root}/state/registry-quiescence/${deployment_id}.env"
  local evidence_identity project_name predecessor_container_id

  akl_validate_deployment_id "$deployment_id"
  evidence_identity="$(python3 - "$release_root" "$evidence_path" "$deployment_id" <<'PY'
import re
import stat
import sys
from pathlib import Path

release_root = Path(sys.argv[1])
evidence = Path(sys.argv[2])
deployment_id = sys.argv[3]
lock_dir = release_root / ".immutable-deploy.lock"
owner = lock_dir / "owner"
if lock_dir.is_symlink() or not stat.S_ISDIR(lock_dir.lstat().st_mode):
    raise SystemExit("deployment lock is missing while Registry quiescence is required")
owner_stat = owner.lstat()
if owner.is_symlink() or not stat.S_ISREG(owner_stat.st_mode) or owner_stat.st_nlink != 1:
    raise SystemExit("deployment lock owner evidence is invalid")
owner_lines = owner.read_text(encoding="utf-8").splitlines()
if len(owner_lines) != 3 or [line.split("=", 1)[0] for line in owner_lines] != ["pid", "host", "started_utc"]:
    raise SystemExit("deployment lock owner schema is invalid")
owner_values = dict(line.split("=", 1) for line in owner_lines)

evidence_stat = evidence.lstat()
if evidence.is_symlink() or not stat.S_ISREG(evidence_stat.st_mode) or evidence_stat.st_nlink != 1:
    raise SystemExit("Registry quiescence evidence must be a single-link regular file")
if stat.S_IMODE(evidence_stat.st_mode) != 0o600:
    raise SystemExit("Registry quiescence evidence must have mode 0600")
raw = evidence.read_bytes()
if not raw.endswith(b"\n") or b"\r" in raw or b"\0" in raw:
    raise SystemExit("Registry quiescence evidence encoding is invalid")
lines = raw.decode("utf-8").splitlines()
keys = [
    "schema_version", "deployment_id", "orchestrator_pid", "compose_project",
    "predecessor_container_id", "predecessor_was_active", "verified_utc",
]
if len(lines) != len(keys):
    raise SystemExit("Registry quiescence evidence schema is invalid")
values = {}
for expected_key, line in zip(keys, lines, strict=True):
    if "=" not in line:
        raise SystemExit("Registry quiescence evidence contains a malformed field")
    key, value = line.split("=", 1)
    if key != expected_key or key in values or not value:
        raise SystemExit("Registry quiescence evidence keys are invalid")
    values[key] = value
if values["schema_version"] != "1" or values["deployment_id"] != deployment_id:
    raise SystemExit("Registry quiescence evidence deployment identity is invalid")
if values["orchestrator_pid"] != owner_values.get("pid"):
    raise SystemExit("Registry quiescence evidence is not bound to the active deployment lock")
if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", values["compose_project"]):
    raise SystemExit("Registry quiescence evidence Compose project is invalid")
container_id = values["predecessor_container_id"]
if container_id != "none" and (not container_id or any(character.isspace() for character in container_id)):
    raise SystemExit("Registry quiescence evidence predecessor id is invalid")
if values["predecessor_was_active"] not in {"true", "false"}:
    raise SystemExit("Registry quiescence evidence predecessor state is invalid")
if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", values["verified_utc"]):
    raise SystemExit("Registry quiescence evidence timestamp is invalid")
print(f'{values["compose_project"]}|{container_id}')
PY
)" || akl_fail "Registry quiescence evidence is missing, invalid, or stale"
  IFS='|' read -r project_name predecessor_container_id <<<"$evidence_identity"
  akl_assert_registry_container_quiescent_state \
    "$project_name" "$predecessor_container_id" "$phase"
}

akl_quarantine_unverified_compose_service() {
  local project_name="$1"
  local service_name="$2"
  local target_image_id="$3"
  local target_sha="$4"
  local compose_file="$5"
  local container_output remaining_output container_id
  local compose_project compose_service compose_oneoff image_ref image_id config_files
  local revision release_project release_service
  local -a container_ids=()

  akl_validate_project_name "$project_name"
  [[ "$service_name" =~ ^(registry-api|ingestion-service|rag-retrieval-service|web)$ ]] \
    || akl_fail "Unverified Compose service name is invalid"
  [[ "$target_image_id" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || akl_fail "Unverified durable target image ID is invalid"
  akl_validate_full_sha "$target_sha"
  [[ "$compose_file" == /* \
    && "$compose_file" != *$'\n'* \
    && "$compose_file" != *$'\r'* ]] \
    || akl_fail "Unverified target Compose file identity is invalid"

  container_output="$(
    docker ps -a --no-trunc \
      --filter "label=com.docker.compose.project=${project_name}" \
      --filter "label=com.docker.compose.service=${service_name}" \
      --format '{{.ID}}'
  )" || akl_fail "Could not enumerate the unverified Compose service"
  if [[ -n "$container_output" ]]; then
    mapfile -t container_ids <<<"$container_output"
  fi

  for container_id in "${container_ids[@]}"; do
    [[ -n "$container_id" && "$container_id" != *[[:space:]]* ]] \
      || akl_fail "Unverified Compose container identity is invalid"
    compose_project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container_id")" \
      || akl_fail "Could not inspect the unverified Compose project label"
    compose_service="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$container_id")" \
      || akl_fail "Could not inspect the unverified Compose service label"
    compose_oneoff="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.oneoff"}}' "$container_id")" \
      || akl_fail "Could not inspect the unverified Compose one-off label"
    image_ref="$(docker inspect --format '{{.Config.Image}}' "$container_id")" \
      || akl_fail "Could not inspect the unverified Compose image reference"
    image_id="$(docker inspect --format '{{.Image}}' "$container_id")" \
      || akl_fail "Could not inspect the unverified Compose image identity"
    config_files="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$container_id")" \
      || akl_fail "Could not inspect the unverified Compose config identity"
    revision="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$container_id")" \
      || akl_fail "Could not inspect the unverified target revision"
    release_project="$(docker inspect --format '{{index .Config.Labels "cz.zeleznalady.akl.compose-project"}}' "$container_id")" \
      || akl_fail "Could not inspect the unverified target project provenance"
    release_service="$(docker inspect --format '{{index .Config.Labels "cz.zeleznalady.akl.service"}}' "$container_id")" \
      || akl_fail "Could not inspect the unverified target service provenance"
    [[ "$compose_project" == "$project_name" \
      && "$compose_service" == "$service_name" \
      && "${compose_oneoff,,}" == "false" \
      && "$image_ref" == "$target_image_id" \
      && "$image_id" == "$target_image_id" \
      && "$config_files" == "$compose_file" \
      && "$revision" == "$target_sha" \
      && "$release_project" == "$project_name" \
      && "$release_service" == "$service_name" ]] \
      || akl_fail "Unverified Compose container evidence changed before quarantine"

    # Force-removal stops the process and removes its restart policy. This is
    # not a rollback: after a forward-only migration, no predecessor image is
    # restarted against the new schema.
    docker rm --force "$container_id" >/dev/null \
      || akl_fail "Could not quarantine the unverified Compose container"
  done

  remaining_output="$(
    docker ps -a --no-trunc \
      --filter "label=com.docker.compose.project=${project_name}" \
      --filter "label=com.docker.compose.service=${service_name}" \
      --format '{{.ID}}'
  )" || akl_fail "Could not verify the unverified Compose service quarantine"
  [[ -z "$remaining_output" ]] \
    || akl_fail "An unverified Compose service container still exists"
}

akl_acquire_deploy_lock() {
  local release_root="$1"
  local lock_dir="${release_root}/.immutable-deploy.lock"
  if ! mkdir "$lock_dir" 2>/dev/null; then
    akl_fail "Another immutable deployment may be active: $lock_dir"
  fi
  if ! chmod 0700 "$lock_dir"; then
    rmdir "$lock_dir" 2>/dev/null || true
    akl_fail "Could not secure immutable deployment lock directory"
  fi
  if ! printf 'pid=%s\nhost=%s\nstarted_utc=%s\n' \
    "$$" "$(hostname)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"${lock_dir}/owner"; then
    rmdir "$lock_dir" 2>/dev/null || true
    akl_fail "Could not record immutable deployment lock ownership"
  fi
  chmod 0600 "${lock_dir}/owner"
  akl_fsync_file "${lock_dir}/owner"
  akl_fsync_directory "$lock_dir"
  akl_fsync_directory "$release_root"
  AKL_DEPLOY_LOCK_DIR="$lock_dir"
}

akl_release_deploy_lock() {
  if [[ -z "${AKL_DEPLOY_LOCK_DIR:-}" ]]; then
    return 0
  fi
  local release_root
  release_root="$(dirname "$AKL_DEPLOY_LOCK_DIR")"
  if ! akl_assert_deploy_lock_owned_by_current_process "$release_root"; then
    printf 'ERROR: Deployment lock ownership or identity changed; refusing to remove it.\n' >&2
    return 1
  fi
  rm -f "${AKL_DEPLOY_LOCK_DIR}/owner" || {
    printf 'ERROR: Deployment lock owner evidence could not be removed.\n' >&2
    return 1
  }
  rmdir "${AKL_DEPLOY_LOCK_DIR}" || {
    printf 'ERROR: Deployment lock directory could not be removed.\n' >&2
    return 1
  }
  AKL_DEPLOY_LOCK_DIR=""
}
