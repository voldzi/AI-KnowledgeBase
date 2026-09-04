from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import tempfile

from parsers.docling import directory_sha256


SCHEMA = "akb-docling-model-sources-1"
MARKER_SCHEMA = "akb-docling-model-bundle-1"
COMMIT_PATTERN = re.compile(r"^[0-9a-f]{40}$")
DESTINATION_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$")
ALLOWED_KEYS = {
    "schema",
    "profile",
    "docling_package",
    "repositories",
    "required_files",
}
REPOSITORY_KEYS = {"repo_id", "revision", "destination", "allow_patterns"}


class ProvisionError(RuntimeError):
    pass


def download_snapshot(**kwargs):  # type: ignore[no-untyped-def]
    from huggingface_hub import snapshot_download

    return snapshot_download(**kwargs)


def _canonical_bytes(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _load_manifest(path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProvisionError("The Docling source manifest is unavailable or invalid") from exc
    if not isinstance(value, dict) or set(value) != ALLOWED_KEYS:
        raise ProvisionError("The Docling source manifest is not closed")
    if value.get("schema") != SCHEMA or value.get("profile") != "standard-cpu-v1":
        raise ProvisionError("The Docling source manifest has an unsupported contract")
    if value.get("docling_package") != "docling-slim==2.124.0":
        raise ProvisionError("The Docling package pin does not match the approved runtime")
    repositories = value.get("repositories")
    required_files = value.get("required_files")
    if not isinstance(repositories, list) or len(repositories) != 2:
        raise ProvisionError("The Docling source manifest must contain exactly two repositories")
    if (
        not isinstance(required_files, list)
        or not required_files
        or any(not isinstance(item, str) or item.startswith("/") or ".." in Path(item).parts for item in required_files)
    ):
        raise ProvisionError("The Docling required-file inventory is invalid")
    seen_destinations: set[str] = set()
    for repository in repositories:
        if not isinstance(repository, dict) or set(repository) != REPOSITORY_KEYS:
            raise ProvisionError("A Docling source repository declaration is invalid")
        repo_id = repository.get("repo_id")
        revision = repository.get("revision")
        destination = repository.get("destination")
        patterns = repository.get("allow_patterns")
        if (
            not isinstance(repo_id, str)
            or repo_id.count("/") != 1
            or not isinstance(revision, str)
            or not COMMIT_PATTERN.fullmatch(revision)
            or not isinstance(destination, str)
            or not DESTINATION_PATTERN.fullmatch(destination)
            or destination in seen_destinations
            or not isinstance(patterns, list)
            or not patterns
            or any(not isinstance(item, str) or not item or item.startswith("/") or ".." in item for item in patterns)
        ):
            raise ProvisionError("A Docling source repository pin is invalid")
        seen_destinations.add(destination)
    return value


def provision(*, manifest_path: Path, output: Path) -> dict[str, object]:
    manifest = _load_manifest(manifest_path)
    if output.exists() or output.is_symlink():
        raise ProvisionError("The Docling output path must not already exist")
    output_parent = output.parent.resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix=".akb-docling-stage-", dir=output_parent) as temporary:
        stage = Path(temporary) / "bundle"
        stage.mkdir(mode=0o700)
        repositories = manifest["repositories"]
        assert isinstance(repositories, list)
        clean_environment = {
            "HF_HUB_DISABLE_TELEMETRY": "1",
            "DO_NOT_TRACK": "1",
        }
        for key, value in clean_environment.items():
            os.environ[key] = value
        for secret_key in ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "HUGGINGFACEHUB_API_TOKEN"):
            os.environ.pop(secret_key, None)
        for repository in repositories:
            assert isinstance(repository, dict)
            destination = stage / str(repository["destination"])
            download_snapshot(
                repo_id=str(repository["repo_id"]),
                revision=str(repository["revision"]),
                local_dir=destination,
                allow_patterns=[str(item) for item in repository["allow_patterns"]],
                token=False,
            )
            shutil.rmtree(destination / ".cache", ignore_errors=True)
        for required in manifest["required_files"]:
            candidate = stage / str(required)
            if not candidate.is_file() or candidate.is_symlink() or candidate.stat().st_size <= 0:
                raise ProvisionError("The downloaded Docling bundle is incomplete")
        for candidate in stage.rglob("*"):
            if candidate.is_symlink():
                raise ProvisionError("The Docling bundle must not contain symbolic links")
        source_digest = f"sha256:{hashlib.sha256(_canonical_bytes(manifest)).hexdigest()}"
        marker = {
            "schema": MARKER_SCHEMA,
            "profile": manifest["profile"],
            "docling_package": manifest["docling_package"],
            "source_manifest_sha256": source_digest,
            "repositories": [
                {
                    "repo_id": repository["repo_id"],
                    "revision": repository["revision"],
                }
                for repository in repositories
            ],
        }
        marker_path = stage / "akb-docling-model-bundle.json"
        marker_path.write_bytes(_canonical_bytes(marker) + b"\n")
        for candidate in sorted(stage.rglob("*"), reverse=True):
            if candidate.is_file():
                candidate.chmod(stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
            elif candidate.is_dir():
                candidate.chmod(
                    stat.S_IRUSR
                    | stat.S_IWUSR
                    | stat.S_IXUSR
                    | stat.S_IRGRP
                    | stat.S_IXGRP
                    | stat.S_IROTH
                    | stat.S_IXOTH
                )
        stage.rename(output)
    for candidate in sorted(output.rglob("*"), reverse=True):
        if candidate.is_dir():
            candidate.chmod(
                stat.S_IRUSR
                | stat.S_IXUSR
                | stat.S_IRGRP
                | stat.S_IXGRP
                | stat.S_IROTH
                | stat.S_IXOTH
            )
    output.chmod(
        stat.S_IRUSR
        | stat.S_IXUSR
        | stat.S_IRGRP
        | stat.S_IXGRP
        | stat.S_IROTH
        | stat.S_IXOTH
    )
    digest = directory_sha256(output)
    return {
        "schema": "akb-docling-model-provision-result-1",
        "status": "passed",
        "profile": manifest["profile"],
        "artifacts_sha256": digest,
        "source_manifest_sha256": source_digest,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path(__file__).with_name("source-bundle.json"),
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = provision(manifest_path=args.manifest, output=args.output)
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
