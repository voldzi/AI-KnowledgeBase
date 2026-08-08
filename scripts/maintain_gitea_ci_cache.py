#!/usr/bin/env python3
"""Apply bounded, operator-approved retention to the AKB Gitea CI cache."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_CACHE_ROOT = Path("/home/stratos-ci/.cache/akb-ci")
DEFAULT_MAX_BYTES = 10 * 1024**3
FILE_CACHE_NAMES = {"npm", "pip", "pnpm", "pnpm-store"}
TREE_CACHE_NAMES = {"gitleaks", "next", "playwright"}


def directory_size(path: Path) -> int:
    if path.is_symlink():
        return 0
    if path.is_file():
        return path.stat().st_size
    total = 0
    for entry in path.rglob("*"):
        if entry.is_file() and not entry.is_symlink():
            total += entry.stat().st_size
    return total


def newest_mtime(path: Path) -> float:
    if path.is_symlink() or path.is_file():
        return path.lstat().st_mtime
    latest = path.stat().st_mtime
    for entry in path.rglob("*"):
        if not entry.is_symlink():
            latest = max(latest, entry.stat().st_mtime)
    return latest


def cache_units(root: Path) -> tuple[list[Path], list[str]]:
    units: list[Path] = []
    unknown: list[str] = []
    if not root.exists():
        return units, unknown
    for child in sorted(root.iterdir()):
        if child.name in FILE_CACHE_NAMES:
            units.extend(
                entry
                for entry in child.rglob("*")
                if entry.is_file() and not entry.is_symlink()
            )
        elif child.name in TREE_CACHE_NAMES:
            units.extend(sorted(child.iterdir()) if child.is_dir() else [child])
        else:
            unknown.append(child.name)
    return units, unknown


def safe_remove(path: Path, root: Path) -> None:
    root_resolved = root.resolve()
    parent_resolved = path.parent.resolve()
    if root_resolved != parent_resolved and root_resolved not in parent_resolved.parents:
        raise RuntimeError(f"Refusing to remove a path outside the cache root: {path}")
    if path.is_symlink() or path.is_file():
        path.unlink(missing_ok=True)
    elif path.is_dir():
        shutil.rmtree(path)


def prune_empty_directories(root: Path) -> None:
    directories = sorted(
        (path for path in root.rglob("*") if path.is_dir() and not path.is_symlink()),
        key=lambda path: len(path.parts),
        reverse=True,
    )
    for directory in directories:
        try:
            directory.rmdir()
        except OSError:
            pass


def select_evictions(
    root: Path, *, retention_days: int, max_bytes: int, now: float
) -> tuple[list[dict[str, Any]], int, int, list[str]]:
    units, unknown = cache_units(root)
    original_bytes = directory_size(root)
    remaining_bytes = original_bytes
    cutoff = now - retention_days * 86400
    selected: list[dict[str, Any]] = []
    retained: list[tuple[float, Path, int]] = []

    for path in units:
        size = directory_size(path)
        mtime = newest_mtime(path)
        if mtime < cutoff:
            selected.append({"path": str(path), "bytes": size, "reason": "retention"})
            remaining_bytes -= size
        else:
            retained.append((mtime, path, size))

    for _mtime, path, size in sorted(retained, key=lambda item: (item[0], str(item[1]))):
        if remaining_bytes <= max_bytes:
            break
        selected.append({"path": str(path), "bytes": size, "reason": "size_limit"})
        remaining_bytes -= size

    return selected, original_bytes, max(0, remaining_bytes), unknown


def read_token(path: Path) -> str:
    if path.stat().st_mode & 0o077:
        raise RuntimeError("The Gitea token file must not be accessible by group or others")
    token = path.read_text(encoding="utf-8").strip()
    if not token:
        raise RuntimeError("The Gitea token file is empty")
    return token


def verify_runner_idle(
    *, gitea_url: str, repository: str, runner_id: int, token_file: Path
) -> dict[str, Any]:
    owner, repo = repository.split("/", 1)
    url = f"{gitea_url.rstrip('/')}/api/v1/repos/{owner}/{repo}/actions/runners"
    request = Request(url, headers={"Authorization": f"token {read_token(token_file)}"})
    try:
        with urlopen(request, timeout=10) as response:  # noqa: S310 - configured internal URL
            payload = json.load(response)
    except (HTTPError, URLError, TimeoutError) as exc:
        raise RuntimeError("Unable to verify the AKB Gitea runner state") from exc
    runner = next((item for item in payload.get("runners", []) if item.get("id") == runner_id), None)
    if runner is None:
        raise RuntimeError(f"AKB runner ID {runner_id} is not repository-scoped to {repository}")
    if runner.get("status") != "online" or runner.get("busy") is not False:
        raise RuntimeError(f"AKB runner ID {runner_id} is not online and idle")
    return {"id": runner_id, "name": runner.get("name"), "status": "online", "busy": False}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-root", type=Path, default=DEFAULT_CACHE_ROOT)
    parser.add_argument("--retention-days", type=int, default=14)
    parser.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES)
    parser.add_argument("--gitea-url", default="https://git.home.cz")
    parser.add_argument("--repository", default="AKB/ai-knowledgebase")
    parser.add_argument("--runner-id", type=int, default=6)
    parser.add_argument("--token-file", type=Path)
    parser.add_argument("--apply", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.retention_days < 1 or args.max_bytes < 1:
        raise SystemExit("retention-days and max-bytes must be positive")
    if args.apply and args.token_file is None:
        raise SystemExit("--apply requires --token-file for the repository-scoped idle check")

    root = args.cache_root.resolve()
    if not root.is_dir():
        raise SystemExit(f"The AKB cache root does not exist: {root}")
    lock_path = root.parent / "akb-ci-cache-maintenance.lock"
    with lock_path.open("a+", encoding="utf-8") as lock_file:
        os.chmod(lock_path, 0o600)
        try:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise SystemExit("Another AKB cache maintenance process is running") from exc

        runner = None
        if args.token_file is not None:
            runner = verify_runner_idle(
                gitea_url=args.gitea_url,
                repository=args.repository,
                runner_id=args.runner_id,
                token_file=args.token_file,
            )
        selected, before, estimated_after, unknown = select_evictions(
            root,
            retention_days=args.retention_days,
            max_bytes=args.max_bytes,
            now=time.time(),
        )
        if unknown:
            raise SystemExit(
                "Unknown entries in the dedicated AKB cache root; refusing cleanup: "
                + ", ".join(unknown)
            )
        if args.apply:
            for item in selected:
                safe_remove(Path(item["path"]), root)
            prune_empty_directories(root)
        after = directory_size(root) if args.apply else estimated_after
        result = {
            "mode": "apply" if args.apply else "dry-run",
            "cache_root": str(root),
            "retention_days": args.retention_days,
            "max_bytes": args.max_bytes,
            "bytes_before": before,
            "bytes_after": after,
            "eviction_count": len(selected),
            "evictions": selected,
            "runner": runner,
        }
        print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
