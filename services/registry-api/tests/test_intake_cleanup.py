import base64
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import io
import json
from types import SimpleNamespace

from fastapi import HTTPException
import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app.config import get_settings
from app.intake_cleanup_api import cleanup_decisions
from app.intake_cleanup_cli import delete_local_exact, delete_s3_exact, run_cleanup, validate_decisions
from app.intake_cleanup_storage import IntakeObjectFence, REFERENCE_COLUMNS, lock_uris
from app.intake_manifest import DOMAIN, key_id, signing_keys, verify_manifest
from app.database import Base
from app.models import DocumentFile, DocumentVersion, DocumentPublication, ExternalDocumentRef, DocumentProfileVersionSnapshot

SECRET = "cleanup-test-signing-secret-at-least-32-characters"
NOW = datetime(2026, 9, 5, tzinfo=timezone.utc)
CONTENT = b"An isolated abandoned intake fixture."


def manifest_token(*, session="a" * 32, expiry=None, secret=SECRET, **overrides):
    key = f"doc_cleanup/draft/2026-09-01/upl_{session}/source.pdf"
    payload = {"schema_version": "akb-intake-manifest-1", "kid": key_id(secret),
               "session_id": "upl_" + session, "document_id": "doc_cleanup", "bucket": "test-bucket",
               "object_key": key, "source_file_uri": "s3://test-bucket/" + key, "file_name": "source.pdf",
               "file_size": len(CONTENT), "sha256": "sha256:" + hashlib.sha256(CONTENT).hexdigest(),
               "expires_at": (expiry or NOW-timedelta(days=2)).isoformat()}
    payload.update(overrides)
    encoded = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    signature = base64.urlsafe_b64encode(hmac.digest(secret.encode(), DOMAIN + encoded.encode(), "sha256")).decode().rstrip("=")
    return encoded + "." + signature


def settings():
    return SimpleNamespace(content_security_attestation_secret=SECRET, intake_manifest_verify_keys=None,
                           intake_cleanup_grace_seconds=86400, intake_cleanup_bucket="test-bucket", intake_cleanup_legacy_buckets="")


def decide(db, token=None, **kwargs):
    return cleanup_decisions(db, [token or manifest_token()], settings=settings(), subject_id="service-account-cleanup", now=NOW, **kwargs)


def parsed(token=None):
    return verify_manifest(token or manifest_token(), signing_keys(SECRET))


def test_manifest_signature_rotation_and_exact_identity():
    old = "retired-cleanup-test-signing-secret-32-characters"
    token = manifest_token(secret=old)
    assert verify_manifest(token, signing_keys(SECRET, json.dumps({key_id(old): old}))).session_id == "upl_" + "a" * 32
    with pytest.raises(ValueError):
        verify_manifest(token, signing_keys(SECRET))
    with pytest.raises(ValueError):
        verify_manifest(token[:-1] + ("A" if token[-1] != "A" else "B"), signing_keys(old))


def test_manifest_vector_and_coverage_are_explicit():
    from pathlib import Path
    vector = json.loads((Path(__file__).resolve().parents[3] / "contracts/akb/document-intake/v1/manifest-test-vector.json").read_text())
    assert verify_manifest(vector["manifest"], signing_keys(vector["signing_secret"])).model_dump() == vector["payload"]
    actual = {(table.name, column.name) for table in Base.metadata.tables.values() for column in table.columns
              if column.name in {"source_file_uri", "uri", "akb_source_uri"}}
    expected = {(table, field) for table, field in REFERENCE_COLUMNS.items() if "->" not in field}
    assert actual == expected


