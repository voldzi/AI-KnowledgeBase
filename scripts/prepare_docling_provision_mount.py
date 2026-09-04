#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
from pathlib import Path
import stat


class MountPreparationError(RuntimeError):
    pass


def _real_directory(path: Path, label: str) -> Path:
    if path.is_symlink() or not path.is_dir():
        raise MountPreparationError(f"{label} must be a real directory")
    return path.resolve(strict=True)


def prepare_mount(*, model_root: Path, stage: Path) -> None:
    resolved_root = _real_directory(model_root, "Docling model root")
    resolved_stage = _real_directory(stage, "Docling staging directory")
    if resolved_stage.parent != resolved_root:
        raise MountPreparationError("Docling staging directory escaped its root")
    if not resolved_stage.name.startswith(".docling-standard-stage."):
        raise MountPreparationError("Docling staging directory has an invalid name")
    if any(resolved_stage.iterdir()):
        raise MountPreparationError("Docling staging directory must be empty")
    root_mode = stat.S_IMODE(resolved_root.stat().st_mode)
    if root_mode & 0o077:
        raise MountPreparationError("Docling model root must not be group or world accessible")
    stage_stat = resolved_stage.stat()
    if stage_stat.st_uid != os.geteuid() or stat.S_IMODE(stage_stat.st_mode) != 0o700:
        raise MountPreparationError("Docling staging directory ownership or mode is invalid")

    # The parent remains private. Only its bind-mounted staging directory is
    # temporarily writable by a remapped, unprivileged container user.
    resolved_stage.chmod(0o733)


def seal_mount(*, model_root: Path, stage: Path) -> None:
    resolved_root = _real_directory(model_root, "Docling model root")
    resolved_stage = _real_directory(stage, "Docling staging directory")
    if resolved_stage.parent != resolved_root:
        raise MountPreparationError("Docling staging directory escaped its root")
    resolved_stage.chmod(0o700)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("prepare", "seal"))
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--stage", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.action == "prepare":
            prepare_mount(model_root=args.model_root, stage=args.stage)
        else:
            seal_mount(model_root=args.model_root, stage=args.stage)
    except (MountPreparationError, OSError) as exc:
        parser.exit(2, f"{exc}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
