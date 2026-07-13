#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

import psycopg


ROOT = Path(__file__).resolve().parents[1]
SERVICE_DIR = ROOT / "services" / "registry-api"
DEFAULT_ADMIN_URL = "postgresql://akl_platform:akl_local_postgres@localhost:5432/akl"
DEFAULT_DATABASE_NAME = "akl_registry_smoke"


def main() -> int:
    database_name = os.getenv("AKL_REGISTRY_PG_DATABASE", DEFAULT_DATABASE_NAME)
    admin_url = os.getenv("AKL_REGISTRY_PG_ADMIN_URL") or admin_url_from_parts()
    database_url = os.getenv(
        "AKL_REGISTRY_PG_DATABASE_URL",
        database_url_for(admin_url, database_name),
    )

    print("Registry PostgreSQL smoke test")
    recreate_database(admin_url, database_name)
    try:
        run_alembic(database_url)
        verify_postgres_schema(database_url)
        verify_external_document_api(database_url)
        verify_document_publication_immutability(database_url)
        verify_public_audit_aggregation(database_url)
    finally:
        if os.getenv("AKL_REGISTRY_PG_KEEP_DATABASE", "false").lower() not in {"1", "true", "yes"}:
            drop_database(admin_url, database_name)

    print("OK database=", database_name)
    print("OK migrations=head")
    print("OK document_publications=constraints_and_enforced_immutability")
    print("OK public_audit=deterministic_upsert")
    print("OK external_documents=upsert_idempotent")
    return 0


def database_url_for(admin_url: str, database_name: str) -> str:
    parts = urlsplit(admin_url)
    return urlunsplit((parts.scheme + "+psycopg", parts.netloc, f"/{database_name}", "", ""))


def admin_url_from_parts() -> str:
    host = os.getenv("AKL_REGISTRY_PG_HOST", "localhost")
    port = os.getenv("AKL_REGISTRY_PG_PORT", "5432")
    user = os.getenv("AKL_REGISTRY_PG_USER", "akl_platform")
    password = os.getenv("AKL_REGISTRY_PG_PASSWORD", "akl_local_postgres")
    database = os.getenv("AKL_REGISTRY_PG_ADMIN_DATABASE", "akl")
    return f"postgresql://{quote(user, safe='')}:{quote(password, safe='')}@{host}:{port}/{database}"


def psycopg_url(url: str) -> str:
    return url.replace("postgresql+psycopg://", "postgresql://", 1)


def recreate_database(admin_url: str, database_name: str) -> None:
    with psycopg.connect(admin_url, autocommit=True) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s", (database_name,))
            cursor.execute(f'DROP DATABASE IF EXISTS "{database_name}"')
            cursor.execute(f'CREATE DATABASE "{database_name}"')


def drop_database(admin_url: str, database_name: str) -> None:
    with psycopg.connect(admin_url, autocommit=True) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s", (database_name,))
            cursor.execute(f'DROP DATABASE IF EXISTS "{database_name}"')


def run_alembic(database_url: str) -> None:
    env = {
        **os.environ,
        "AKL_ENV": "test",
        "AKL_AUTH_MODE": "mock",
        "AKL_AUTO_CREATE_SCHEMA": "false",
        "AKL_DATABASE_URL": database_url,
    }
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=SERVICE_DIR,
        env=env,
        check=True,
    )


def verify_postgres_schema(database_url: str) -> None:
    with psycopg.connect(psycopg_url(database_url)) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = 'public'
                      AND table_name = 'external_document_refs'
                )
                """
            )
            if cursor.fetchone()[0] is not True:
                raise RuntimeError("external_document_refs table was not created")

            cursor.execute(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'uq_external_document_ref_identity'
                )
                """
            )
            if cursor.fetchone()[0] is not True:
                raise RuntimeError("uq_external_document_ref_identity constraint was not created")

            cursor.execute(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = 'public'
                      AND table_name = 'document_publications'
                )
                """
            )
            if cursor.fetchone()[0] is not True:
                raise RuntimeError("document_publications table was not created")

            cursor.execute(
                """
                SELECT COUNT(*)
                FROM pg_constraint
                WHERE conrelid = 'document_publications'::regclass
                  AND contype = 'c'
                """
            )
            if cursor.fetchone()[0] < 6:
                raise RuntimeError("document_publications integrity constraints are incomplete")

            cursor.execute(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM pg_trigger
                    WHERE tgrelid = 'document_publications'::regclass
                      AND tgname = 'trg_document_publication_immutability'
                      AND NOT tgisinternal
                )
                """
            )
            if cursor.fetchone()[0] is not True:
                raise RuntimeError("document publication immutability trigger was not created")

            cursor.execute(
                """
                SELECT COUNT(*)
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'audit_events'
                  AND column_name IN ('aggregate_key', 'occurrence_count', 'last_seen_at')
                """
            )
            if cursor.fetchone()[0] != 3:
                raise RuntimeError("public audit aggregation columns are incomplete")
            cursor.execute(
                """
                SELECT EXISTS (
                    SELECT 1 FROM pg_indexes
                    WHERE tablename = 'audit_events'
                      AND indexname = 'ix_audit_events_aggregate_key'
                )
                """
            )
            if cursor.fetchone()[0] is not True:
                raise RuntimeError("public audit aggregate unique index was not created")