@pytest.mark.parametrize("model,values", [
    (DocumentVersion, {"document_version_id": "ref_version", "document_id": "ref_doc", "version_label": "1", "status": "archived"}),
    (ExternalDocumentRef, {"external_document_id": "ref_external", "document_id": "ref_doc", "external_system": "budget", "external_ref": "ref", "entity_type": "contract", "entity_id": "entity"}),
    (DocumentProfileVersionSnapshot, {"document_version_id": "ref_snapshot", "document_id": "ref_doc", "root_metadata_revision": "revision", "root_snapshot_hash": "hash", "snapshot_hash": "hash", "file_id": "ref_file", "admission_confirmation": {}, "created_by": "fixture"}),
    (DocumentPublication, {"publication_id": "ref_publication", "document_id": "ref_doc", "document_version_id": "ref_version", "public_slug": "revoked-publication", "status": "REVOKED", "snapshot_schema": "akb-public-document-1", "public_snapshot": {}, "public_snapshot_hash": "sha256:"+"a"*64, "source_file_hash": "sha256:"+"a"*64, "source_filename": "source.pdf", "source_mime_type": "application/pdf", "source_size_bytes": 1, "governed_resource_id": "gr_fixture", "source_version": "1", "policy_binding_id": "pb_fixture", "policy_version": "1", "policy_hash": "sha256:"+"a"*64, "central_publication_id": "central_fixture", "reason": "Fixture only"}),
])
def test_every_historical_content_owner_retains_blob(db_session, model, values):
    from sqlalchemy import insert
    uri = parsed().source_file_uri
    field = REFERENCE_COLUMNS[model.__tablename__]
    raw = dict(values)
    if model is DocumentPublication:
        raw.update(source_version=raw["document_version_id"], published_at=NOW, published_by="publisher",
                   approved_by="approver", revoked_at=NOW, revoked_by="revoker")
    if model is DocumentProfileVersionSnapshot:
        raw["payload"] = {"sourceLineage": {"contentUri": uri}}
    else:
        raw[field] = uri
    # Explicit raw database fixtures exercise reference completeness, independent
    # of user access and current versions. These are not admitted API documents.
    db_session.execute(insert(model.__table__).values(**raw))
    db_session.commit()
    result = decide(db_session, claim=True)["results"][0]
    assert result["status"] == "referenced"
    assert result["references"][model.__tablename__] == 1


@pytest.mark.parametrize("table,field", list(REFERENCE_COLUMNS.items()))
def test_each_sqlite_raw_writer_is_guarded_before_constraints(db_session, table, field):
    decide(db_session, claim=True)
    if table == "document_profile_version_snapshots":
        column, value = "payload", json.dumps({"sourceLineage": {"contentUri": parsed().source_file_uri}})
    else:
        column, value = field, parsed().source_file_uri
    with pytest.raises(IntegrityError, match="intake_object_cleanup_claimed"):
        db_session.execute(text(f"INSERT INTO {table} ({column}) VALUES (:value)"), {"value": value})
    db_session.rollback()


@pytest.mark.parametrize("mutation", [{"object_key": "../source.pdf"}, {"source_file_uri": "s3://other/source.pdf"},
                                     {"file_name": "../source.pdf"}, {"file_size": True}, {"expires_at": "2026-09-01"},
                                     {"extra": "unexpected"}, {"schema_version": "upload-token"}])
def test_signed_but_invalid_manifest_is_rejected(mutation):
    with pytest.raises(ValueError):
        parsed(manifest_token(**mutation))


def test_dry_run_is_read_only_and_claim_is_durable_idempotent(db_session):
    first = decide(db_session)
    assert first["complete"] and first["results"][0]["status"] == "eligible"
    assert list(db_session.scalars(select(IntakeObjectFence))) == []
    claimed = decide(db_session, claim=True)
    repeated = decide(db_session, claim=True)
    assert claimed == repeated
    assert claimed["results"][0]["claim_id"].startswith("cleanup_")
    assert db_session.scalar(select(IntakeObjectFence)).claimed_by == "service-account-cleanup"


@pytest.mark.parametrize("offset", [timedelta(hours=-23), timedelta(days=1)])
def test_expiry_and_grace_do_not_claim_early(db_session, offset):
    assert decide(db_session, manifest_token(expiry=NOW+offset), claim=True)["results"][0]["status"] == "not_expired"
    assert db_session.scalar(select(IntakeObjectFence)).claim_id is None


def test_claim_blocks_late_orm_reference_and_raw_sql(db_session):
    decide(db_session, claim=True)
    uri = parsed().source_file_uri
    db_session.add(DocumentFile(file_id="file_late", document_id="doc_late", document_version_id="ver_late", uri=uri))
    with pytest.raises(HTTPException) as error:
        db_session.flush()
    assert error.value.status_code == 409
    db_session.rollback()
    with pytest.raises(IntegrityError, match="intake_object_cleanup_claimed"):
        db_session.execute(text("INSERT INTO document_files (file_id,document_id,document_version_id,uri,uploaded_at) "
                                "VALUES ('raw_file','raw_doc','raw_ver',:uri,CURRENT_TIMESTAMP)"), {"uri": uri})
    db_session.rollback()


