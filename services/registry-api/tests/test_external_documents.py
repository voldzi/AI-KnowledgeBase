def _external_payload(**overrides):
    payload = {
        "tenant_id": "default",
        "external_system": "STRATOS_BUDGET",
        "external_ref": "contract:256-2022-S:main",
        "entity_type": "Contract",
        "entity_id": "contract-uuid",
        "document_type": "contract",
        "title": "Smlouva 256-2022-S - Zajištění provozu přebíracích míst",
        "classification": "internal",
        "owner": {
            "user_id": "user_owner",
            "display_name": "Portfolio manager",
        },
        "metadata": {
            "contract_id": "contract-uuid",
            "contract_number": "256-2022-S",
            "supplier_name": "AUTOCONT a.s.",
            "budget_year": 2026,
        },
        "source_location": {
            "kind": "url",
            "uri": "https://stratos.local/contracts/256-2022-S/document",
            "file_name": "256-2022-S.pdf",
            "content_type": "application/pdf",
            "sha256": "a" * 64,
            "captured_at": "2026-06-07T00:00:00Z",
            "display_url": "https://stratos.local/contracts/256-2022-S",
            "repository": "BudgetContracts",
            "path": "/contracts/256-2022-S/document",
            "version": "2026-06-07",
        },
        "akb_source_uri": "s3://akl-documents/stratos/contracts/256-2022-S.pdf",
        "citation_base_url": "https://akb.local/api/v1/citations",
        "preview_url": "https://stratos.local/contracts/256-2022-S/preview",
    }
    payload.update(overrides)
    return payload


def test_external_document_upsert_creates_registry_document(client, admin_headers):
    response = client.post("/api/v1/external-documents/upsert", headers=admin_headers, json=_external_payload())

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] is True
    assert body["external_document"]["external_document_id"].startswith("extdoc_")
    assert body["external_document"]["external_system"] == "STRATOS_BUDGET"
    assert body["external_document"]["external_ref"] == "contract:256-2022-S:main"
    assert body["external_document"]["source_location"]["kind"] == "url"
    assert body["external_document"]["source_location"]["display_url"] == "https://stratos.local/contracts/256-2022-S"
    assert body["external_document"]["akb_source_uri"] == "s3://akl-documents/stratos/contracts/256-2022-S.pdf"
    assert body["external_document"]["citation_base_url"] == "https://akb.local/api/v1/citations"
    assert body["external_document"]["preview_url"] == "https://stratos.local/contracts/256-2022-S/preview"
    assert body["external_document"]["metadata"]["contract_number"] == "256-2022-S"
    assert body["document"]["document_id"].startswith("doc_")
    assert body["document"]["document_type"] == "contract"
    assert body["document"]["metadata"]["external"]["external_system"] == "STRATOS_BUDGET"
    assert body["document"]["metadata"]["external"]["source_location"]["file_name"] == "256-2022-S.pdf"
    assert "stratos_budget" in body["document"]["tags"]

    audit = client.get("/api/v1/audit/events", headers=admin_headers)
    assert audit.status_code == 200
    assert "external_document.upserted" in {event["event_type"] for event in audit.json()["items"]}


def test_external_document_upsert_is_idempotent(client, admin_headers):
    first = client.post("/api/v1/external-documents/upsert", headers=admin_headers, json=_external_payload())
    assert first.status_code == 200, first.text

    second = client.post(
        "/api/v1/external-documents/upsert",
        headers=admin_headers,
        json=_external_payload(title="Updated source title that should not duplicate"),
    )

    assert second.status_code == 200, second.text
    assert second.json()["created"] is False
    assert second.json()["external_document"]["external_document_id"] == first.json()["external_document"]["external_document_id"]
    assert second.json()["document"]["document_id"] == first.json()["document"]["document_id"]
    assert second.json()["document"]["title"] == first.json()["document"]["title"]

    listing = client.get("/api/v1/documents", headers=admin_headers)
    assert listing.status_code == 200
    assert len(listing.json()["items"]) == 1


def test_external_document_rejects_unknown_external_system(client, admin_headers):
    response = client.post(
        "/api/v1/external-documents/upsert",
        headers=admin_headers,
        json=_external_payload(external_system="UNKNOWN_STRATOS_APP", external_ref="contract:unknown-system:main"),
    )

    assert response.status_code == 422


