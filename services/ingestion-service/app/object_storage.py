from __future__ import annotations

import hashlib
import mimetypes
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import httpx

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

    async def read(self, uri: str) -> SourceObject:
        if self.settings.object_storage_mode == "mock":
            return self._mock_read(uri)
        if self.settings.object_storage_mode == "http":
            return await self._http_read(uri)
        return self._local_read(uri)

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

    def _local_path_for_uri(self, uri: str) -> Path:
        parsed = urlparse(uri)
        if parsed.scheme == "s3":
            return self.settings.object_storage_root / parsed.netloc / parsed.path.lstrip("/")
        if parsed.scheme == "file":
            return Path(parsed.path)
        if not parsed.scheme:
            return Path(uri)
        raise IngestionError(
            "UNSUPPORTED_OBJECT_STORAGE_URI",
            "Unsupported source file URI for local object storage mode",
            status_code=400,
            details={"uri_scheme": parsed.scheme},
        )

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
    mime_type, _ = mimetypes.guess_type(value)
    return mime_type or "application/octet-stream"