def test_reference_before_claim_is_retained_even_without_user_visibility(db_session):
    uri = parsed().source_file_uri
    # Low-level DB fixture intentionally has no user policy; the cleanup query
    # must retain it nevertheless. This is not an admission fixture or bypass.
    db_session.execute(text("INSERT INTO document_files (file_id,document_id,document_version_id,uri,uploaded_at) "
                            "VALUES ('private_file','deleted_doc','archived_ver',:uri,CURRENT_TIMESTAMP)"), {"uri": uri})
    db_session.commit()
    result = decide(db_session, claim=True)["results"][0]
    assert result["status"] == "referenced" and result["references"]["document_files"] == 1
    assert db_session.scalar(select(IntakeObjectFence)).claim_id is None


def test_permanent_tombstone_cannot_be_removed_or_rebound(db_session):
    decide(db_session, claim=True)
    for mutation in ("DELETE FROM intake_object_fences", "UPDATE intake_object_fences SET claim_id=NULL",
                     "UPDATE intake_object_fences SET source_uri='s3://changed'"):
        with pytest.raises(IntegrityError, match="permanent"):
            db_session.execute(text(mutation))
        db_session.rollback()


def test_missing_guard_or_reference_table_fails_closed(db_session):
    db_session.execute(text("DROP TRIGGER intake_fence_document_files_insert"))
    with pytest.raises(RuntimeError, match="migration is not complete"):
        decide(db_session, claim=True)
    assert list(db_session.scalars(select(IntakeObjectFence))) == []


def test_conflicting_signed_manifest_cannot_rebind_claim(db_session):
    decide(db_session, claim=True)
    with pytest.raises(HTTPException) as exc:
        decide(db_session, manifest_token(file_size=len(CONTENT)+1), claim=True)
    assert exc.value.status_code == 409
    db_session.rollback()


def test_locks_are_deterministic_for_whole_candidate_set(db_session):
    uris = [parsed(manifest_token(session="b"*32)).source_file_uri, parsed().source_file_uri]
    assert list(lock_uris(db_session, uris + uris)) == sorted(uris)


@pytest.mark.parametrize("uri", ["s3://test-bucket/doc/%73ource.pdf", "s3://test-bucket/doc/%2573ource.pdf",
    "s3://test-bucket/doc%2fsource.pdf", "s3://test-bucket/doc/./source.pdf", "s3://test-bucket/doc/../source.pdf",
    "s3://test-bucket/doc//source.pdf", "s3://test-bucket/doc/source.pdf?ignored", "s3://test-bucket/doc/source.pdf#ignored",
    "file:///data/object-storage/test-bucket/doc/source.pdf", "https://store.example/doc/source.pdf"])
def test_alias_or_unknown_reference_cannot_race_cleanup(db_session, uri):
    with pytest.raises(HTTPException) as exc:
        lock_uris(db_session, [uri])
    assert exc.value.status_code == 409
    with pytest.raises(IntegrityError, match="intake_source_uri_not_canonical"):
        db_session.execute(text("INSERT INTO document_files (uri) VALUES (:uri)"), {"uri": uri})
    db_session.rollback()


def test_preexisting_ambiguous_reference_stops_complete_check(db_session):
    from app.intake_cleanup_storage import sqlite_trigger_sql
    db_session.execute(text("DROP TRIGGER intake_fence_document_files_insert"))
    db_session.execute(text("INSERT INTO document_files (file_id,document_id,document_version_id,uri,uploaded_at) "
                            "VALUES ('legacy','old_doc','old_version','s3://test-bucket/doc/%73ource.pdf',CURRENT_TIMESTAMP)"))
    db_session.execute(text(next(sql for sql in sqlite_trigger_sql() if sql.startswith("CREATE TRIGGER intake_fence_document_files_insert "))))
    db_session.commit()
    with pytest.raises(RuntimeError, match="Non-canonical"):
        decide(db_session, claim=True)
    db_session.rollback()
    assert list(db_session.scalars(select(IntakeObjectFence))) == []


