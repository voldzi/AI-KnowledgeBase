"""Real HTTP replay against durable SQL identity; authority transport is explicit."""
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, inspect, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import create_app
from app.models import AuditEvent, DocumentFile, DocumentVersion, DocumentProfileVersionSnapshot
from document_profile_fixtures import root_request, version_request, verified_profile_authority
from document_intake_fixtures import _intake_receipt


def prepare(client, headers):
    response = client.post("/api/v1/documents", json=root_request(), headers=headers)
    assert response.status_code == 201, response.text
    document = response.json()
    return document, version_request(document)


def counts(db):
    return tuple(db.scalar(select(func.count()).select_from(model)) for model in (
        DocumentVersion, DocumentFile, DocumentProfileVersionSnapshot, AuditEvent))


def test_lost_reply_returns_exact_original_without_writes(client, db_session, admin_headers, verified_profile_authority):
    document, payload = prepare(client, admin_headers)
    url = f"/api/v1/documents/{document['document_id']}/versions"
    first = client.post(url, json=payload, headers=admin_headers)
    assert first.status_code == 201, first.text
    original = first.json()
    before = counts(db_session)
    proofs_before = len(verified_profile_authority.requests)
    repeat = client.post(url, json=payload, headers=admin_headers)
    assert repeat.status_code == 200, repeat.text
    assert repeat.json() == {**original, "idempotent_replay": True}
    assert counts(db_session) == before
    assert len(verified_profile_authority.requests) > proofs_before
    # Replay performs fresh read revalidation, not registration of another version.
    assert all(request[2]["documentAdmission"]["operation"] == "revalidate"
               for request in verified_profile_authority.requests[proofs_before:])


@pytest.mark.parametrize("mutation", ["creator", "uploaded_by", "domain", "revision", "label", "summary", "uri", "receipt", "scope", "policy"])
def test_same_session_cannot_replace_immutable_evidence(client, db_session, admin_headers, verified_profile_authority, mutation):
    document, payload = prepare(client, admin_headers)
    url = f"/api/v1/documents/{document['document_id']}/versions"
    original = client.post(url, json=payload, headers=admin_headers)
    assert original.status_code == 201, original.text
    before = counts(db_session)
    changed = deepcopy(payload)
    headers = dict(admin_headers)
    if mutation == "creator": headers["X-AKL-Subject"] = "other_admin"
    if mutation == "uploaded_by": changed["file"]["uploaded_by"] = "other_admin"
    if mutation == "domain": changed["document_profile"]["domain_evidence"]["subject"] = "Replacement"
    if mutation == "revision": changed["document_profile"]["expected_root_metadata_revision"] = "changed-root-revision"
    if mutation == "label": changed["version_label"] = "2"
    if mutation == "summary": changed["change_summary"] = "Replacement"
    if mutation == "uri": changed["source_file_uri"] += ".replacement"
    if mutation in {"uri", "receipt"}:
        changed["file"]["intake_receipt"] = _intake_receipt(document["document_id"], changed, session="test-1")
    if mutation == "scope": changed["governance_scope"] = {"type":"organization_unit", "id":"other-unit"}
    if mutation == "policy":
        from document_policy_fixtures import admitted_policy
        changed["information_policy"] = admitted_policy(tlp="TLP:GREEN")
    result = client.post(url, json=changed, headers=headers)
    assert result.status_code in {403, 409}, result.text
    assert counts(db_session) == before


@pytest.mark.parametrize("mode,expected", [("deny",403),("unsupported",403),("stale",403)])
def test_replay_fresh_source_authority_fails_closed(client, db_session, admin_headers, verified_profile_authority, mode, expected):
    document, payload = prepare(client, admin_headers)
    url = f"/api/v1/documents/{document['document_id']}/versions"
    first = client.post(url, json=payload, headers=admin_headers)
    assert first.status_code == 201, first.text
    before = counts(db_session)
    verified_profile_authority.mode = mode
    replay = client.post(url, json=payload, headers=admin_headers)
    assert replay.status_code == expected, replay.text
    assert counts(db_session) == before


def test_concurrent_confirms_share_one_durable_version(tmp_path, admin_headers, verified_profile_authority):
    # Separate SQL connections/sessions and HTTP clients. No process-local lock
    # or shared in-memory Session stands in for the actual unique constraint.
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'native-replay.db'}", connect_args={"check_same_thread":False, "timeout":20})
    sessions = sessionmaker(bind=engine, autoflush=False)
    Base.metadata.create_all(engine)
    try:
        _assert_concurrent_http_replay(sessions, admin_headers)
    finally:
        engine.dispose()


def _assert_concurrent_http_replay(sessions, admin_headers):
    app = create_app()
    def database():
        with sessions() as session:
            yield session
    app.dependency_overrides[get_db] = database
    with TestClient(app) as client:
        document, payload = prepare(client, admin_headers)
    def confirm():
        with TestClient(app) as client:
            return client.post(f"/api/v1/documents/{document['document_id']}/versions", json=payload, headers=admin_headers)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: confirm(), range(2)))
    assert sorted(item.status_code for item in responses) == [200,201], [item.text for item in responses]
    assert len({item.json()["document_version_id"] for item in responses}) == 1
    with sessions() as session:
        assert counts(session)[:3] == (1,1,1)