def verify_external_document_api(database_url: str) -> None:
    os.environ["AKL_ENV"] = "test"
    os.environ["AKL_AUTH_MODE"] = "mock"
    os.environ["AKL_AUTO_CREATE_SCHEMA"] = "false"
    os.environ["AKL_DATABASE_URL"] = database_url
    os.environ["AKL_MOCK_ROLES"] = json.dumps(["stratos_service"])

    sys.path.insert(0, str(SERVICE_DIR))
    from fastapi.testclient import TestClient  # noqa: WPS433
    from app.main import create_app  # noqa: WPS433

    payload = {
        "tenant_id": "default",
        "external_system": "STRATOS_BUDGET",
        "external_ref": "contract:postgres-smoke:main",
        "entity_type": "Contract",
        "entity_id": "contract-postgres-smoke",
        "document_type": "contract",
        "title": "PostgreSQL smoke contract",
        "classification": "internal",
        "owner": {"user_id": "svc_stratos", "display_name": "STRATOS Service"},
        "metadata": {"contract_number": "PG-SMOKE"},
        "citation_base_url": "http://localhost:8001/api/v1/citations",
    }
    headers = {
        "X-AKL-Subject": "svc_stratos",
        "X-AKL-Roles": "stratos_service",
        "X-Request-ID": "registry-postgres-smoke",
        "X-Correlation-ID": "registry-postgres-smoke",
    }

    with TestClient(create_app()) as client:
        first = client.post("/api/v1/external-documents/upsert", headers=headers, json=payload)
        if first.status_code != 200:
            raise RuntimeError(f"First upsert failed: {first.status_code} {first.text}")
        first_body = first.json()
        if first_body["created"] is not True:
            raise RuntimeError(f"First upsert should create a reference: {first_body}")

        second = client.post("/api/v1/external-documents/upsert", headers=headers, json=payload)
        if second.status_code != 200:
            raise RuntimeError(f"Second upsert failed: {second.status_code} {second.text}")
        second_body = second.json()
        if second_body["created"] is not False:
            raise RuntimeError(f"Second upsert should be idempotent: {second_body}")
        if second_body["external_document"]["external_document_id"] != first_body["external_document"]["external_document_id"]:
            raise RuntimeError("Idempotent upsert returned a different external document id")