def test_server_refuses_physical_bucket_aliases_and_foreign_manifest(db_session):
    config = settings()
    config.intake_cleanup_legacy_buckets = "other-bucket"
    with pytest.raises(HTTPException) as exc:
        cleanup_decisions(db_session, [manifest_token()], settings=config, subject_id="cleanup", claim=True, now=NOW)
    assert exc.value.status_code == 503
    config.intake_cleanup_legacy_buckets = ""
    config.intake_cleanup_bucket = "other-bucket"
    with pytest.raises(HTTPException) as exc:
        cleanup_decisions(db_session, [manifest_token()], settings=config, subject_id="cleanup", claim=True, now=NOW)
    assert exc.value.status_code == 400


def test_api_requires_exact_service_identity_and_grant(client, monkeypatch):
    monkeypatch.setenv("AKL_INTAKE_CLEANUP_SERVICE_CLIENT_ID", "svc-cleanup-test")
    monkeypatch.setenv("AKL_TRUSTED_SERVICE_CLIENT_IDS", "svc-cleanup-test,svc-other-test")
    monkeypatch.setenv("AKL_SERVICE_CLIENT_ROUTE_GRANTS", "svc-cleanup-test=intake-cleanup,svc-other-test=intake-cleanup")
    monkeypatch.setenv("AKL_WEB_UPLOAD_SIGNING_SECRET", SECRET)
    monkeypatch.setenv("AKL_S3_BUCKET", "test-bucket")
    monkeypatch.setenv("AKL_OBJECT_STORAGE_LEGACY_BUCKETS", "")
    get_settings.cache_clear()
    try:
        url = "/api/v1/admin/intake-cleanup/dry-run"
        body = {"manifests": [manifest_token()]}
        assert client.post(url, json=body, headers={"X-AKL-Roles": "admin"}).status_code == 403
        other = {"X-AKL-Subject": "service-account-svc-other-test", "X-AKL-Service-Client-ID": "svc-other-test"}
        assert client.post(url, json=body, headers=other).status_code == 403
        headers = {"X-AKL-Subject": "service-account-svc-cleanup-test", "X-AKL-Service-Client-ID": "svc-cleanup-test"}
        result = client.post(url, json=body, headers=headers)
        assert result.status_code == 200, result.text
        assert result.headers["cache-control"] == "no-store"
        monkeypatch.setenv("AKL_SERVICE_CLIENT_ROUTE_GRANTS", "svc-cleanup-test=intake-cleanup|documents-write")
        get_settings.cache_clear()
        assert client.post(url, json=body, headers=headers).status_code == 403
        monkeypatch.setenv("AKL_SERVICE_CLIENT_ROUTE_GRANTS", "svc-cleanup-test=documents-read")
        get_settings.cache_clear()
        assert client.post(url, json=body, headers=headers).status_code == 403
    finally:
        get_settings.cache_clear()


def test_local_delete_is_exact_idempotent_and_rejects_symlink_hash_change(tmp_path):
    root = tmp_path.resolve()
    target = root / "bucket/source.pdf"
    target.parent.mkdir()
    target.write_bytes(CONTENT)
    assert delete_local_exact(root, "bucket/source.pdf", parsed()) == "deleted"
    assert delete_local_exact(root, "bucket/source.pdf", parsed()) == "absent"
    target.write_bytes(b"x" * len(CONTENT))
    with pytest.raises(ValueError, match="identity mismatch"):
        delete_local_exact(root, "bucket/source.pdf", parsed())
    assert target.exists()
    victim = root / "victim.pdf"
    victim.write_bytes(CONTENT)
    target.unlink()
    target.symlink_to(victim)
    with pytest.raises(OSError):
        delete_local_exact(root, "bucket/source.pdf", parsed())
    assert victim.read_bytes() == CONTENT
    with pytest.raises(ValueError):
        delete_local_exact(root, "../victim.pdf", parsed())


def test_symlink_directory_is_never_followed(tmp_path):
    root = tmp_path.resolve()
    outside = root / "outside"
    outside.mkdir()
    (outside / "source.pdf").write_bytes(CONTENT)
    (root / "bucket").symlink_to(outside, target_is_directory=True)
    with pytest.raises(OSError):
        delete_local_exact(root, "bucket/source.pdf", parsed())
    assert (outside / "source.pdf").exists()


