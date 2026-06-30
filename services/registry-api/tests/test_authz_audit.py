from app.models import RoleMapping


def test_authz_check_and_filter_documents(client, admin_headers):
    response = client.post(
        "/api/v1/documents",
        headers=admin_headers,
        json={
            "title": "Restricted policy",
            "document_type": "policy",
            "owner_id": "user_owner",
            "classification": "restricted",
            "access_policies": [
                {
                    "subjects": ["user:user_allowed"],
                    "actions": ["document.read", "rag.query"],
                    "constraints": {"classification_max": "restricted"},
                }
            ],
        },
    )
    assert response.status_code == 201, response.text
    document_id = response.json()["document_id"]

    allowed = client.post(
        "/api/v1/authz/check",
        headers=admin_headers,
        json={
            "subject_id": "user_allowed",
            "action": "document.read",
            "roles": ["reader"],
            "resource": {"document_id": document_id},
        },
    )
    assert allowed.status_code == 200
    assert allowed.json()["allowed"] is True

    denied = client.post(
        "/api/v1/authz/check",
        headers=admin_headers,
        json={
            "subject_id": "user_denied",
            "action": "document.read",
            "roles": ["reader"],
            "resource": {"document_id": document_id},
        },
    )
    assert denied.status_code == 200
    assert denied.json()["allowed"] is False

    filtered = client.post(
        "/api/v1/authz/filter-documents",
        headers=admin_headers,
        json={
            "subject_id": "user_allowed",
            "action": "document.read",
            "roles": ["reader"],
            "candidate_document_ids": [document_id, "doc_missing"],
        },
    )
    assert filtered.status_code == 200
    assert filtered.json() == {
        "allowed_document_ids": [document_id],
        "denied_document_ids": ["doc_missing"],
    }


def test_authz_caller_cannot_check_other_subject(client, reader_headers, admin_headers):
    created = client.post(
        "/api/v1/documents",
        headers=admin_headers,
        json={
            "title": "Internal document",
            "document_type": "manual",
            "owner_id": "user_owner",
            "classification": "internal",
        },
    )
    document_id = created.json()["document_id"]

    response = client.post(
        "/api/v1/authz/check",
        headers=reader_headers,
        json={
            "subject_id": "someone_else",
            "action": "document.read",
            "roles": ["reader"],
            "resource": {"document_id": document_id},
        },
    )

    assert response.status_code == 403


def test_authz_self_check_ignores_supplied_roles(client, admin_headers):
    created = client.post(
        "/api/v1/documents",
        headers=admin_headers,
        json={
            "title": "Internal reader policy",
            "document_type": "manual",
            "owner_id": "user_owner",
            "classification": "internal",
            "access_policies": [
                {
                    "subjects": ["role:reader"],
                    "actions": ["document.read", "rag.query"],
                    "constraints": {"classification_max": "internal"},
                }
            ],
        },
    )
    document_id = created.json()["document_id"]

    response = client.post(
        "/api/v1/authz/check",
        headers={"X-AKL-Subject": "user_without_roles", "X-AKL-Roles": "untrusted"},
        json={
            "subject_id": "user_without_roles",
            "action": "document.read",
            "roles": ["reader"],
            "resource": {"document_id": document_id},
        },
    )

    assert response.status_code == 200
    assert response.json()["allowed"] is False
    assert response.json()["reason"] == "no role grants action document.read"


def test_document_gestor_can_prepare_sources_without_publish_rights(client, admin_headers):
    create_allowed = client.post(
        "/api/v1/authz/check",
        headers=admin_headers,
        json={
            "subject_id": "user_gestor",
            "action": "document.create",
            "roles": ["document_gestor"],
            "resource": {"classification": "restricted"},
        },
    )
    assert create_allowed.status_code == 200
    assert create_allowed.json()["allowed"] is True

    confidential_denied = client.post(
        "/api/v1/authz/check",
        headers=admin_headers,
        json={
            "subject_id": "user_gestor",
            "action": "document.create",
            "roles": ["document_gestor"],
            "resource": {"classification": "confidential"},
        },
    )
    assert confidential_denied.status_code == 200
    assert confidential_denied.json()["allowed"] is False

    created = client.post(
        "/api/v1/documents",
        headers=admin_headers,
        json={
            "title": "Gestor directive",
            "document_type": "directive",
            "owner_id": "user_gestor",
            "classification": "restricted",
        },
    )
    assert created.status_code == 201, created.text
    document_id = created.json()["document_id"]

    ingest_allowed = client.post(
        "/api/v1/authz/check",
        headers=admin_headers,
        json={
            "subject_id": "user_gestor",
            "action": "document.ingest",
            "roles": ["document_gestor"],
            "resource": {"document_id": document_id},
        },
    )
    assert ingest_allowed.status_code == 200
    assert ingest_allowed.json()["allowed"] is True

    publish_denied = client.post(
        "/api/v1/authz/check",
        headers=admin_headers,
        json={
            "subject_id": "user_gestor",
            "action": "document.version.publish",
            "roles": ["document_gestor"],
            "resource": {"document_id": document_id},
        },
    )
    assert publish_denied.status_code == 200
    assert publish_denied.json()["allowed"] is False


