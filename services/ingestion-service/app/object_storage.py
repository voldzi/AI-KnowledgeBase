from __future__ import annotations

import hashlib
import mimetypes
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import boto3
import httpx
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.config import Settings
from app.errors import IngestionError


@dataclass(frozen=True)
class SourceObject:
    uri: str
    filename: str
    mime_type: str
    content: bytes
    sha256: str
    local_path: Path | None = None

    @property
    def size_bytes(self) -> int:
        return len(self.content)


class ObjectStorageClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._cached_s3_client = None

    async def read(self, uri: str) -> SourceObject:
        if self.settings.object_storage_mode == "mock":
            return self._mock_read(uri)
        if self.settings.object_storage_mode == "http":
            return await self._http_read(uri)
        if self.settings.object_storage_mode == "s3":
            return self._s3_read(uri)
        return self._local_read(uri)

    def readiness(self) -> str:
        if self.settings.object_storage_mode == "mock":
            return "mock"
        if self.settings.object_storage_mode == "http":
            return "ready"
        if self.settings.object_storage_mode == "s3":
            try:
                self._s3_client().head_bucket(Bucket=self.settings.s3_bucket)
                return "ready"
            except (BotoCoreError, ClientError):
                return "not_ready"
        root = self.settings.object_storage_root
        return "ready" if root.exists() and root.is_dir() else "not_ready"

    def _mock_read(self, uri: str) -> SourceObject:
        content = f"Mock object storage content for {uri}.".encode("utf-8")
        return _source_object(uri=uri, content=content, local_path=None)

    async def _http_read(self, uri: str) -> SourceObject:
        try:
            async with httpx.AsyncClient(timeout=self.settings.request_timeout_seconds) as client:
                response = await client.get(uri)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise IngestionError(
                "OBJECT_STORAGE_READ_FAILED",
                "Source file could not be read from object storage",
                status_code=502,
                details={"uri_scheme": urlparse(uri).scheme},
            ) from exc

        content = response.content
        self._validate_size(len(content))
        mime_type = response.headers.get("content-type", "").split(";")[0] or _guess_mime_type(uri)
        return _source_object(uri=uri, content=content, local_path=None, mime_type=mime_type)

    def _local_read(self, uri: str) -> SourceObject:
        path = self._local_path_for_uri(uri)
        if not path.exists() or not path.is_file():
            raise IngestionError(
                "SOURCE_FILE_NOT_FOUND",
                "Source file was not found in configured object storage",
                status_code=404,
                details={"uri_scheme": urlparse(uri).scheme or "path"},
            )
        self._validate_size(path.stat().st_size)
        content = path.read_bytes()
        return _source_object(uri=uri, content=content, local_path=path)

    def _s3_read(self, uri: str) -> SourceObject:
        parsed = urlparse(uri)
        if parsed.scheme != "s3" or not parsed.netloc or not parsed.path:
            raise IngestionError(
                "UNSUPPORTED_OBJECT_STORAGE_URI",
                "Source file URI must use s3://bucket/key in S3 mode",
                status_code=400,
                details={"uri_scheme": parsed.scheme},
            )
        bucket = parsed.netloc
        key = parsed.path.lstrip("/")
        allowed_buckets = {self.settings.s3_bucket, *self.settings.object_storage_legacy_buckets}
        if bucket not in allowed_buckets or not key or "\0" in key:
            raise IngestionError(
                "OBJECT_STORAGE_PATH_FORBIDDEN",
                "Source object is outside the configured S3 bucket",
                status_code=403,
                details={"uri_scheme": "s3"},
            )
        try:
            response = self._s3_client().get_object(Bucket=self.settings.s3_bucket, Key=key)
            content = response["Body"].read(self.settings.max_file_bytes + 1)
        except ClientError as exc:
            status = int(exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 502))
            if status == 404 and self.settings.object_storage_local_fallback_read:
                return self._local_read(uri)
            raise IngestionError(
                "SOURCE_FILE_NOT_FOUND" if status == 404 else "OBJECT_STORAGE_READ_FAILED",
                "Source file could not be read from S3 object storage",
                status_code=404 if status == 404 else 502,
                details={"uri_scheme": "s3"},
            ) from exc
        except BotoCoreError as exc:
            raise IngestionError(
                "OBJECT_STORAGE_READ_FAILED",
                "Source file could not be read from S3 object storage",
                status_code=502,
                details={"uri_scheme": "s3"},
            ) from exc
        self._validate_size(len(content))
        metadata = response.get("Metadata") or {}
        expected_sha256 = metadata.get("sha256")
        actual_sha256 = f"sha256:{hashlib.sha256(content).hexdigest()}"
        if expected_sha256 and not expected_sha256.startswith("sha256:"):
            expected_sha256 = f"sha256:{expected_sha256}"
        if expected_sha256 and expected_sha256 != actual_sha256:
            raise IngestionError(
                "OBJECT_STORAGE_INTEGRITY_FAILED",
                "S3 object SHA-256 metadata does not match its content",
                status_code=409,
                details={"uri_scheme": "s3"},
            )
        mime_type = str(response.get("ContentType") or _guess_mime_type(uri))
        return _source_object(uri=uri, content=content, local_path=None, mime_type=mime_type)

    def _s3_client(self):
        if self._cached_s3_client is None:
            self._cached_s3_client = boto3.client(
                "s3",
                endpoint_url=self.settings.s3_endpoint,
                region_name=self.settings.s3_region,
                aws_access_key_id=self.settings.s3_access_key_id,
                aws_secret_access_key=self.settings.s3_secret_access_key,
                config=Config(
                    s3={"addressing_style": "path" if self.settings.s3_force_path_style else "auto"},
                    retries={"max_attempts": 3, "mode": "standard"},
                ),
            )
        return self._cached_s3_client

    def _local_path_for_uri(self, uri: str) -> Path:
        parsed = urlparse(uri)
        if parsed.scheme == "s3":
            candidate = self.settings.object_storage_root / parsed.netloc / parsed.path.lstrip("/")
        elif parsed.scheme == "file":
            candidate = Path(parsed.path)
        elif not parsed.scheme:
            candidate = Path(uri)
            if not candidate.is_absolute():
                candidate = self.settings.object_storage_root / candidate
        else:
            raise IngestionError(
                "UNSUPPORTED_OBJECT_STORAGE_URI",
                "Unsupported source file URI for local object storage mode",
                status_code=400,
                details={"uri_scheme": parsed.scheme},
            )
        root = self.settings.object_storage_root.resolve()
        resolved = candidate.resolve()
        if resolved != root and root not in resolved.parents:
            raise IngestionError(
                "OBJECT_STORAGE_PATH_FORBIDDEN",
                "Source file is outside configured object storage",
                status_code=403,
                details={"uri_scheme": parsed.scheme or "path"},
            )
        return resolved

    def _validate_size(self, size_bytes: int) -> None:
        if size_bytes > self.settings.max_file_bytes:
            raise IngestionError(
                "SOURCE_FILE_TOO_LARGE",
                "Source file exceeds configured ingestion size limit",
                status_code=413,
                details={"size_bytes": size_bytes, "max_file_bytes": self.settings.max_file_bytes},
            )


def _source_object(
    *,
    uri: str,
    content: bytes,
    local_path: Path | None,
    mime_type: str | None = None,
) -> SourceObject:
    digest = hashlib.sha256(content).hexdigest()
    filename = _filename_for_uri(uri)
    return SourceObject(
        uri=uri,
        filename=filename,
        mime_type=mime_type or _guess_mime_type(filename),
        content=content,
        sha256=f"sha256:{digest}",
        local_path=local_path,
    )


def _filename_for_uri(uri: str) -> str:
    parsed = urlparse(uri)
    if parsed.path:
        return Path(parsed.path).name or "source"
    return Path(uri).name or "source"


def _guess_mime_type(value: str) -> str:
    suffix = Path(value).suffix.lower()
    if suffix in {".md", ".markdown"}:
        return "text/markdown"
    if suffix == ".txt":
        return "text/plain"
    mime_type, _ = mimetypes.guess_type(value)
    return mime_type or "application/octet-stream"
