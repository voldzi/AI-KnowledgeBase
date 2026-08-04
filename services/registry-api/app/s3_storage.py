"""Shared S3 configuration for Registry maintenance commands."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Mapping

import boto3
from botocore.config import Config


class S3ConfigurationError(RuntimeError):
    pass


def _secret(source: Mapping[str, str], value_key: str, file_key: str) -> str | None:
    file_value = source.get(file_key)
    if file_value:
        try:
            value = Path(file_value).read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise S3ConfigurationError(f"{file_key} could not be read") from exc
        if not value:
            raise S3ConfigurationError(f"{file_key} must not be empty")
        return value
    return source.get(value_key) or None


@dataclass(frozen=True)
class S3Settings:
    endpoint: str
    bucket: str
    region: str
    force_path_style: bool
    access_key_id: str
    secret_access_key: str
    legacy_buckets: tuple[str, ...]

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "S3Settings":
        source = os.environ if env is None else env
        endpoint = source.get("AKL_S3_ENDPOINT", "").rstrip("/")
        bucket = source.get("AKL_S3_BUCKET", "akl-documents")
        access_key_id = _secret(source, "AKL_S3_ACCESS_KEY_ID", "AKL_S3_ACCESS_KEY_ID_FILE")
        secret_access_key = _secret(
            source,
            "AKL_S3_SECRET_ACCESS_KEY",
            "AKL_S3_SECRET_ACCESS_KEY_FILE",
        )
        if not endpoint or not access_key_id or not secret_access_key:
            raise S3ConfigurationError("S3 endpoint and credentials are required")
        return cls(
            endpoint=endpoint,
            bucket=bucket,
            region=source.get("AKL_S3_REGION", "us-east-1"),
            force_path_style=source.get("AKL_S3_FORCE_PATH_STYLE", "true").lower()
            in {"1", "true", "yes", "on"},
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            legacy_buckets=tuple(
                item.strip()
                for item in source.get("AKL_OBJECT_STORAGE_LEGACY_BUCKETS", "").split(",")
                if item.strip()
            ),
        )

    def client(self):
        return boto3.client(
            "s3",
            endpoint_url=self.endpoint,
            region_name=self.region,
            aws_access_key_id=self.access_key_id,
            aws_secret_access_key=self.secret_access_key,
            config=Config(
                s3={"addressing_style": "path" if self.force_path_style else "auto"},
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )


def open_s3_body(settings: S3Settings, key: str) -> tuple[BinaryIO, dict]:
    response = settings.client().get_object(Bucket=settings.bucket, Key=key)
    return response["Body"], response


def physical_bucket(settings: S3Settings, logical_bucket: str) -> str:
    if logical_bucket == settings.bucket or logical_bucket in settings.legacy_buckets:
        return settings.bucket
    raise S3ConfigurationError("S3 source bucket is not allowed")
