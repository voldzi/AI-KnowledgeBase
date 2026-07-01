def _create_document(client, headers, **overrides):
    payload = {
        "title": "Směrnice pro správu dokumentů",
        "document_type": "directive",
        "owner_id": "user_owner",
        "gestor_unit": "IT",
        "classification": "internal",
        "tags": ["smernice", "dokumentace"],
        "metadata": {"agenda": "registry"},
    }
    payload.update(overrides)
    response = client.post("/api/v1/documents", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_document_crud_and_audit(client, admin_headers):
    document = _create_document(client, admin_headers)

    assert document["document_id"].startswith("doc_")
    assert document["status"] == "draft"
    assert document["classification"] == "internal"
    assert len(document["access_policies"]) == 2

    listing = client.get("/api/v1/documents", headers=admin_headers)
    assert listing.status_code == 200
    assert [item["document_id"] for item in listing.json()["items"]] == [document["document_id"]]

    detail = client.get(f"/api/v1/documents/{document['document_id']}", headers=admin_headers)
    assert detail.status_code == 200
    assert detail.json()["metadata"] == {"agenda": "registry"}

    patched = client.patch(
        f"/api/v1/documents/{document['document_id']}",
        headers=admin_headers,
        json={"status": "review", "tags": ["updated"]},
    )
    assert patched.status_code == 200
    assert patched.json()["status"] == "review"
    assert patched.json()["tags"] == ["updated"]

    audit = client.get("/api/v1/audit/events", headers=admin_headers)
    assert audit.status_code == 200
    event_types = {event["event_type"] for event in audit.json()["items"]}
    assert {"document.created", "document.updated"} <= event_types

    deleted = client.delete(f"/api/v1/documents/{document['document_id']}", headers=admin_headers)
    assert deleted.status_code == 204

    cancelled = client.get(f"/api/v1/documents/{document['document_id']}", headers=admin_headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"


def test_document_metadata_summary_aggregates_authorized_topics(client, admin_headers, reader_headers):
    digital = _create_document(
        client,
        admin_headers,
        title="Metodika digitalizace služeb",
        document_type="methodology",
        classification="internal",
        tags=["digitalizace", "ict"],
        metadata={"domain": "digitalizace"},
    )
    project = _create_document(
        client,
        admin_headers,
        title="Metodika řízení projektů",
        document_type="project_documentation",
        classification="internal",
        tags=["projectflow", "projektové řízení"],
        metadata={"domain": "project management"},
    )
    restricted = _create_document(
        client,
        admin_headers,
        title="Důvěrná smlouva",
        document_type="contract",
        classification="confidential",
        tags=["smlouvy"],
        access_policies=[
            {
                "subjects": ["role:admin"],
                "actions": ["document.read", "rag.query"],
                "constraints": {"classification_max": "confidential"},
            }
        ],
    )

    for document in [digital, project]:
        reviewed = client.patch(
            f"/api/v1/documents/{document['document_id']}",
            headers=admin_headers,
            json={"status": "review"},
        )
        assert reviewed.status_code == 200, reviewed.text
        approved = client.patch(
            f"/api/v1/documents/{document['document_id']}",
            headers=admin_headers,
            json={"status": "approved"},
        )
        assert approved.status_code == 200, approved.text
    assert restricted["classification"] == "confidential"

    response = client.get(
        "/api/v1/documents/metadata-summary?topic=digitalizace&topic=řízení projektů",
        headers=reader_headers,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total_visible_documents"] == 2
    assert body["total_matched_documents"] == 2
    assert body["warnings"] == ["REGISTRY_METADATA_SUMMARY"]

    topics = {item["topic"]: item for item in body["topics"]}
    assert topics["digitalizace"]["document_count"] == 1
    assert topics["digitalizace"]["valid_or_approved_count"] == 1
    assert topics["řízení projektů"]["document_count"] == 1
    assert topics["řízení projektů"]["document_types"][0]["key"] == "project_documentation"
    assert all("Důvěrná smlouva" not in item["example_documents"] for item in body["topics"])


def test_version_create_publish_archive(client, admin_headers):
    document = _create_document(client, admin_headers)

    created = client.post(
        f"/api/v1/documents/{document['document_id']}/versions",
        headers=admin_headers,
        json={
            "version_label": "1.0",
            "valid_from": "2026-07-01",
            "valid_to": None,
            "source_file_uri": "s3://akl-documents/doc/ver/file.pdf",
            "file_hash": "sha256:abc",
            "change_summary": "První platná verze.",
            "file": {
                "filename": "smernice.pdf",
                "mime_type": "application/pdf",
                "size_bytes": 123,
                "sha256": "sha256:abc",
            },
        },
    )
    assert created.status_code == 201, created.text
    version = created.json()
    assert version["document_version_id"].startswith("ver_")
    assert version["status"] == "draft"

    rejected_publish = client.post(
        f"/api/v1/documents/{document['document_id']}/versions/{version['document_version_id']}/publish",
        headers=admin_headers,
    )
    assert rejected_publish.status_code == 409
    assert rejected_publish.json()["error"]["code"] == "publish_requires_approval"

    submitted = client.patch(
        f"/api/v1/documents/{document['document_id']}",
        headers=admin_headers,
        json={"status": "review"},
    )
    assert submitted.status_code == 200
    approved = client.patch(
        f"/api/v1/documents/{document['document_id']}",
        headers=admin_headers,
        json={"status": "approved"},
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "approved"

    published = client.post(
        f"/api/v1/documents/{document['document_id']}/versions/{version['document_version_id']}/publish",
        headers=admin_headers,
    )
    assert published.status_code == 200
    assert published.json()["status"] == "valid"
    assert published.json()["published_at"]

    archived = client.post(
        f"/api/v1/documents/{document['document_id']}/versions/{version['document_version_id']}/archive",
        headers=admin_headers,
    )
    assert archived.status_code == 200
    assert archived.json()["status"] == "archived"

    versions = client.get(f"/api/v1/documents/{document['document_id']}/versions", headers=admin_headers)
    assert versions.status_code == 200
    assert versions.json()["items"][0]["document_version_id"] == version["document_version_id"]


def test_document_status_transition_rejects_invalid_jump(client, admin_headers):
    document = _create_document(client, admin_headers)

    rejected = client.patch(
        f"/api/v1/documents/{document['document_id']}",
        headers=admin_headers,
        json={"status": "approved"},
    )

    assert rejected.status_code == 409
    assert rejected.json()["error"]["code"] == "invalid_document_status_transition"
