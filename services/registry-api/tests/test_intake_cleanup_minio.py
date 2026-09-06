"""Opt-in disposable backend QA. Never targets an existing object store."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
from types import SimpleNamespace
from uuid import uuid4

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
import httpx
import pytest

from app.config import get_settings
from app.intake_cleanup_cli import delete_s3_exact, run_cleanup
from test_intake_cleanup import CONTENT, SECRET, manifest_token, parsed


@pytest.fixture(scope="module")
def isolated_minio(tmp_path_factory):
    image = os.getenv("AKB_INTAKE_CLEANUP_TEST_MINIO_IMAGE")
    if not image:
        pytest.skip("An explicitly selected already-local MinIO image is required")
    assert image.startswith("sha256:") and len(image) == 71
    root = tmp_path_factory.mktemp("intake-minio").resolve()
    credentials = root / "synthetic-credentials.env"
    access, secret = "qa"+secrets.token_hex(12), secrets.token_hex(32)
    credentials.write_text(f"MINIO_ROOT_USER={access}\nMINIO_ROOT_PASSWORD={secret}\n")
    credentials.chmod(0o600)
    name = "akb-intake-cleanup-qa-"+uuid4().hex
    created = False
    try:
        version = subprocess.run(["docker", "run", "--rm", "--pull=never", "--entrypoint", "minio", image, "--version"],
                                 capture_output=True, text=True, timeout=20)
        assert version.returncode == 0, "Local MinIO image version probe failed"
        result = subprocess.run(["docker", "run", "--detach", "--pull=never", "--name", name,
            "--env-file", str(credentials), "--publish", "127.0.0.1::9000", "--tmpfs", "/data:rw,size=67108864",
            image, "server", "/data", "--address", ":9000"], capture_output=True, text=True, timeout=20)
        assert result.returncode == 0, "Disposable MinIO creation failed"
        created = True
        inspected = subprocess.run(["docker", "inspect", "--format", "{{json .NetworkSettings.Ports}}", name],
                                    capture_output=True, text=True, timeout=10)
        port = json.loads(inspected.stdout)["9000/tcp"][0]
        assert port["HostIp"] == "127.0.0.1"
        endpoint = "http://127.0.0.1:"+port["HostPort"]
        with httpx.Client(timeout=1) as http:
            for _ in range(50):
                try:
                    if http.get(endpoint+"/minio/health/ready").status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(0.1)
            else:
                pytest.fail("Disposable MinIO did not become ready")
        client = boto3.client("s3", endpoint_url=endpoint, region_name="us-east-1", aws_access_key_id=access,
                              aws_secret_access_key=secret, config=Config(signature_version="s3v4", s3={"addressing_style": "path"}))
        print("Isolated MinIO version:", version.stdout.splitlines()[0], "image:", image)
        yield client
    finally:
        if created:
            subprocess.run(["docker", "rm", "--force", name], capture_output=True, timeout=20, check=True)
        credentials.unlink(missing_ok=True)


def fresh_object(client, *, versioned=False):
    bucket = "cleanup-qa-"+uuid4().hex
    client.create_bucket(Bucket=bucket)
    if versioned:
        client.put_bucket_versioning(Bucket=bucket, VersioningConfiguration={"Status": "Enabled"})
    token = manifest_token(bucket=bucket, source_file_uri=f"s3://{bucket}/{parsed().object_key}")
    manifest = parsed(token)
    response = client.put_object(Bucket=bucket, Key=manifest.object_key, Body=CONTENT)
    return token, manifest, response


def test_actual_minio_conditional_delete_capability_is_known_unsupported(isolated_minio):
    client = isolated_minio
    _, manifest, response = fresh_object(client)
    # Capability probe on a disposable synthetic object, not an acceptance test
    # of the production adapter: this release ignores the failed precondition.
    deleted = client.delete_object(Bucket=manifest.bucket, Key=manifest.object_key, IfMatch='"incorrect-etag"')
    assert deleted["ResponseMetadata"]["HTTPStatusCode"] == 204
    with pytest.raises(ClientError) as exc:
        client.head_object(Bucket=manifest.bucket, Key=manifest.object_key)
    assert exc.value.response["ResponseMetadata"]["HTTPStatusCode"] == 404
    print("Conditional DeleteObject capability: UNSUPPORTED; mismatched IfMatch deleted the synthetic object. S3 apply remains disabled.")
    _, manifest, response = fresh_object(client)
    client.delete_object(Bucket=manifest.bucket, Key=manifest.object_key, IfMatch=response["ETag"])
    with pytest.raises(ClientError) as exc:
        client.head_object(Bucket=manifest.bucket, Key=manifest.object_key)
    assert exc.value.response["ResponseMetadata"]["HTTPStatusCode"] == 404


def test_actual_minio_guard_preserves_unversioned_and_versioned_objects(isolated_minio):
    client = isolated_minio
    _, manifest, _ = fresh_object(client)
    with pytest.raises(ValueError, match="S3 cleanup apply is unavailable"):
        delete_s3_exact(client, manifest)
    assert client.get_object(Bucket=manifest.bucket, Key=manifest.object_key)["Body"].read() == CONTENT
    _, manifest, response = fresh_object(client, versioned=True)
    with pytest.raises(ValueError, match="S3 cleanup apply is unavailable"):
        delete_s3_exact(client, manifest)
    remaining = client.list_object_versions(Bucket=manifest.bucket, Prefix=manifest.object_key)
    assert [item["VersionId"] for item in remaining["Versions"]] == [response["VersionId"]]
    assert not remaining.get("DeleteMarkers")


def test_actual_minio_cli_dry_run_then_apply_stops_before_registry_claim(isolated_minio, client, db_session, tmp_path, monkeypatch):
    storage = isolated_minio
    token, manifest, _ = fresh_object(storage)
    root = tmp_path.resolve()
    evidence = root / "session.manifest"
    evidence.write_text(token)
    bearer = root / "test-service-token"
    bearer.write_text("synthetic-test-only")
    monkeypatch.setenv("AKL_WEB_UPLOAD_SIGNING_SECRET", SECRET)
    monkeypatch.setenv("AKL_S3_BUCKET", manifest.bucket)
    monkeypatch.setenv("AKL_OBJECT_STORAGE_LEGACY_BUCKETS", "")
    monkeypatch.setenv("AKL_INTAKE_CLEANUP_SERVICE_CLIENT_ID", "svc-cleanup-test")
    monkeypatch.setenv("AKL_TRUSTED_SERVICE_CLIENT_IDS", "svc-cleanup-test")
    monkeypatch.setenv("AKL_SERVICE_CLIENT_ROUTE_GRANTS", "svc-cleanup-test=intake-cleanup")
    get_settings.cache_clear()
    try:
        # Explicit test-mode authentication at the real ASGI route. Only this
        # transport bridge is substituted; claim DB and MinIO HTTP are real.
        calls = []
        def bridge(request):
            calls.append(request.url.path)
            reply = client.post(request.url.path, content=request.content, headers={
                "Authorization": request.headers["authorization"], "Content-Type": "application/json",
                "X-AKL-Subject": "service-account-svc-cleanup-test", "X-AKL-Service-Client-ID": "svc-cleanup-test"})
            return httpx.Response(reply.status_code, content=reply.content)
        transport = httpx.Client(transport=httpx.MockTransport(bridge))
        args = SimpleNamespace(manifest=[str(evidence)], token_file=str(bearer), registry_url="http://localhost:9999",
            bucket=manifest.bucket, storage_mode="s3", object_root=None, quarantine_root=None, apply=False)
        assert run_cleanup(args, http_client=transport, s3_client=storage)["results"][0]["status"] == "eligible"
        assert storage.head_object(Bucket=manifest.bucket, Key=manifest.object_key)["ContentLength"] == len(CONTENT)
        args.apply = True
        with pytest.raises(ValueError, match="S3 cleanup apply is unavailable"):
            run_cleanup(args, http_client=transport, s3_client=storage)
        assert calls == ["/api/v1/admin/intake-cleanup/dry-run"]
        assert storage.get_object(Bucket=manifest.bucket, Key=manifest.object_key)["Body"].read() == CONTENT
        from app.intake_cleanup_storage import IntakeObjectFence
        from sqlalchemy import select
        assert list(db_session.scalars(select(IntakeObjectFence))) == []
        assert evidence.read_text() == token
    finally:
        get_settings.cache_clear()
