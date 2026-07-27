"""Controlled, resumable ClamAV rescan for legacy AKB document files."""

from __future__ import annotations

import argparse
import hashlib
import os
import socket
import struct
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from sqlalchemy import or_, select

from app.audit import add_audit_event
from app.database import SessionLocal
from app.models import DocumentFile

CHUNK_BYTES = 64 * 1024
MAX_RESPONSE_BYTES = 8 * 1024
SYSTEM_ACTOR = "system:akb-content-security-backfill"


class ScanError(RuntimeError):
    pass


def _endpoint() -> tuple[str, int]:
    parsed = urlparse(os.getenv("STRATOS_CONTENT_SECURITY_ENDPOINT", "tcp://clamav:3310"))
    if parsed.scheme != "tcp" or not parsed.hostname or not parsed.port:
        raise ScanError("scanner_endpoint_invalid")
    return parsed.hostname, parsed.port


def _source_path(uri: str, storage_root: Path) -> Path:
    parsed = urlparse(uri)
    if parsed.scheme != "s3" or not parsed.netloc or not parsed.path:
        raise ScanError("unsupported_source_uri")
    root = storage_root.resolve()
    candidate = (root / parsed.netloc / parsed.path.lstrip("/")).resolve()
    if root not in candidate.parents or not candidate.is_file():
        raise ScanError("source_object_unavailable")
    return candidate


def _response(connection: socket.socket) -> str:
    data = bytearray()
    while len(data) < MAX_RESPONSE_BYTES:
        block = connection.recv(min(1024, MAX_RESPONSE_BYTES - len(data)))
        if not block:
            break
        data.extend(block)
        if b"\0" in block or b"\n" in block:
            break
    value = bytes(data).rstrip(b"\0\r\n").decode("utf-8", errors="replace")
    if not value:
        raise ScanError("scanner_empty_response")
    return value


def _version(timeout_seconds: float) -> str:
    host, port = _endpoint()
    with socket.create_connection((host, port), timeout=timeout_seconds) as connection:
        connection.settimeout(timeout_seconds)
        connection.sendall(b"zVERSION\0")
        return _response(connection)


def scan_file(path: Path, timeout_seconds: float) -> tuple[str, str | None, str, str | None, int, str]:
    version = _version(timeout_seconds).removeprefix("ClamAV ")
    engine_version, _, signature_version = version.partition("/")
    host, port = _endpoint()
    digest = hashlib.sha256()
    size = 0
    with socket.create_connection((host, port), timeout=timeout_seconds) as connection:
        connection.settimeout(timeout_seconds)
        connection.sendall(b"zINSTREAM\0")
        with path.open("rb") as source:
            while block := source.read(CHUNK_BYTES):
                size += len(block)
                digest.update(block)
                connection.sendall(struct.pack("!I", len(block)))
                connection.sendall(block)
        connection.sendall(struct.pack("!I", 0))
        response = _response(connection)
    if response.endswith(" OK"):
        status, signature = "clean", None
    elif " FOUND" in response:
        status, signature = "infected", response.removesuffix(" FOUND").rsplit(": ", 1)[-1]
    else:
        raise ScanError("scanner_invalid_response")
    return status, signature, engine_version or "clamav", signature_version or None, size, f"sha256:{digest.hexdigest()}"


def rescan(*, apply: bool, limit: int, retry_failures: bool, timeout_seconds: float, storage_root: Path) -> int:
    run_id = f"scan_{uuid4().hex}"
    with SessionLocal() as db:
        failed_statuses = ["scan_error", "integrity_error"] if retry_failures else []
        candidate_filter = DocumentFile.content_security_status.is_(None)
        if failed_statuses:
            candidate_filter = or_(candidate_filter, DocumentFile.content_security_status.in_(failed_statuses))
        files = list(db.scalars(select(DocumentFile).where(candidate_filter).order_by(DocumentFile.uploaded_at, DocumentFile.file_id).limit(limit)))
        if not apply:
            print(f"dry_run candidates={len(files)} limit={limit} run_id={run_id}")
            return 0
        for file in files:
            outcome = "scan_error"
            metadata: dict[str, object] = {"run_id": run_id, "file_id": file.file_id}
            try:
                path = _source_path(file.uri, storage_root)
                status, signature, engine, signatures, size, sha256 = scan_file(path, timeout_seconds)
                if file.size_bytes is not None and file.size_bytes != size:
                    raise ScanError("registered_size_mismatch")
                if file.sha256 and file.sha256.lower() != sha256:
                    raise ScanError("registered_sha256_mismatch")
                outcome = status
                file.content_security_status = status
                file.content_security_engine = "clamav"
                file.content_security_engine_version = engine
                file.content_security_signature_version = signatures
                file.content_security_scanned_at = datetime.now(timezone.utc)
                file.content_security_attestation_sha256 = None
                metadata.update({"outcome": status, "engine": "clamav", "signature_version": signatures})
                if signature:
                    metadata["signature_name"] = signature
            except ScanError as error:
                outcome = "integrity_error" if str(error).startswith("registered_") else "scan_error"
                file.content_security_status = outcome
                file.content_security_engine = "clamav"
                file.content_security_scanned_at = datetime.now(timezone.utc)
                metadata.update({"outcome": outcome, "reason": str(error)})
            add_audit_event(db, actor_id=SYSTEM_ACTOR, event_type="document.content_security.rescanned", resource_type="document_file", resource_id=file.file_id, severity="warning" if outcome != "clean" else "info", metadata=metadata, correlation_id=run_id)
            db.commit()
            print(f"file_id={file.file_id} outcome={outcome}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Controlled AKB ClamAV rescan")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--retry-failures", action="store_true")
    parser.add_argument("--timeout-seconds", type=float, default=120.0)
    parser.add_argument("--storage-root", default=os.getenv("AKL_CONTENT_SECURITY_STORAGE_ROOT", "/data/object-storage"))
    args = parser.parse_args()
    if not 1 <= args.limit <= 100:
        parser.error("--limit must be between 1 and 100")
    return rescan(apply=args.apply, limit=args.limit, retry_failures=args.retry_failures, timeout_seconds=args.timeout_seconds, storage_root=Path(args.storage_root))


if __name__ == "__main__":
    raise SystemExit(main())
