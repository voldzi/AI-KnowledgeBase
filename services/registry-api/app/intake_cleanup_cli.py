"""Operator tool: default dry-run; --apply claims before verified storage removal.

Run from an approved checkout with the Registry dependencies. This module never
connects to a database; only the dedicated Registry API can authorize deletion.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
from urllib.parse import urlsplit

import httpx

from app.intake_manifest import MAX_MANIFEST_BYTES, manifest_digest, signing_keys, verify_manifest

MANIFEST_PREFIX = ".intake/manifests/"


class S3CleanupUnavailable(ValueError):
    pass


def _parts(value):
    parts = value.split("/")
    if not parts or any(part in {"", ".", ".."} or "\\" in part or "\x00" in part for part in parts):
        raise ValueError("Unsafe storage path")
    return parts


def _open_directory(root, parts=()):
    # Walk from / via dirfds: reject symlinks in every ancestor, including root.
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in [*_parts(str(Path(root).absolute()).lstrip("/")), *parts]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        return fd
    except BaseException:
        os.close(fd)
        raise


def read_local_manifest(filename):
    path = Path(filename).absolute()
    directory = _open_directory(path.parent)
    try:
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_MANIFEST_BYTES:
                raise ValueError("Invalid manifest file")
            with os.fdopen(fd, "rb", closefd=False) as source:
                token = source.read(MAX_MANIFEST_BYTES + 1).decode("ascii")
            if len(token) > MAX_MANIFEST_BYTES:
                raise ValueError("Manifest is oversized")
            return token
        finally:
            os.close(fd)
    finally:
        os.close(directory)


def delete_local_exact(root, relative_path, manifest):
    parts = _parts(relative_path)
    try:
        directory = _open_directory(root, parts[:-1])
    except FileNotFoundError:
        return "absent"
    try:
        try:
            fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
        except FileNotFoundError:
            return "absent"
        try:
            original = os.fstat(fd)
            if not stat.S_ISREG(original.st_mode) or original.st_size != manifest.file_size:
                raise ValueError("Cleanup file metadata mismatch; object retained")
            digest = hashlib.sha256()
            count = 0
            while block := os.read(fd, 1024 * 1024):
                count += len(block)
                if count > manifest.file_size:
                    raise ValueError("Cleanup file changed; object retained")
                digest.update(block)
            current = os.stat(parts[-1], dir_fd=directory, follow_symlinks=False)
            if (count != manifest.file_size or "sha256:" + digest.hexdigest() != manifest.sha256
                or not stat.S_ISREG(current.st_mode)
                or (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns, current.st_ctime_ns)
                != (original.st_dev, original.st_ino, original.st_size, original.st_mtime_ns, original.st_ctime_ns)):
                raise ValueError("Cleanup file identity mismatch; object retained")
            # The storage root is operator-owned. Intake publishes with no-clobber
            # links; no supported writer mutates/replaces an existing object.
            os.unlink(parts[-1], dir_fd=directory)
            os.fsync(directory)
            return "deleted"
        finally:
            os.close(fd)
    finally:
        os.close(directory)


def delete_s3_exact(_client, _manifest):
    # MinIO RELEASE.2025-09-07T16-13-09Z accepts but ignores DeleteObject
    # IfMatch. No backend is enabled until an approved immutable-version delete
    # contract exists; checking a header or adding a config flag is insufficient.
    raise S3CleanupUnavailable("S3 cleanup apply is unavailable: an approved immutable-version deletion contract is required")


def validate_decisions(body, tokens, *, apply):
    expected = {manifest_digest(token) for token in tokens}
    results = body.get("results") if isinstance(body, dict) else None
    if (not isinstance(body, dict) or body.get("complete") is not True
        or body.get("reference_scope") != "all_registry_content_references"
        or not isinstance(results, list) or len(results) != len(expected)):
        raise ValueError("Incomplete authoritative reference response; retain all objects")
    seen = set()
    reference_tables = {"document_versions", "document_files", "document_publications", "external_document_refs", "document_profile_version_snapshots"}
    for result in results:
        digest = result.get("manifest_digest")
        counts = result.get("references")
        if (digest not in expected or digest in seen or not isinstance(counts, dict)
            or set(counts) != reference_tables or any(type(count) is not int or count < 0 for count in counts.values())
            or result.get("status") not in {"claimed", "eligible", "referenced", "not_expired"}
            or (result.get("status") == "claimed" and (not apply or not result.get("claim_id") or any(counts.values())))):
            raise ValueError("Invalid authoritative reference response; retain all objects")
        seen.add(digest)
    return results


def run_cleanup(args, *, http_client=None, s3_client=None):
    if args.apply and args.storage_mode == "s3":
        # Must happen before reading evidence, calling Registry claim, or making
        # any storage mutation. This is intentionally not configuration-enabled.
        raise S3CleanupUnavailable("S3 cleanup apply is unavailable: an approved immutable-version deletion contract is required")
    keys = signing_keys(os.environ.get("AKL_WEB_UPLOAD_SIGNING_SECRET"), os.environ.get("AKL_INTAKE_MANIFEST_VERIFY_KEYS"))
    if not 1 <= len(args.manifest) <= 100:
        raise ValueError("Select 1–100 durable manifest files per bounded batch")
    tokens = list(dict.fromkeys(read_local_manifest(filename) for filename in args.manifest))
    manifests = {manifest_digest(token): verify_manifest(token, keys) for token in tokens}
    if any(manifest.bucket != args.bucket for manifest in manifests.values()):
        raise ValueError("Manifest bucket is not the configured cleanup bucket")
    aliases = {item.strip() for item in os.environ.get("AKL_OBJECT_STORAGE_LEGACY_BUCKETS", "").split(",") if item.strip()}
    if aliases.difference({args.bucket}):
        raise ValueError("Cleanup requires a single canonical bucket without physical aliases")
    # A token file avoids exposing service credentials in process arguments.
    bearer = Path(args.token_file).read_text().strip()
    if not bearer or "\n" in bearer:
        raise ValueError("Invalid cleanup service token file")
    origin = urlsplit(args.registry_url)
    if (origin.username or origin.password or origin.query or origin.fragment or origin.path not in {"", "/"}
        or not origin.hostname or (origin.scheme != "https" and not
            (origin.scheme == "http" and origin.hostname in {"127.0.0.1", "localhost", "::1"}))):
        raise ValueError("Registry cleanup requires HTTPS, or an explicit local loopback endpoint")
    url = args.registry_url.rstrip("/") + "/api/v1/admin/intake-cleanup/" + ("claim" if args.apply else "dry-run")
    storage_client = s3_client
    if args.storage_mode == "s3" and storage_client is None:
        from app.s3_storage import S3Settings
        storage = S3Settings.from_env()
        if storage.bucket != args.bucket:
            raise ValueError("Cleanup bucket differs from the explicitly configured physical S3 bucket")
        storage_client = storage.client()
    client = http_client or httpx.Client(timeout=30, follow_redirects=False)
    try:
        with client.stream("POST", url, json={"manifests": tokens}, headers={"Authorization": "Bearer " + bearer}) as response:
            response.raise_for_status()
            content = bytearray()
            for block in response.iter_bytes():
                content.extend(block)
                if len(content) > 256 * 1024:
                    raise ValueError("Registry cleanup response is oversized")
            results = validate_decisions(json.loads(content), tokens, apply=args.apply)
    finally:
        if http_client is None:
            client.close()
    # Validate every identity before performing any deletion in this batch.
    for result in results:
        if result.get("source_file_uri") != manifests[result["manifest_digest"]].source_file_uri:
            raise ValueError("Registry cleanup returned a different object identity")
    for result in results:
        if not args.apply or result["status"] != "claimed":
            continue
        manifest = manifests[result["manifest_digest"]]
        outcomes = {}
        if args.storage_mode == "local":
            outcomes["promoted"] = delete_local_exact(args.object_root, manifest.bucket + "/" + manifest.object_key, manifest)
        else:
            outcomes["promoted"] = delete_s3_exact(storage_client, manifest)
        if args.quarantine_root:
            for status in ("pending", "failed", "infected"):
                outcomes[status] = delete_local_exact(args.quarantine_root, f"{status}/{manifest.session_id}/{manifest.file_name}", manifest)
        result["storage"] = outcomes
    # Manifests and tombstones stay durable for idempotent retry, including a
    # scanner/upload that finished late and recreated the exact unreferenced blob.
    return {"mode": "apply" if args.apply else "dry-run", "results": results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", action="append", required=True, help="Durable manifest file; repeat at most 100 times")
    parser.add_argument("--registry-url", required=True)
    parser.add_argument("--token-file", required=True)
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--storage-mode", choices=("local", "s3"), required=True)
    parser.add_argument("--object-root", help="Exact local object store root")
    parser.add_argument("--quarantine-root", help="Exact quarantine root on this web node")
    parser.add_argument("--apply", action="store_true", help="Claim and remove exact expired unreferenced local content; S3 apply is unavailable")
    args = parser.parse_args()
    if args.storage_mode == "local" and not args.object_root:
        parser.error("--object-root is required for local storage")
    try:
        print(json.dumps(run_cleanup(args), sort_keys=True))
    except S3CleanupUnavailable as exc:
        print(f"S3_CLEANUP_APPLY_UNAVAILABLE: {exc}", file=sys.stderr)
        return 2
    except Exception:
        # Never dump HTTP bearer, signed evidence, environment or document content.
        print("Intake cleanup stopped; retain objects and inspect the Registry trace and configuration.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
