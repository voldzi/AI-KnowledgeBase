#!/usr/bin/env python3
"""Verify the complete AKB object lifecycle against an S3-compatible backend."""

from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path
from uuid import uuid4

import boto3
from botocore.config import Config


def secret(value_key: str, file_key: str) -> str:
    file_path = os.getenv(file_key)
    if file_path:
        return Path(file_path).read_text(encoding="utf-8").strip()
    return os.getenv(value_key, "").strip()


def main() -> int:
    endpoint = os.getenv("AKL_S3_ENDPOINT", "").rstrip("/")
    bucket = os.getenv("AKL_S3_BUCKET", "akb-documents")
    access_key = secret("AKL_S3_ACCESS_KEY_ID", "AKL_S3_ACCESS_KEY_ID_FILE")
    secret_key = secret("AKL_S3_SECRET_ACCESS_KEY", "AKL_S3_SECRET_ACCESS_KEY_FILE")
    if not endpoint or not access_key or not secret_key:
        print("S3 endpoint and credential files are required", file=sys.stderr)
        return 2

    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=os.getenv("AKL_S3_REGION", "us-east-1"),
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(s3={"addressing_style": "path"}, retries={"max_attempts": 3}),
    )
    key = f"_akb_smoke/{uuid4().hex}.txt"
    content = b"AKB S3 lifecycle smoke\n"
    digest = hashlib.sha256(content).hexdigest()
    try:
        client.head_bucket(Bucket=bucket)
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=content,
            ContentType="text/plain",
            Metadata={"sha256": f"sha256:{digest}", "original-filename": "smoke.txt"},
            IfNoneMatch="*",
        )
        head = client.head_object(Bucket=bucket, Key=key)
        assert head["ContentLength"] == len(content)
        response = client.get_object(Bucket=bucket, Key=key)
        downloaded = response["Body"].read()
        assert hashlib.sha256(downloaded).hexdigest() == digest
        listing = client.list_objects_v2(Bucket=bucket, Prefix=key)
        assert any(item.get("Key") == key for item in listing.get("Contents", []))
    finally:
        client.delete_object(Bucket=bucket, Key=key)
    try:
        client.head_object(Bucket=bucket, Key=key)
    except client.exceptions.ClientError as exc:
        assert exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 404
    else:
        raise AssertionError("S3 delete verification failed")
    print("AKB S3 lifecycle smoke: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
