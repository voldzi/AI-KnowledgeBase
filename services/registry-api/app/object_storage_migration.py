"""Idempotently copy the legacy AKB filesystem bridge into S3."""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import quote

from botocore.exceptions import ClientError

from app.s3_storage import S3Settings

CHUNK_BYTES = 1024 * 1024


@dataclass
class MigrationResult:
    discovered: int = 0
    uploaded: int = 0
    already_verified: int = 0
    conflicts: int = 0
    errors: int = 0
    bytes_verified: int = 0


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while block := source.read(CHUNK_BYTES):
            digest.update(block)
    return f"sha256:{digest.hexdigest()}"


def _key_fingerprint(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def _remote_descriptor(client, bucket: str, key: str) -> dict | None:
    try:
        return client.head_object(Bucket=bucket, Key=key)
    except ClientError as exc:
        status = int(exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 0))
        if status == 404:
            return None
        raise


def _remote_sha256(client, bucket: str, key: str, descriptor: dict) -> str:
    metadata = descriptor.get("Metadata") or {}
    value = metadata.get("sha256")
    if value:
        return value if value.startswith("sha256:") else f"sha256:{value}"
    response = client.get_object(Bucket=bucket, Key=key)
    digest = hashlib.sha256()
    while block := response["Body"].read(CHUNK_BYTES):
        digest.update(block)
    return f"sha256:{digest.hexdigest()}"


def migrate(
    *,
    apply: bool,
    storage_root: Path,
    prefix: str,
    limit: int | None,
    source_bucket: str,
    settings: S3Settings | None = None,
    client=None,
) -> MigrationResult:
    settings = settings or S3Settings.from_env()
    client = client or settings.client()
    client.head_bucket(Bucket=settings.bucket)
    bucket_root = (storage_root / source_bucket).resolve()
    if not bucket_root.is_dir():
        raise RuntimeError("Local bucket root is not available")
    files = sorted(item for item in bucket_root.rglob("*") if item.is_file())
    if prefix:
        files = [item for item in files if item.relative_to(bucket_root).as_posix().startswith(prefix)]
    if limit is not None:
        files = files[:limit]

    result = MigrationResult(discovered=len(files))
    for source in files:
        key = source.relative_to(bucket_root).as_posix()
        size = source.stat().st_size
        digest = _sha256(source)
        try:
            remote = _remote_descriptor(client, settings.bucket, key)
            if remote is not None:
                remote_size = int(remote.get("ContentLength", -1))
                remote_digest = _remote_sha256(client, settings.bucket, key, remote)
                if remote_size != size or remote_digest != digest:
                    result.conflicts += 1
                    print(json.dumps({"key_sha256": _key_fingerprint(key), "status": "conflict"}))
                    continue
                result.already_verified += 1
                result.bytes_verified += size
                print(json.dumps({"key_sha256": _key_fingerprint(key), "status": "already_verified", "size_bytes": size}))
                continue
            if not apply:
                print(json.dumps({"key_sha256": _key_fingerprint(key), "status": "would_upload", "size_bytes": size}))
                continue
            content_type = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
            with source.open("rb") as body:
                client.put_object(
                    Bucket=settings.bucket,
                    Key=key,
                    Body=body,
                    ContentLength=size,
                    ContentType=content_type,
                    Metadata={
                        "sha256": digest,
                        "original-filename": quote(source.name, safe=""),
                    },
                    IfNoneMatch="*",
                )
            verified = _remote_descriptor(client, settings.bucket, key)
            if verified is None or int(verified.get("ContentLength", -1)) != size:
                raise RuntimeError("Uploaded object size verification failed")
            if _remote_sha256(client, settings.bucket, key, verified) != digest:
                raise RuntimeError("Uploaded object SHA-256 verification failed")
            result.uploaded += 1
            result.bytes_verified += size
            print(json.dumps({"key_sha256": _key_fingerprint(key), "status": "uploaded", "size_bytes": size}))
        except Exception as exc:  # Per-object errors are reported and make the command fail.
            result.errors += 1
            print(json.dumps({"key_sha256": _key_fingerprint(key), "status": "error", "reason": type(exc).__name__}))
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Copy AKB local document objects to S3")
    parser.add_argument("--apply", action="store_true", help="Upload missing objects")
    parser.add_argument(
        "--storage-root",
        default=os.getenv("AKL_OBJECT_STORAGE_ROOT", "/data/object-storage"),
    )
    parser.add_argument("--prefix", default="")
    parser.add_argument(
        "--source-bucket",
        default=os.getenv("AKL_OBJECT_STORAGE_LEGACY_BUCKET", "akl-documents"),
    )
    parser.add_argument("--limit", type=int)
    parser.add_argument("--report")
    args = parser.parse_args()
    if args.limit is not None and args.limit <= 0:
        parser.error("--limit must be greater than zero")
    result = migrate(
        apply=args.apply,
        storage_root=Path(args.storage_root),
        prefix=args.prefix.strip("/"),
        limit=args.limit,
        source_bucket=args.source_bucket,
    )
    report = {"mode": "apply" if args.apply else "dry-run", **asdict(result)}
    encoded = json.dumps(report, sort_keys=True)
    print(encoded)
    if args.report:
        Path(args.report).write_text(encoded + "\n", encoding="utf-8")
    return 1 if result.errors or result.conflicts else 0


if __name__ == "__main__":
    raise SystemExit(main())