class FakeS3:
    def __init__(self, content=CONTENT, version=None):
        self.content, self.version, self.deleted = content, version, []
    def get_object(self, **kwargs):
        return {"Body": io.BytesIO(self.content), "ContentLength": len(self.content), "ETag": '"exact-etag"', "VersionId": self.version}
    def delete_object(self, **kwargs):
        self.deleted.append(kwargs)


def test_s3_apply_is_unavailable_without_read_or_delete():
    for client in (FakeS3(), FakeS3(b"x" * len(CONTENT)), FakeS3(version="version-id")):
        def unexpected_read(**kwargs):
            pytest.fail("Disabled S3 apply must not read or mutate storage")
        client.get_object = unexpected_read
        with pytest.raises(ValueError, match="S3 cleanup apply is unavailable"):
            delete_s3_exact(client, parsed())
        assert client.deleted == []


def test_operator_s3_apply_stops_before_claim_or_any_other_work():
    args = SimpleNamespace(apply=True, storage_mode="s3")
    def unexpected_request(request):
        pytest.fail("Disabled S3 apply must not call Registry")
    client = httpx.Client(transport=httpx.MockTransport(unexpected_request))
    with pytest.raises(ValueError, match="S3 cleanup apply is unavailable"):
        run_cleanup(args, http_client=client, s3_client=FakeS3())


def test_cli_reports_s3_unavailable_before_reading_any_files(monkeypatch, capsys):
    from app.intake_cleanup_cli import main
    monkeypatch.setattr("sys.argv", ["intake-cleanup", "--apply", "--storage-mode", "s3", "--bucket", "test-bucket",
        "--registry-url", "https://registry.example", "--token-file", "/nonexistent/token", "--manifest", "/nonexistent/manifest"])
    assert main() == 2
    assert "S3_CLEANUP_APPLY_UNAVAILABLE" in capsys.readouterr().err


def test_operator_dry_run_never_deletes_apply_requires_complete_claim(tmp_path, db_session, monkeypatch):
    root = tmp_path.resolve()
    token = manifest_token()
    manifest_file = root / "evidence.manifest"
    manifest_file.write_text(token)
    target = root / parsed().bucket / parsed().object_key
    target.parent.mkdir(parents=True)
    target.write_bytes(CONTENT)
    token_file = root / "service-token"
    token_file.write_text("isolated-test-token")
    monkeypatch.setenv("AKL_WEB_UPLOAD_SIGNING_SECRET", SECRET)
    args = SimpleNamespace(manifest=[str(manifest_file)], token_file=str(token_file), bucket=parsed().bucket,
        registry_url="http://localhost:9999", storage_mode="local", object_root=str(root), quarantine_root=None, apply=False)
    def handler(request):
        assert request.headers["authorization"] == "Bearer isolated-test-token"
        return httpx.Response(200, json=decide(db_session, claim=args.apply))
    client = httpx.Client(transport=httpx.MockTransport(handler))
    assert run_cleanup(args, http_client=client)["mode"] == "dry-run"
    assert target.exists()
    args.apply = True
    assert run_cleanup(args, http_client=client)["results"][0]["storage"]["promoted"] == "deleted"
    assert manifest_file.exists()
    assert run_cleanup(args, http_client=client)["results"][0]["storage"]["promoted"] == "absent"
    # Late no-clobber upload may recreate identical bytes; the permanent fence
    # prevents attachment and the same manifest remains eligible for retry.
    target.write_bytes(CONTENT)
    assert run_cleanup(args, http_client=client)["results"][0]["storage"]["promoted"] == "deleted"


@pytest.mark.parametrize("mutation", ["incomplete", "missing_result", "missing_reference_table", "positive_reference", "missing_claim"])
def test_operator_rejects_partial_or_inconsistent_authority(db_session, mutation):
    body = decide(db_session, claim=True)
    if mutation == "incomplete": body["complete"] = False
    if mutation == "missing_result": body["results"] = []
    if mutation == "missing_reference_table": body["results"][0]["references"].pop("document_publications")
    if mutation == "positive_reference": body["results"][0]["references"]["document_publications"] = 1
    if mutation == "missing_claim": body["results"][0]["claim_id"] = None
    with pytest.raises(ValueError):
        validate_decisions(body, [manifest_token()], apply=True)
