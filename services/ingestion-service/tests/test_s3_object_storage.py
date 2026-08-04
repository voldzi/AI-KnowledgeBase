from __future__ import annotations

import asyncio
import hashlib
from io import BytesIO

from app.config import load_settings
from app.object_storage import ObjectStorageClient


class RecordingS3:
    def __init__(self, content: bytes) -> None:
        self.content = content
        self.bucket = None

    def get_object(self, *, Bucket: str, Key: str):
        self.bucket = Bucket
        return {
            "Body": BytesIO(self.content),
            "ContentType": "text/plain",
            "Metadata": {"sha256": f"sha256:{hashlib.sha256(self.content).hexdigest()}"},
        }


def test_s3_reads_immutable_legacy_uri_from_canonical_bucket():
    settings = load_settings(
        {
            "AKL_OBJECT_STORAGE_MODE": "s3",
            "AKL_S3_ENDPOINT": "http://storage.home.cz:8333",
            "AKL_S3_BUCKET": "akb-documents",
            "AKL_S3_ACCESS_KEY_ID": "test-access",
            "AKL_S3_SECRET_ACCESS_KEY": "test-secret",
            "AKL_OBJECT_STORAGE_LEGACY_BUCKETS": "akl-documents",
        }
    )
    storage = ObjectStorageClient(settings)
    backend = RecordingS3(b"legacy immutable document")
    storage._cached_s3_client = backend

    result = asyncio.run(storage.read("s3://akl-documents/document/source.txt"))

    assert result.content == b"legacy immutable document"
    assert backend.bucket == "akb-documents"
