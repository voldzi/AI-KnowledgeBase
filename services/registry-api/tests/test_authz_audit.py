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