def verify_document_publication_immutability(database_url: str) -> None:
    version_id = "ver_pg_public_immutable"
    publication_id = "pub_pg_public_immutable"
    policy_hash = f"sha256:{'b' * 64}"
    source_hash = f"sha256:{'a' * 64}"
    snapshot = {
        "schemaVersion": "akb-public-document-1",
        "documentId": "placeholder",
        "documentVersionId": version_id,
        "title": "PostgreSQL public immutable smoke",
        "documentType": "contract",
        "versionLabel": "1.0",
        "validFrom": None,
        "validTo": None,
        "publishedAt": "2026-07-13T12:00:00Z",
        "description": None,
        "file": {
            "filename": "public-smoke.pdf",
            "mimeType": "application/pdf",
            "sizeBytes": 10,
            "sha256": source_hash,
        },
    }
    with psycopg.connect(psycopg_url(database_url), autocommit=True) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT document_id FROM documents ORDER BY created_at LIMIT 1")
            row = cursor.fetchone()
            if row is None:
                raise RuntimeError("PostgreSQL smoke document is unavailable")
            document_id = row[0]
            snapshot["documentId"] = document_id
            cursor.execute(
                """
                INSERT INTO document_versions (
                    document_version_id, document_id, version_label, status,
                    organization_id, policy_binding_id, policy_version, policy_hash,
                    policy_summary, governed_resource_id, governed_source_version,
                    governance_scope_type, governance_scope_id,
                    governance_registration_status, source_file_uri, file_hash,
                    created_at, published_at
                ) VALUES (
                    %s, %s, '1.0', 'valid',
                    'org_stratos', 'pb_akb_public_smoke', 'information-policy-2.0.0', %s,
                    '{}'::jsonb, 'gir_pg_public_smoke', %s,
                    'organization', 'org_stratos',
                    'REGISTERED', 's3://akl-documents/public-smoke.pdf', %s,
                    now(), now()
                )
                """,
                (version_id, document_id, policy_hash, version_id, source_hash),
            )
            cursor.execute(
                """
                INSERT INTO document_publications (
                    publication_id, document_id, document_version_id, public_slug,
                    status, snapshot_schema, public_snapshot, public_snapshot_hash,
                    source_file_uri, source_file_hash, source_filename,
                    source_mime_type, source_size_bytes, governed_resource_id,
                    source_version, policy_binding_id, policy_version, policy_hash,
                    central_publication_id, approved_by, published_by, published_at,
                    reason, created_at, updated_at
                ) VALUES (
                    %s, %s, %s, 'pg-public-immutable',
                    'PUBLISHED', 'akb-public-document-1', %s::jsonb, %s,
                    's3://akl-documents/public-smoke.pdf', %s, 'public-smoke.pdf',
                    'application/pdf', 10, 'gir_pg_public_smoke',
                    %s, 'pb_akb_public_smoke', 'information-policy-2.0.0', %s,
                    'ipub_pg_public_smoke', 'smoke-actor', 'smoke-actor', now(),
                    'PostgreSQL immutability smoke', now(), now()
                )
                """,
                (
                    publication_id,
                    document_id,
                    version_id,
                    json.dumps(snapshot, separators=(",", ":"), sort_keys=True),
                    source_hash,
                    source_hash,
                    version_id,
                    policy_hash,
                ),
            )
            try:
                cursor.execute(
                    "UPDATE document_publications SET public_slug = 'tampered-slug' WHERE publication_id = %s",
                    (publication_id,),
                )
            except psycopg.Error:
                pass
            else:
                raise RuntimeError("Published document publication coordinates were mutable")
            cursor.execute(
                "SELECT public_slug FROM document_publications WHERE publication_id = %s",
                (publication_id,),
            )
            if cursor.fetchone()[0] != "pg-public-immutable":
                raise RuntimeError("Published document publication was modified despite the trigger")
            cursor.execute(
                """
                UPDATE document_publications
                SET status = 'REVOKED', revoked_by = 'smoke-revoker',
                    revoked_at = now(), reason = 'PostgreSQL revoke smoke', updated_at = now()
                WHERE publication_id = %s
                """,
                (publication_id,),
            )
            cursor.execute(
                "SELECT status, revoked_by, revoked_at FROM document_publications WHERE publication_id = %s",
                (publication_id,),
            )
            revoked = cursor.fetchone()
            if revoked is None or revoked[0] != "REVOKED" or revoked[1] != "smoke-revoker" or revoked[2] is None:
                raise RuntimeError("Published document publication could not enter terminal REVOKED state")
            try:
                cursor.execute(
                    "UPDATE document_publications SET status = 'PUBLISHED' WHERE publication_id = %s",
                    (publication_id,),
                )
            except psycopg.Error:
                pass
            else:
                raise RuntimeError("Revoked document publication was not terminal")


def verify_public_audit_aggregation(database_url: str) -> None:
    aggregate_key = "a" * 64
    with psycopg.connect(psycopg_url(database_url), autocommit=True) as connection:
        with connection.cursor() as cursor:
            for decision_id in ("pdec_pg_first", "pdec_pg_second"):
                cursor.execute(
                    """
                    INSERT INTO audit_events (
                        audit_event_id, actor_id, event_type, resource_type,
                        resource_id, severity, aggregate_key, occurrence_count,
                        last_seen_at, metadata, created_at
                    ) VALUES (
                        'pubaudit_pg_smoke', 'anonymous:public',
                        'public.document.allow', 'document_publication',
                        'pub_pg_public_immutable', 'info', %s, 1, now(),
                        jsonb_build_object('decision_id', %s::text), now()
                    )
                    ON CONFLICT (aggregate_key) DO UPDATE SET
                        occurrence_count = audit_events.occurrence_count + 1,
                        last_seen_at = excluded.last_seen_at,
                        metadata = excluded.metadata
                    """,
                    (aggregate_key, decision_id),
                )
            cursor.execute(
                """
                SELECT occurrence_count, metadata->>'decision_id'
                FROM audit_events
                WHERE aggregate_key = %s
                """,
                (aggregate_key,),
            )
            row = cursor.fetchone()
            if row != (2, "pdec_pg_second"):
                raise RuntimeError(f"Public audit aggregate upsert is invalid: {row}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1)
