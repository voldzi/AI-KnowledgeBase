#!/usr/bin/env python3
"""Bind Docling model provisioning to an exact trusted source tree."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import stat
import subprocess


SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
TRUSTED_REF_PATTERN = re.compile(r"^refs/remotes/origin/[A-Za-z0-9._/-]+$")
UTC_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")


class SourceBindingError(RuntimeError):
    pass


def _lexists(path: Path) -> bool:
    return os.path.lexists(path)


def _require_read_only_regular_file(path: Path, label: str) -> bytes:
    try:
        file_stat = path.lstat()
    except OSError as exc:
        raise SourceBindingError(f"{label} is unavailable") from exc
    if (
        not stat.S_ISREG(file_stat.st_mode)
        or file_stat.st_nlink != 1
        or file_stat.st_mode & 0o222
    ):
        raise SourceBindingError(
            f"{label} must be a read-only, singly linked regular file"
        )
    try:
        return path.read_bytes()
    except OSError as exc:
        raise SourceBindingError(f"{label} cannot be read") from exc


def _verify_release_tree(root: Path, expected_sha: str) -> None:
    try:
        root_stat = root.lstat()
    except OSError as exc:
        raise SourceBindingError("release source root is unavailable") from exc
    if (
        not stat.S_ISDIR(root_stat.st_mode)
        or root.is_symlink()
        or root_stat.st_mode & 0o222
    ):
        raise SourceBindingError("release source root must be a read-only real directory")
    if root.name != expected_sha or root.parent.name != "releases":
        raise SourceBindingError("release source path is not bound to the expected SHA")

    marker = _require_read_only_regular_file(root / ".akl-release-sha", "release SHA marker")
    if marker != f"{expected_sha}\n".encode("ascii"):
        raise SourceBindingError("release SHA marker does not match the expected SHA")

    manifest_bytes = _require_read_only_regular_file(
        root / ".akl-release-manifest", "release source manifest"
    )
    try:
        manifest_text = manifest_bytes.decode("ascii")
    except UnicodeDecodeError as exc:
        raise SourceBindingError("release source manifest is not ASCII") from exc
    if not manifest_text.endswith("\n") or "\r" in manifest_text:
        raise SourceBindingError("release source manifest has invalid line framing")
    lines = manifest_text.splitlines()
    values: dict[str, str] = {}
    for line in lines:
        if line.count("=") != 1:
            raise SourceBindingError("release source manifest has an invalid entry")
        key, value = line.split("=", 1)
        if key in values:
            raise SourceBindingError("release source manifest contains a duplicate entry")
        values[key] = value
    if set(values) != {"git_sha", "trusted_ref", "prepared_utc"}:
        raise SourceBindingError("release source manifest is not closed")
    if values["git_sha"] != expected_sha:
        raise SourceBindingError("release source manifest SHA does not match")
    if not TRUSTED_REF_PATTERN.fullmatch(values["trusted_ref"]):
        raise SourceBindingError("release source manifest has an invalid trusted ref")
    if not UTC_PATTERN.fullmatch(values["prepared_utc"]):
        raise SourceBindingError("release source manifest has an invalid timestamp")


def _verify_git_tree(root: Path, expected_sha: str) -> None:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise SourceBindingError(
            "source tree is neither a trusted release nor a Git checkout"
        ) from exc
    if result.stdout.strip() != expected_sha:
        raise SourceBindingError("Git source tree does not match the expected SHA")


def verify_source(root: Path, expected_sha: str) -> str:
    if not SHA_PATTERN.fullmatch(expected_sha):
        raise SourceBindingError("expected source SHA is invalid")
    marker = root / ".akl-release-sha"
    manifest = root / ".akl-release-manifest"
    if _lexists(marker) or _lexists(manifest):
        if not (_lexists(marker) and _lexists(manifest)):
            raise SourceBindingError("release source evidence is incomplete")
        _verify_release_tree(root, expected_sha)
        return "release-marker"
    _verify_git_tree(root, expected_sha)
    return "git"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--sha", required=True)
    args = parser.parse_args()
    try:
        binding = verify_source(args.root, args.sha)
    except SourceBindingError as exc:
        raise SystemExit(f"Docling source binding failed: {exc}") from exc
    print(f"Docling source binding passed ({binding}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
