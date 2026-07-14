from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.database import Base
from app.models import Document, DocumentVersion, ExternalDocumentRef, IngestionAttempt
from app.api import update_document_external_references_current
from app.auth import Principal
from app.schemas import ExternalDocumentCurrentUpdateRequest


SERVICE_ROOT = Path(__file__).resolve().parents[1]


def _document(document_id: str) -> Document:
    return Document(
        document_id=document_id,
        title=f"Migration fixture {document_id}",
        document_type="directive",
        owner_id="user_migration",
    )


def _version(document_id: str, version_id: str) -> DocumentVersion:
    return DocumentVersion(
        document_version_id=version_id,
        document_id=document_id,
        version_label="1.0",
        source_file_uri=f"s3://migration/{document_id}/{version_id}.pdf",
    )


def test_ingestion_attempt_model_rejects_cross_document_version() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add_all(
            [
                _document("doc_migration_a"),
                _document("doc_migration_b"),
                _version("doc_migration_a", "ver_migration_a"),
                _version("doc_migration_b", "ver_migration_b"),
            ]
        )
        session.commit()
        session.add(
            IngestionAttempt(
                document_id="doc_migration_b",
                document_version_id="ver_migration_a",
                ingestion_job_id="ing_migration_cross_document",
                ingestion_status="QUEUED",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        session.add(
            IngestionAttempt(
                document_id="doc_migration_a",
                document_version_id="ver_migration_a",
                ingestion_job_id="ing_migration_invalid_status",
                ingestion_status="CANCELLED",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
    engine.dispose()


@pytest.mark.skipif(
    not os.environ.get("AKL_REGISTRY_MIGRATION_TEST_ADMIN_URL"),
    reason="A dedicated PostgreSQL admin URL is required for the destructive migration fixture",
)
def test_postgres_0018_backfills_and_enforces_document_version_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin_url = make_url(os.environ["AKL_REGISTRY_MIGRATION_TEST_ADMIN_URL"])
    database_name = f"akl_migration_{uuid4().hex}"
    database_url = admin_url.set(database=database_name)
    admin_engine = create_engine(admin_url, poolclass=NullPool)
    database_engine = None

    with admin_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        connection.execute(text(f'CREATE DATABASE "{database_name}"'))
    try:
        monkeypatch.setenv(
            "AKL_DATABASE_URL",
            database_url.render_as_string(hide_password=False),
        )
        get_settings.cache_clear()
        alembic_config = Config(str(SERVICE_ROOT / "alembic.ini"))
        alembic_config.set_main_option("script_location", str(SERVICE_ROOT / "alembic"))
        command.upgrade(alembic_config, "0017_canonical_own_scope")

        database_engine = create_engine(database_url, poolclass=NullPool)
        with Session(database_engine) as session:
            document = _document("doc_migration_backfill")
            version = _version(document.document_id, "ver_migration_backfill")
            session.add_all(
                [
                    document,
                    version,
                    ExternalDocumentRef(
                        external_document_id="extdoc_migration_one",
                        external_system="STRATOS",
                        external_ref="migration:one",
                        entity_type="MigrationFixture",
                        entity_id="one",
                        document_id=document.document_id,
                        current_document_version_id=version.document_version_id,
                        current_ingestion_job_id="ing_migration_backfill",
                        current_ingestion_status="INGESTING",
                    ),
                    ExternalDocumentRef(
                        external_document_id="extdoc_migration_two",
                        external_system="STRATOS",
                        external_ref="migration:two",
                        entity_type="MigrationFixture",
                        entity_id="two",
                        document_id=document.document_id,
                        current_document_version_id=version.document_version_id,
                        current_ingestion_job_id="ing_migration_ambiguous",
                        current_ingestion_status="INGESTING",
                    ),
                ]
            )
            session.commit()

        with pytest.raises(DBAPIError, match="ambiguous external ingestion state"):
            command.upgrade(alembic_config, "head")
        with database_engine.begin() as connection:
            assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == (
                "0017_canonical_own_scope"
            )
            assert connection.execute(
                text("SELECT to_regclass('public.ingestion_attempts')")
            ).scalar_one() is None
            connection.execute(
                text(
                    "UPDATE external_document_refs "
                    "SET current_ingestion_job_id = 'ing_migration_backfill' "
                    "WHERE external_document_id = 'extdoc_migration_two'"
                )
            )

        command.upgrade(alembic_config, "head")
        with database_engine.begin() as connection:
            row = connection.execute(
                text(
                    "SELECT document_id, document_version_id, ingestion_job_id, ingestion_status "
                    "FROM ingestion_attempts"
                )
            ).one()
            assert row._tuple() == (
                "doc_migration_backfill",
                "ver_migration_backfill",
                "ing_migration_backfill",
                "INGESTING",
            )
            connection.execute(
                text(
                    "INSERT INTO documents "
                    "(document_id, title, document_type, status, classification, organization_id, "
                    "policy_summary, governance_scope_type, governance_scope_id, "
                    "governance_registration_status, owner_id, tags, metadata, created_at, updated_at) "
                    "VALUES ('doc_migration_other', 'Other', 'directive', 'draft', 'internal', "
                    "'org_stratos', '{}', 'organization', 'org_stratos', 'LEGACY_UNREGISTERED', "
                    "'user_migration', '[]', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
        with pytest.raises(IntegrityError):
            with database_engine.begin() as connection:
                connection.execute(
                    text(
                        "INSERT INTO ingestion_attempts "
                        "(document_id, document_version_id, ingestion_job_id, ingestion_status, "
                        "created_at, updated_at) VALUES "
                        "('doc_migration_other', 'ver_migration_backfill', "
                        "'ing_migration_cross_document', 'QUEUED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                    )
                )

        with Session(database_engine) as session:
            session.add_all(
                [
                    _document("doc_migration_concurrent"),
                    _version("doc_migration_concurrent", "ver_migration_concurrent"),
                ]
            )
            session.commit()

        barrier = Barrier(2)
        principal = Principal(
            subject_id="user_migration",
            roles={"admin"},
            groups=set(),
        )

        def claim_same_initial_attempt() -> tuple[str, str]:
            payload = ExternalDocumentCurrentUpdateRequest(
                current_document_version_id="ver_migration_concurrent",
                expected_current_ingestion_job_id=None,
                current_ingestion_job_id="ing_migration_concurrent",
                current_ingestion_status="QUEUED",
            )
            with Session(database_engine) as session:
                barrier.wait(timeout=5)
                response = update_document_external_references_current(
                    "doc_migration_concurrent",
                    payload,
                    session,
                    principal,
                )
                assert response.ingestion_attempt is not None
                return (
                    response.ingestion_attempt.ingestion_job_id,
                    response.ingestion_attempt.ingestion_status,
                )

        with ThreadPoolExecutor(max_workers=2) as executor:
            concurrent_results = list(
                executor.map(lambda _index: claim_same_initial_attempt(), range(2))
            )
        assert concurrent_results == [
            ("ing_migration_concurrent", "QUEUED"),
            ("ing_migration_concurrent", "QUEUED"),
        ]
    finally:
        if database_engine is not None:
            database_engine.dispose()
        get_settings.cache_clear()
        with admin_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            connection.execute(
                text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = :database_name AND pid <> pg_backend_pid()"
                ),
                {"database_name": database_name},
            )
            connection.execute(text(f'DROP DATABASE IF EXISTS "{database_name}"'))
        admin_engine.dispose()
