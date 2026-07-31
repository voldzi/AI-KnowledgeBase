from __future__ import annotations

import asyncio
import hashlib
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from app.config import Settings
from app.errors import IngestionError
from app.object_storage import ObjectStorageClient


SUPPORTED_SUFFIXES = frozenset(
    {
        ".doc",
        ".docx",
        ".odt",
        ".rtf",
        ".xls",
        ".xlsx",
        ".xlsm",
        ".ods",
        ".ppt",
        ".pptx",
        ".odp",
    }
)
PDF_MAGIC = b"%PDF-"


@dataclass(frozen=True)
class PdfRendition:
    content: bytes
    sha256: str
    source_sha256: str
    engine: str
    engine_revision: str
    cache_status: str


class PdfRenditionService:
    def __init__(self, settings: Settings, object_storage: ObjectStorageClient) -> None:
        self.settings = settings
        self.object_storage = object_storage
        self._conversion_lock = asyncio.Lock()

    def readiness(self) -> str:
        if not self.settings.rendition_enabled:
            return "disabled"
        return (
            "ready"
            if shutil.which(self.settings.rendition_command) is not None
            else "not_ready"
        )

    async def render(
        self,
        *,
        source_file_uri: str,
        expected_source_sha256: str,
    ) -> PdfRendition:
        if not self.settings.rendition_enabled:
            raise IngestionError(
                "DOCUMENT_RENDITION_DISABLED",
                "Document rendition is not enabled",
                status_code=503,
            )
        source = await self.object_storage.read(source_file_uri)
        if source.sha256 != expected_source_sha256:
            raise IngestionError(
                "DOCUMENT_RENDITION_SOURCE_HASH_MISMATCH",
                "The rendition source does not match the authorized immutable version",
                status_code=409,
            )
        suffix = Path(source.filename).suffix.lower()
        if suffix not in SUPPORTED_SUFFIXES:
            raise IngestionError(
                "DOCUMENT_RENDITION_FORMAT_UNSUPPORTED",
                "The source format has no faithful PDF rendition",
                status_code=415,
                details={"source_suffix": suffix or "none"},
            )

        source_digest = expected_source_sha256.removeprefix("sha256:")
        cache_path = self._cache_path(source_digest)
        async with self._conversion_lock:
            cached = await asyncio.to_thread(self._read_cached, cache_path)
            if cached is not None:
                return self._result(cached, expected_source_sha256, "hit")
            rendered = await asyncio.to_thread(
                self._convert,
                source.content,
                suffix,
                cache_path,
            )
            return self._result(rendered, expected_source_sha256, "miss")

    def _cache_path(self, source_digest: str) -> Path:
        cache_root = (
            self.settings.rendition_cache_root
            / self.settings.rendition_engine_revision
        ).resolve()
        return cache_root / source_digest[:2] / f"{source_digest}.pdf"

    def _read_cached(self, cache_path: Path) -> bytes | None:
        try:
            content = cache_path.read_bytes()
        except FileNotFoundError:
            return None
        self._validate_pdf(content)
        return content

    def _convert(self, content: bytes, suffix: str, cache_path: Path) -> bytes:
        command = shutil.which(self.settings.rendition_command)
        if command is None:
            raise IngestionError(
                "DOCUMENT_RENDITION_ENGINE_UNAVAILABLE",
                "The document rendition engine is unavailable",
                status_code=503,
            )

        with tempfile.TemporaryDirectory(prefix="akb-rendition-") as work_dir_value:
            work_dir = Path(work_dir_value)
            source_path = work_dir / f"source{suffix}"
            output_dir = work_dir / "output"
            profile_dir = work_dir / "profile"
            cache_dir = work_dir / "cache"
            output_dir.mkdir(mode=0o700)
            profile_dir.mkdir(mode=0o700)
            cache_dir.mkdir(mode=0o700)
            source_path.write_bytes(content)
            source_path.chmod(0o400)

            env = {
                "HOME": str(work_dir),
                "PATH": os.environ.get("PATH", ""),
                "TMPDIR": str(work_dir),
                "XDG_CACHE_HOME": str(cache_dir),
                "SAL_USE_VCLPLUGIN": "svp",
            }
            try:
                completed = subprocess.run(
                    [
                        command,
                        "--headless",
                        "--safe-mode",
                        "--nologo",
                        "--nodefault",
                        "--norestore",
                        "--nolockcheck",
                        "--nofirststartwizard",
                        f"-env:UserInstallation=file://{profile_dir}",
                        "--convert-to",
                        "pdf",
                        "--outdir",
                        str(output_dir),
                        str(source_path),
                    ],
                    check=False,
                    capture_output=True,
                    env=env,
                    timeout=self.settings.rendition_timeout_seconds,
                )
            except subprocess.TimeoutExpired as exc:
                raise IngestionError(
                    "DOCUMENT_RENDITION_TIMEOUT",
                    "The document rendition exceeded its processing limit",
                    status_code=504,
                ) from exc

            output_path = output_dir / "source.pdf"
            if completed.returncode != 0 or not output_path.is_file():
                raise IngestionError(
                    "DOCUMENT_RENDITION_FAILED",
                    "The document could not be converted to a faithful preview",
                    status_code=422,
                    details={"engine_exit_code": completed.returncode},
                )
            rendered = output_path.read_bytes()
            self._validate_pdf(rendered)
            cache_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            temporary_cache = cache_path.with_suffix(".pdf.tmp")
            temporary_cache.write_bytes(rendered)
            temporary_cache.chmod(0o600)
            os.replace(temporary_cache, cache_path)
            return rendered

    def _validate_pdf(self, content: bytes) -> None:
        if not content.startswith(PDF_MAGIC):
            raise IngestionError(
                "DOCUMENT_RENDITION_OUTPUT_INVALID",
                "The rendition engine did not produce a valid PDF",
                status_code=502,
            )
        if len(content) > self.settings.rendition_max_output_bytes:
            raise IngestionError(
                "DOCUMENT_RENDITION_OUTPUT_TOO_LARGE",
                "The rendered preview exceeds its size limit",
                status_code=413,
                details={
                    "size_bytes": len(content),
                    "max_size_bytes": self.settings.rendition_max_output_bytes,
                },
            )

    def _result(
        self,
        content: bytes,
        source_sha256: str,
        cache_status: str,
    ) -> PdfRendition:
        digest = hashlib.sha256(content).hexdigest()
        return PdfRendition(
            content=content,
            sha256=f"sha256:{digest}",
            source_sha256=source_sha256,
            engine="libreoffice",
            engine_revision=self.settings.rendition_engine_revision,
            cache_status=cache_status,
        )
