#!/usr/bin/env bash
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

akl_env_value() {
  local env_file="$1"
  local key="$2"
  local default_value="${3-}"

  python3 - "$env_file" "$key" "$default_value" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2]
default = sys.argv[3]
value = None
for raw_line in path.read_text(encoding="utf-8").splitlines():
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
  akl_require_file "$env_file"
  python3 - "$env_file" <<'PY'
import os
import stat
import sys

path = sys.argv[1]
if os.path.islink(path) or not stat.S_ISREG(os.lstat(path).st_mode):
    raise SystemExit(f"Production env path must be a regular file, not a symlink: {path}")
mode = stat.S_IMODE(os.stat(path).st_mode)
if mode & 0o077:
    raise SystemExit(
        f"Production env file must not be group/world accessible: {path} mode={mode:04o}"
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
if not re.fullmatch(r"(?:none|legacy|(?:registry-api|rag-retrieval-service|web)(?:,(?:registry-api|rag-retrieval-service|web))*)", values["services"]):
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
if not re.fullmatch(r"(?:none|legacy|(?:registry-api|rag-retrieval-service|web)(?:,(?:registry-api|rag-retrieval-service|web))*)", services):
    raise SystemExit("invalid runtime marker services")
if migration_started not in {"true", "false"}:
    raise SystemExit("invalid runtime marker migration flag")
if not re.fullmatch(r"[0-9A-Za-z._:-]+", deployment_id):
    raise SystemExit("invalid runtime marker deployment id")

state_dir = Path(release_root) / "state"
if state_dir.exists() or state_dir.is_symlink():
    if state_dir.is_symlink() or not state_dir.is_dir():
        raise SystemExit(f"runtime state path must be a real directory: {state_dir}")
else:
    state_dir.mkdir(mode=0o700)
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

  local marker="${target}/.akl-release-sha"
  akl_require_file "$marker"
  local sha
  sha="$(tr -d '[:space:]' <"$marker")"
  akl_validate_full_sha "$sha"
  [[ "$target" == "${release_root}/releases/${sha}" ]] \
    || akl_fail "current release directory does not match its Git SHA marker"
  printf '%s\n' "$sha"
}

akl_verify_release_tree() {
  local git_dir="$1"
  local sha="$2"
  local release_dir="$3"

  akl_validate_full_sha "$sha"
  python3 - "$git_dir" "$sha" "$release_dir" <<'PY'
import hashlib
import os
import stat
import subprocess
import sys
from pathlib import Path

git_dir, sha, raw_release_dir = sys.argv[1:]
release_dir = Path(raw_release_dir)
metadata_names = {".akl-release-manifest", ".akl-release-sha"}

raw_tree = subprocess.check_output(
    ["git", f"--git-dir={git_dir}", "ls-tree", "-rz", sha]
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
  akl_require_file "${release_dir}/.akl-release-sha"
  [[ "$(tr -d '[:space:]' <"${release_dir}/.akl-release-sha")" == "$release_sha" ]] \
    || akl_fail "Release directory and Git SHA marker do not match"

  rm -f "$temporary_link"
  ln -s "$release_dir" "$temporary_link"
  python3 - "$temporary_link" "$current_link" <<'PY'
import os
import sys
os.replace(sys.argv[1], sys.argv[2])
PY
}

akl_acquire_deploy_lock() {
  local release_root="$1"
  local lock_dir="${release_root}/.immutable-deploy.lock"
  if ! mkdir "$lock_dir" 2>/dev/null; then
    akl_fail "Another immutable deployment may be active: $lock_dir"
  fi
  if ! printf 'pid=%s\nhost=%s\nstarted_utc=%s\n' \
    "$$" "$(hostname)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"${lock_dir}/owner"; then
    rmdir "$lock_dir" 2>/dev/null || true
    akl_fail "Could not record immutable deployment lock ownership"
  fi
  AKL_DEPLOY_LOCK_DIR="$lock_dir"
}

akl_release_deploy_lock() {
  if [[ -n "${AKL_DEPLOY_LOCK_DIR:-}" && -d "${AKL_DEPLOY_LOCK_DIR}" ]]; then
    local owner_pid
    owner_pid="$(awk -F= '$1 == "pid" {print $2}' "${AKL_DEPLOY_LOCK_DIR}/owner" 2>/dev/null || true)"
    [[ "$owner_pid" == "$$" ]] \
      || akl_fail "Deployment lock ownership changed; refusing to remove it"
    rm -f "${AKL_DEPLOY_LOCK_DIR}/owner"
    rmdir "${AKL_DEPLOY_LOCK_DIR}"
  fi
}
