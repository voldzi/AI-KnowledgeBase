from __future__ import annotations

from io import BytesIO

from botocore.exceptions import ClientError

from app.object_storage_migration import migrate
from app.s3_storage import S3Settings


class MemoryS3:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], tuple[bytes, dict[str, str], str]] = {}

    def head_bucket(self, *, Bucket: str):
        return {"Bucket": Bucket}

    def head_object(self, *, Bucket: str, Key: str):
        item = self.objects.get((Bucket, Key))
        if item is None:
            raise ClientError(
                {"Error": {"Code": "NoSuchKey"}, "ResponseMetadata": {"HTTPStatusCode": 404}},
                "HeadObject",
            )
        content, metadata, content_type = item
        return {"ContentLength": len(content), "Metadata": metadata, "ContentType": content_type}

    def get_object(self, *, Bucket: str, Key: str):
        content, metadata, content_type = self.objects[(Bucket, Key)]
        return {"Body": BytesIO(content), "Metadata": metadata, "ContentType": content_type}

    def put_object(self, *, Bucket: str, Key: str, Body, ContentLength: int, ContentType: str, Metadata, IfNoneMatch: str):
        assert IfNoneMatch == "*"
        assert (Bucket, Key) not in self.objects
        content = Body.read()
        assert len(content) == ContentLength
        self.objects[(Bucket, Key)] = (content, Metadata, ContentType)


def settings() -> S3Settings:
    return S3Settings(
        endpoint="http://storage.test:8333",
        bucket="akb-documents",
        region="us-east-1",
        force_path_style=True,
        access_key_id="test",
        secret_access_key="test",
        legacy_buckets=("akl-documents",),
    )


def test_migration_is_verified_and_idempotent(tmp_path):
    source = tmp_path / "akl-documents" / "documents" / "doc-1" / "source.txt"
    source.parent.mkdir(parents=True)
    source.write_text("verified source", encoding="utf-8")
    client = MemoryS3()

    dry_run = migrate(
        apply=False,
        storage_root=tmp_path,
        prefix="",
        limit=None,
        source_bucket="akl-documents",
        settings=settings(),
        client=client,
    )
    assert dry_run.discovered == 1
    assert not client.objects

    applied = migrate(
        apply=True,
        storage_root=tmp_path,
        prefix="",
        limit=None,
        source_bucket="akl-documents",
        settings=settings(),
        client=client,
    )
    assert applied.uploaded == 1
    assert applied.errors == 0
    assert ("akb-documents", "documents/doc-1/source.txt") in client.objects

    repeated = migrate(
        apply=True,
        storage_root=tmp_path,
        prefix="",
        limit=None,
        source_bucket="akl-documents",
        settings=settings(),
        client=client,
    )
    assert repeated.uploaded == 0
    assert repeated.already_verified == 1
    assert repeated.conflicts == 0