@pytest.mark.skipif(not os.getenv("AKB_NATIVE_REPLAY_TEST_POSTGRES_URL"), reason="Explicit isolated PostgreSQL QA endpoint is required")
def test_postgresql_migrated_concurrent_native_replay(admin_headers, verified_profile_authority):
    # This opt-in test never migrates or truncates an existing database. It
    # creates a random database on the explicitly supplied disposable QA server.
    endpoint = make_url(os.environ["AKB_NATIVE_REPLAY_TEST_POSTGRES_URL"])
    assert endpoint.get_backend_name() == "postgresql"
    name = "akb_native_replay_" + uuid4().hex
    admin = create_engine(endpoint, isolation_level="AUTOCOMMIT")
    engine = None
    created = False
    try:
        with admin.connect() as connection:
            connection.exec_driver_sql(f'CREATE DATABASE "{name}"')
        created = True
        database_url = endpoint.set(database=name)
        result = subprocess.run([sys.executable,"-m","alembic","upgrade","head"],
            cwd=Path(__file__).resolve().parents[1], env={**os.environ,"AKL_DATABASE_URL":database_url.render_as_string(hide_password=False)},
            capture_output=True, text=True, timeout=90)
        assert result.returncode == 0, result.stderr
        engine = create_engine(database_url)
        unique = inspect(engine).get_unique_constraints("document_versions")
        assert any(item["name"] == "uq_document_version_native_intake"
                   and item["column_names"] == ["document_id","native_intake_session_hash"] for item in unique)
        _assert_concurrent_http_replay(sessionmaker(bind=engine,autoflush=False),admin_headers)
    finally:
        if engine is not None: engine.dispose()
        if created:
            with admin.connect() as connection:
                connection.exec_driver_sql(f'DROP DATABASE "{name}" WITH (FORCE)')
        admin.dispose()


def test_current_metadata_change_cannot_rebind_original_receipt(client, db_session, admin_headers, verified_profile_authority):
    document, payload = prepare(client, admin_headers)
    url = f"/api/v1/documents/{document['document_id']}/versions"
    original = client.post(url, json=payload, headers=admin_headers)
    assert original.status_code == 201, original.text
    proposed = root_request()["document_profile"]
    proposed["authorship"][0]["evidenceReference"] = "new-authority-evidence"
    updated = client.patch(f"/api/v1/documents/{document['document_id']}", json={
        "document_profile":proposed, "expected_root_metadata_revision":document["current_root_metadata_revision"],
    }, headers=admin_headers)
    assert updated.status_code == 200, updated.text
    before = counts(db_session)
    assert client.post(url, json=payload, headers=admin_headers).status_code == 409
    payload["document_profile"]["expected_root_metadata_revision"] = updated.json()["current_root_metadata_revision"]
    assert client.post(url, json=payload, headers=admin_headers).status_code == 409
    assert counts(db_session) == before


def test_root_authority_does_not_replace_exact_version_authority(client, db_session, admin_headers, verified_profile_authority, monkeypatch):
    document, payload = prepare(client, admin_headers)
    url = f"/api/v1/documents/{document['document_id']}/versions"
    assert client.post(url, json=payload, headers=admin_headers).status_code == 201
    original_request = verified_profile_authority._request
    def current_authority(method, url, token, body, **kwargs):
        verified_profile_authority.mode = "deny" if body["documentAdmission"].get("versionSnapshot") else "allow"
        return original_request(method, url, token, body, **kwargs)
    monkeypatch.setattr(verified_profile_authority, "_request", current_authority)
    before = counts(db_session)
    response = client.post(url, json=payload, headers=admin_headers)
    assert response.status_code == 403, response.text
    assert counts(db_session) == before


@pytest.mark.parametrize("mode", ["deny", "unsupported"])
def test_failed_central_registration_releases_reserved_identity(client, db_session, admin_headers, verified_profile_authority, monkeypatch, mode):
    document, payload = prepare(client, admin_headers)
    original_request = verified_profile_authority._request
    def registration(method, url, token, body, **kwargs):
        verified_profile_authority.mode = mode if body["documentAdmission"].get("versionSnapshot") else "allow"
        return original_request(method, url, token, body, **kwargs)
    monkeypatch.setattr(verified_profile_authority, "_request", registration)
    before = counts(db_session)
    url = f"/api/v1/documents/{document['document_id']}/versions"
    response = client.post(url, json=payload, headers=admin_headers)
    assert response.status_code == 503, response.text
    assert counts(db_session) == before
    monkeypatch.setattr(verified_profile_authority, "_request", original_request)
    verified_profile_authority.mode = "allow"
    retry = client.post(url, json=payload, headers=admin_headers)
    assert retry.status_code == 201, retry.text