def test_document_version_accepts_source_location(client, admin_headers):
    created = client.post("/api/v1/external-documents/upsert", headers=admin_headers, json=_external_payload())
    assert created.status_code == 200, created.text
    document_id = created.json()["document"]["document_id"]

    response = client.post(
        f"/api/v1/documents/{document_id}/versions",
        headers=admin_headers,
        json={
            "version_label": "1.0",
            "source_file_uri": "s3://akl-documents/stratos/contracts/256-2022-S.pdf",
            "source_location": {
                "kind": "object_storage",
                "uri": "s3://stratos-budget/contracts/256-2022-S.pdf",
                "storage_ref": "stratos-budget/contracts/256-2022-S.pdf",
                "file_name": "256-2022-S.pdf",
                "content_type": "application/pdf",
            },
            "file_hash": "sha256:" + "b" * 64,
        },
    )

    assert response.status_code == 201, response.text
    assert response.json()["source_location"]["kind"] == "object_storage"
    assert response.json()["source_location"]["storage_ref"] == "stratos-budget/contracts/256-2022-S.pdf"


def test_external_document_current_can_be_updated_after_ingestion_start(client, admin_headers, reader_headers):
    created = client.post("/api/v1/external-documents/upsert", headers=admin_headers, json=_external_payload())
    assert created.status_code == 200, created.text
    external_document_id = created.json()["external_document"]["external_document_id"]
    document_id = created.json()["document"]["document_id"]

    version = client.post(
        f"/api/v1/documents/{document_id}/versions",
        headers=admin_headers,
        json={
            "version_label": "1.0",
            "source_file_uri": "s3://akl-documents/stratos/contracts/256-2022-S.pdf",
            "file_hash": "sha256:" + "c" * 64,
            "file": {
                "filename": "256-2022-S.pdf",
                "mime_type": "application/pdf",
                "size_bytes": 123456,
                "sha256": "sha256:" + "c" * 64,
                "uploaded_by": "user_admin",
            },
        },
    )
    assert version.status_code == 201, version.text
    assert version.json()["file_id"].startswith("file_")

    forbidden = client.patch(
        f"/api/v1/external-documents/{external_document_id}/current",
        headers=reader_headers,
        json={"current_document_version_id": version.json()["document_version_id"]},
    )
    assert forbidden.status_code == 403

    response = client.patch(
        f"/api/v1/external-documents/{external_document_id}/current",
        headers=admin_headers,
        json={
            "current_document_version_id": version.json()["document_version_id"],
            "current_file_id": version.json()["file_id"],
            "current_ingestion_job_id": "job_stratos_123",
            "current_ingestion_status": "INGESTING",
            "akb_source_uri": "s3://akl-documents/stratos/contracts/256-2022-S.pdf",
            "source_location": {
                "kind": "object_storage",
                "uri": "s3://akl-documents/stratos/contracts/256-2022-S.pdf",
                "storage_ref": "stratos/contracts/256-2022-S.pdf",
                "file_name": "256-2022-S.pdf",
                "content_type": "application/pdf",
            },
        },
    )

    assert response.status_code == 200, response.text
    current = response.json()["external_document"]
    assert current["current_document_version_id"] == version.json()["document_version_id"]
    assert current["current_file_id"] == version.json()["file_id"]
    assert current["current_ingestion_job_id"] == "job_stratos_123"
    assert current["current_ingestion_status"] == "INGESTING"
    assert current["akb_source_uri"] == "s3://akl-documents/stratos/contracts/256-2022-S.pdf"
    assert current["source_location"]["kind"] == "object_storage"

    audit = client.get("/api/v1/audit/events?event_type=external_document.current_updated", headers=admin_headers)
    assert audit.status_code == 200
    assert audit.json()["items"][0]["resource_id"] == external_document_id


def test_external_document_can_be_opened_by_authorized_reader(client, admin_headers, reader_headers):
    created = client.post("/api/v1/external-documents/upsert", headers=admin_headers, json=_external_payload())
    assert created.status_code == 200, created.text
    external_document_id = created.json()["external_document"]["external_document_id"]

    detail = client.get(f"/api/v1/external-documents/{external_document_id}", headers=reader_headers)

    assert detail.status_code == 200, detail.text
    assert detail.json()["created"] is False
    assert detail.json()["external_document"]["external_document_id"] == external_document_id


def test_reader_cannot_create_external_document(client, reader_headers):
    response = client.post("/api/v1/external-documents/upsert", headers=reader_headers, json=_external_payload())

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_stratos_service_can_create_external_document(client):
    response = client.post(
        "/api/v1/external-documents/upsert",
        headers={
            "X-AKL-Subject": "svc_stratos",
            "X-AKL-Roles": "stratos_service",
            "X-Request-ID": "req-stratos-service",
            "X-Correlation-ID": "corr-stratos-service",
        },
        json=_external_payload(external_ref="contract:service-role-smoke:main"),
    )

    assert response.status_code == 200, response.text
    assert response.json()["created"] is True
