def _external_payload(**overrides):
    payload = {
        "tenant_id": "default",
        "source_system": "STRATOS_BUDGET",
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
        "citation_base_url": "https://akb.local/api/v1/citations",
    }
    payload.update(overrides)
    return payload


def test_external_document_upsert_creates_registry_document(client, admin_headers):
    response = client.post("/api/v1/external-documents/upsert", headers=admin_headers, json=_external_payload())

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["created"] is True
    assert body["external_document"]["external_document_id"].startswith("extdoc_")
    assert body["external_document"]["source_system"] == "STRATOS_BUDGET"
    assert body["external_document"]["external_ref"] == "contract:256-2022-S:main"
    assert body["external_document"]["metadata"]["contract_number"] == "256-2022-S"
    assert body["document"]["document_id"].startswith("doc_")
    assert body["document"]["document_type"] == "contract"
    assert body["document"]["metadata"]["external"]["source_system"] == "STRATOS_BUDGET"
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