def test_document_list_and_detail_use_role_mapping(client, db_session, admin_headers):
    created = client.post(
        "/api/v1/documents",
        headers=admin_headers,
        json={
            "title": "Mapped reader document",
            "document_type": "manual",
            "owner_id": "user_owner",
            "classification": "public",
            "access_policies": [
                {
                    "subjects": ["role:reader"],
                    "actions": ["document.read", "rag.query"],
                    "constraints": {"classification_max": "public"},
                }
            ],
        },
    )
    assert created.status_code == 201, created.text
    document_id = created.json()["document_id"]

    db_session.add(
        RoleMapping(
            subject_type="user",
            subject_id="mapped_reader",
            role="reader",
            status="active",
            assigned_by="user_admin",
        )
    )
    db_session.commit()

    mapped_headers = {"X-AKL-Subject": "mapped_reader", "X-AKL-Roles": "untrusted"}
    listing = client.get("/api/v1/documents", headers=mapped_headers)
    assert listing.status_code == 200, listing.text
    assert [item["document_id"] for item in listing.json()["items"]] == [document_id]

    detail = client.get(f"/api/v1/documents/{document_id}", headers=mapped_headers)
    assert detail.status_code == 200, detail.text
    assert detail.json()["document_id"] == document_id


def test_document_list_paginates_after_authorization(client, db_session, admin_headers):
    accessible = client.post(
        "/api/v1/documents",
        headers=admin_headers,
        json={
            "title": "Older mapped reader document",
            "document_type": "manual",
            "owner_id": "user_owner",
            "classification": "public",
            "access_policies": [
                {
                    "subjects": ["role:reader"],
                    "actions": ["document.read", "rag.query"],
                    "constraints": {"classification_max": "public"},
                }
            ],
        },
    )
    assert accessible.status_code == 201, accessible.text
    accessible_id = accessible.json()["document_id"]

    newer_inaccessible = client.post(
        "/api/v1/documents",
        headers=admin_headers,
        json={
            "title": "Newer admin-only document",
            "document_type": "manual",
            "owner_id": "user_owner",
            "classification": "confidential",
            "access_policies": [
                {
                    "subjects": ["role:admin"],
                    "actions": ["document.read", "rag.query"],
                    "constraints": {"classification_max": "confidential"},
                }
            ],
        },
    )
    assert newer_inaccessible.status_code == 201, newer_inaccessible.text

    db_session.add(
        RoleMapping(
            subject_type="user",
            subject_id="mapped_reader",
            role="reader",
            status="active",
            assigned_by="user_admin",
        )
    )
    db_session.commit()

    mapped_headers = {"X-AKL-Subject": "mapped_reader", "X-AKL-Roles": "untrusted"}
    listing = client.get("/api/v1/documents?limit=1", headers=mapped_headers)
    assert listing.status_code == 200, listing.text
    assert [item["document_id"] for item in listing.json()["items"]] == [accessible_id]


def test_reader_metadata_reports_exclude_restricted_and_confidential_documents(client, admin_headers, reader_headers):
    visible = client.post(
        "/api/v1/documents",
        headers=admin_headers,
        json={
            "title": "Interní metodika digitalizace",
            "document_type": "methodology",
            "owner_id": "user_owner",
            "classification": "internal",
            "tags": ["digitalizace"],
            "access_policies": [
                {
                    "subjects": ["role:reader"],
                    "actions": ["document.read", "rag.query"],
                    "constraints": {"classification_max": "internal"},
                }
            ],
        },
    )
    assert visible.status_code == 201, visible.text

    restricted = client.post(
        "/api/v1/documents",
        headers=admin_headers,
        json={
            "title": "Restricted digitalizace",
            "document_type": "methodology",
            "owner_id": "user_owner",
            "classification": "restricted",
            "tags": ["digitalizace"],
            "access_policies": [
                {
                    "subjects": ["role:admin"],
                    "actions": ["document.read", "rag.query"],
                    "constraints": {"classification_max": "restricted"},
                }
            ],
        },
    )
    assert restricted.status_code == 201, restricted.text

    confidential = client.post(
        "/api/v1/documents",
        headers=admin_headers,
        json={
            "title": "Confidential digitalizace",
            "document_type": "methodology",
            "owner_id": "user_owner",
            "classification": "confidential",
            "tags": ["digitalizace"],
            "access_policies": [
                {
                    "subjects": ["role:admin"],
                    "actions": ["document.read", "rag.query"],
                    "constraints": {"classification_max": "confidential"},
                }
            ],
        },
    )
    assert confidential.status_code == 201, confidential.text

    listing = client.get("/api/v1/documents?topic=digitalizace", headers=reader_headers)
    assert listing.status_code == 200, listing.text
    assert [item["title"] for item in listing.json()["items"]] == ["Interní metodika digitalizace"]

    summary = client.get("/api/v1/documents/metadata-summary?topic=digitalizace", headers=reader_headers)
    assert summary.status_code == 200, summary.text
    body = summary.json()
    assert body["total_visible_documents"] == 1
    assert body["total_matched_documents"] == 1
    assert body["by_classification"] == [{"key": "internal", "label": "internal", "count": 1}]


def test_audit_write_and_read(client):
    auditor_headers = {
        "X-AKL-Subject": "user_auditor",
        "X-AKL-Roles": "auditor",
        "X-Correlation-ID": "corr-audit",
    }

    created = client.post(
        "/api/v1/audit/events",
        headers=auditor_headers,
        json={
            "actor_id": "svc-rag",
            "event_type": "rag.query.executed",
            "resource_type": "rag_query",
            "resource_id": "query_123",
            "severity": "info",
            "metadata": {"service": "rag-retrieval-service"},
        },
    )
    assert created.status_code == 201, created.text
    event = created.json()
    assert event["audit_event_id"].startswith("audit_")
    assert event["correlation_id"] == "corr-audit"

    listing = client.get("/api/v1/audit/events?event_type=rag.query.executed", headers=auditor_headers)
    assert listing.status_code == 200
    assert listing.json()["items"][0]["audit_event_id"] == event["audit_event_id"]

    detail = client.get(f"/api/v1/audit/events/{event['audit_event_id']}", headers=auditor_headers)
    assert detail.status_code == 200
    assert detail.json()["metadata"] == {"service": "rag-retrieval-service"}
