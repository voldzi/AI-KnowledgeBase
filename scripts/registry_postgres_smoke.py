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
    finally:
        if os.getenv("AKL_REGISTRY_PG_KEEP_DATABASE", "false").lower() not in {"1", "true", "yes"}:
            drop_database(admin_url, database_name)

    print("OK database=", database_name)
    print("OK migrations=head")
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
        "source_system": "STRATOS_BUDGET",
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


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        raise SystemExit(1)
