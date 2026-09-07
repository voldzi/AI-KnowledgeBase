"""Opt-in real PostgreSQL migration and inter-transaction race verification."""
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from datetime import datetime, timezone
import os
from pathlib import Path
import subprocess
import sys
from threading import Event
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, insert, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.intake_cleanup_storage import lock_uris, verify_fence_installation
from app.intake_manifest import manifest_digest
from app.models import Document, DocumentFile, DocumentVersion
from document_policy_fixtures import admitted_policy
from test_intake_cleanup import decide, manifest_token, parsed


@pytest.fixture(scope="module")
def isolated_postgres():
    raw = os.getenv("AKB_INTAKE_CLEANUP_TEST_POSTGRES_URL")
    if not raw:
        pytest.skip("Explicit isolated PostgreSQL QA endpoint is required")
    endpoint = make_url(raw)
    assert endpoint.get_backend_name() == "postgresql"
    name = "akb_cleanup_" + uuid4().hex
    admin = create_engine(endpoint, isolation_level="AUTOCOMMIT")
    engine = None
    created = False
    try:
        with admin.connect() as connection:
            connection.exec_driver_sql(f'CREATE DATABASE "{name}"')
        created = True
        url = endpoint.set(database=name)
        migration = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=Path(__file__).resolve().parents[1],
            env={**os.environ, "AKL_DATABASE_URL": url.render_as_string(hide_password=False)},
            capture_output=True, text=True, timeout=90)
        assert migration.returncode == 0, migration.stderr
        engine = create_engine(url)
        yield sessionmaker(bind=engine, autoflush=False)
    finally:
        if engine is not None:
            engine.dispose()
        if created:
            with admin.connect() as connection:
                connection.exec_driver_sql(f'DROP DATABASE "{name}" WITH (FORCE)')
        admin.dispose()


def seed(sessions):
    marker = uuid4().hex
    with sessions() as db:
        # DB-level corruption/race fixtures intentionally bypass HTTP admission;
        # the trigger must protect raw DB writers as well as admitted API writes.
        document = Document(document_id="doc_"+marker, title="DB race fixture", document_type="record",
                            owner_id="fixture_owner", policy_summary=admitted_policy())
        version = DocumentVersion(document_version_id="ver_"+marker, document=document, version_label="1",
                                  source_file_uri="s3://seed/"+marker, policy_summary=admitted_policy())
        db.add_all([document, version])
        db.commit()
        return document.document_id, version.document_version_id


def raw_reference(db, document, version, uri):
    db.execute(insert(DocumentFile.__table__).values(file_id="file_"+uuid4().hex, document_id=document,
        document_version_id=version, uri=uri, uploaded_at=datetime.now(timezone.utc)))


def test_reference_commit_first_blocks_claim_then_retains(isolated_postgres):
    sessions = isolated_postgres
    document, version = seed(sessions)
    token = manifest_token(session=uuid4().hex)
    started = Event()
    with sessions() as writer, ThreadPoolExecutor(max_workers=1) as pool:
        verify_fence_installation(writer)
        raw_reference(writer, document, version, parsed(token).source_file_uri)
        def cleanup():
            with sessions() as db:
                started.set()
                return decide(db, token, claim=True)
        future = pool.submit(cleanup)
        assert started.wait(3)
        with pytest.raises(TimeoutError):
            future.result(timeout=0.2)
        writer.commit()
        result = future.result(timeout=5)
    assert result["results"][0]["status"] == "referenced"
    assert result["results"][0]["references"]["document_files"] == 1


def test_claim_commit_first_blocks_raw_reference_and_retry_remains_fenced(isolated_postgres):
    sessions = isolated_postgres
    document, version = seed(sessions)
    token = manifest_token(session=uuid4().hex)
    uri = parsed(token).source_file_uri
    started = Event()
    with sessions() as cleanup, ThreadPoolExecutor(max_workers=1) as pool:
        fence = lock_uris(cleanup, [uri])[uri]
        fence.claim_id = "cleanup_"+uuid4().hex
        fence.manifest_digest = manifest_digest(token)
        fence.expires_at = parsed(token).expiry
        fence.claimed_at = datetime.now(timezone.utc)
        fence.claimed_by = "service-account-cleanup"
        cleanup.flush()
        def writer():
            with sessions() as db:
                started.set()
                raw_reference(db, document, version, uri)
                db.commit()
        future = pool.submit(writer)
        assert started.wait(3)
        with pytest.raises(TimeoutError):
            future.result(timeout=0.2)
        cleanup.commit()
        with pytest.raises(IntegrityError, match="intake_object_cleanup_claimed"):
            future.result(timeout=5)
    with sessions() as db:
        assert decide(db, token, claim=True)["results"][0]["status"] == "claimed"
        with pytest.raises(IntegrityError, match="intake_object_cleanup_claimed"):
            raw_reference(db, document, version, uri)


def test_rolled_back_claim_allows_reference_and_repeatable_read_is_refused(isolated_postgres):
    sessions = isolated_postgres
    document, version = seed(sessions)
    token = manifest_token(session=uuid4().hex)
    uri = parsed(token).source_file_uri
    with sessions() as db:
        fence = lock_uris(db, [uri])[uri]
        fence.claim_id = "cleanup_rollback"
        db.flush()
        db.rollback()
        raw_reference(db, document, version, uri)
        db.commit()
        assert decide(db, token, claim=True)["results"][0]["status"] == "referenced"
    with sessions() as db:
        db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"))
        with pytest.raises(RuntimeError, match="READ COMMITTED"):
            decide(db, manifest_token(session=uuid4().hex), claim=True)


def test_postgres_raw_uri_aliases_are_refused_and_lookup_indexes_exist(isolated_postgres):
    from app.intake_cleanup_storage import REFERENCE_COLUMNS
    sessions = isolated_postgres
    document, version = seed(sessions)
    with sessions() as db:
        indexes = set(db.scalars(text("SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()")))
        for table in REFERENCE_COLUMNS:
            assert f"ix_intake_ref_{table}" in indexes
            assert f"ix_intake_noncanonical_{table}" in indexes
        for uri in ("s3://test-bucket/doc/%73ource.pdf", "s3://test-bucket/doc/./source.pdf",
                    "s3://test-bucket/doc//source.pdf", "s3://test-bucket/doc/%252fsource.pdf",
                    "file:///data/object-storage/test-bucket/doc/source.pdf"):
            with pytest.raises(IntegrityError, match="intake_source_uri_not_canonical"):
                raw_reference(db, document, version, uri)
            db.rollback()
