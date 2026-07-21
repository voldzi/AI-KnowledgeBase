import app.api as api_module


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


def test_document_list_applies_runtime_access(
    client,
    admin_headers,
    monkeypatch,
):
    allowed = _create_document(client, admin_headers, title="Runtime allowed")
    denied = _create_document(client, admin_headers, title="Runtime denied")
    calls = []

    def runtime_decision(_principal, _action, document, local_decision):
        calls.append(document.document_id)
        return api_module.Decision(
            document.document_id == allowed["document_id"],
            "runtime test decision",
            local_decision.constraints,
            ("RUNTIME_TEST",),
        )

    monkeypatch.setattr(api_module, "evaluate_runtime_document_access", runtime_decision)
    monkeypatch.setattr(
        api_module,
        "_is_official_public_source_document",
        lambda document: document.document_id == denied["document_id"],
    )

    listing = client.get("/api/v1/documents", headers=admin_headers)

    assert listing.status_code == 200, listing.text
    assert [item["document_id"] for item in listing.json()["items"]] == [allowed["document_id"]]
    assert set(calls) == {allowed["document_id"], denied["document_id"]}


def test_document_list_caches_identical_runtime_policy_coordinates(
    client,
    admin_headers,
    monkeypatch,
):
    first = _create_document(client, admin_headers, title="Shared policy one")
    second = _create_document(client, admin_headers, title="Shared policy two")
    calls = []

    def runtime_decision(_principal, _action, document, local_decision):
        calls.append(document.document_id)
        return api_module.Decision(
            True,
            "runtime test allow",
            local_decision.constraints,
            ("RUNTIME_TEST",),
        )

    monkeypatch.setattr(api_module, "evaluate_runtime_document_access", runtime_decision)

    listing = client.get("/api/v1/documents", headers=admin_headers)

    assert listing.status_code == 200, listing.text
    assert {item["document_id"] for item in listing.json()["items"]} == {
        first["document_id"],
        second["document_id"],
    }
    assert len(calls) == 1


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


def test_document_readiness_report_flags_pilot_blockers(client, admin_headers, reader_headers):
    ready = _create_document(
        client,
        admin_headers,
        title="Platná směrnice logistiky",
        tags=["logistika"],
        metadata={
            "document_number": "LOG-1",
            "issued_at": "2026-01-01",
            "domain": "logistika",
        },
    )
    version = client.post(
        f"/api/v1/documents/{ready['document_id']}/versions",
        headers=admin_headers,
        json={
            "version_label": "1.0",
            "valid_from": "2026-01-01",
            "source_file_uri": "s3://akl-documents/log/1.pdf",
            "file_hash": "sha256:ready",
        },
    )
    assert version.status_code == 201, version.text
    assert client.patch(
        f"/api/v1/documents/{ready['document_id']}",
        headers=admin_headers,
        json={"status": "review"},
    ).status_code == 200
    assert client.patch(
        f"/api/v1/documents/{ready['document_id']}",
        headers=admin_headers,
        json={"status": "approved"},
    ).status_code == 200
    published = client.post(
        f"/api/v1/documents/{ready['document_id']}/versions/{version.json()['document_version_id']}/publish",
        headers=admin_headers,
    )
    assert published.status_code == 200, published.text

    blocked = _create_document(
        client,
        admin_headers,
        title="Neúplný sken bez metadat",
        gestor_unit=None,
        tags=[],
        metadata={"quality_tier": "poor"},
        access_policies=[],
    )
    confidential = _create_document(
        client,
        admin_headers,
        title="Důvěrný dokument mimo reader",
        classification="confidential",
        access_policies=[
            {
                "subjects": ["role:admin"],
                "actions": ["document.read", "rag.query"],
                "constraints": {"classification_max": "confidential"},
            }
        ],
    )
    assert confidential["classification"] == "confidential"

    response = client.get("/api/v1/documents/readiness-report?max_issues=200", headers=admin_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total_visible_documents"] == 3
    assert body["ready_documents"] == 1
    assert body["blocked_documents"] == 2
    assert body["warnings"] == ["REGISTRY_DOCUMENT_READINESS_REPORT"]

    issue_codes = {issue["code"] for issue in body["issues"]}
    assert {
        "access_policy_missing",
        "source_version_missing",
        "gestor_missing",
        "low_extraction_quality",
        "document_number_missing",
        "issue_date_missing",
    } <= issue_codes
    issue_counts = {bucket["key"]: bucket["count"] for bucket in body["issue_counts"]}
    assert issue_counts["source_version_missing"] == 2
    assert issue_counts["access_policy_missing"] == 1

    reader_response = client.get("/api/v1/documents/readiness-report", headers=reader_headers)
    assert reader_response.status_code == 200, reader_response.text
    reader_body = reader_response.json()
    assert reader_body["total_visible_documents"] == 1
    assert all(issue["title"] != "Důvěrný dokument mimo reader" for issue in reader_body["issues"])


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


def test_valid_document_can_reenter_review_for_a_new_official_version(client, admin_headers):
    document = _create_document(client, admin_headers)
    created = client.post(
        f"/api/v1/documents/{document['document_id']}/versions",
        headers=admin_headers,
        json={
            "version_label": "1.0",
            "valid_from": "2026-07-01",
            "source_file_uri": "s3://akl-documents/doc/ver/official.pdf",
        },
    )
    assert created.status_code == 201, created.text
    assert client.patch(
        f"/api/v1/documents/{document['document_id']}",
        headers=admin_headers,
        json={"status": "review"},
    ).status_code == 200
    assert client.patch(
        f"/api/v1/documents/{document['document_id']}",
        headers=admin_headers,
        json={"status": "approved"},
    ).status_code == 200
    assert client.post(
        f"/api/v1/documents/{document['document_id']}/versions/{created.json()['document_version_id']}/publish",
        headers=admin_headers,
    ).status_code == 200

    reviewed_again = client.patch(
        f"/api/v1/documents/{document['document_id']}",
        headers=admin_headers,
        json={"status": "review"},
    )

    assert reviewed_again.status_code == 200, reviewed_again.text
    assert reviewed_again.json()["status"] == "review"


def test_analyst_case_saved_query_and_evidence_are_persisted(client, admin_headers, reader_headers):
    document = _create_document(client, admin_headers, title="Směrnice RMO 12/2024 pro řízení AI")

    created_case = client.post(
        "/api/v1/intelligence/cases",
        headers=reader_headers,
        json={
            "title": "RMO AI evidence",
            "description": "Evidence set for AI governance review.",
            "classification": "internal",
            "tags": ["rmo", "ai", "rmo"],
            "metadata": {"source": "test"},
        },
    )
    assert created_case.status_code == 201, created_case.text
    case = created_case.json()
    assert case["case_id"].startswith("case_")
    assert case["owner_id"] == "user_reader"
    assert case["tags"] == ["rmo", "ai"]

    saved_query = client.post(
        f"/api/v1/intelligence/cases/{case['case_id']}/saved-queries",
        headers=reader_headers,
        json={
            "title": "RMO fielded search",
            "query_text": "title:RMO AND entity:RMO12/2024",
            "query_mode": "fielded",
            "search_fields": ["title", "entity"],
            "filters": {"classification": "internal"},
        },
    )
    assert saved_query.status_code == 201, saved_query.text
    assert saved_query.json()["query_mode"] == "fielded"

    evidence = client.post(
        f"/api/v1/intelligence/cases/{case['case_id']}/evidence",
        headers=reader_headers,
        json={
            "title": "RMO chunk evidence",
            "document_id": document["document_id"],
            "document_version_id": "ver_test_1",
            "document_title": document["title"],
            "chunk_id": "chunk_test_1",
            "page_number": 3,
            "section_title": "Odpovědnosti",
            "source_file_name": "rmo-ai.pdf",
            "score": 10.4,
            "snippet": "RMO 12/2024 stanovuje odpovědnosti.",
            "entity_types": ["document_number"],
            "entity_values": ["RMO12/2024"],
            "metadata": {"query_mode": "fielded"},
        },
    )
    assert evidence.status_code == 201, evidence.text
    assert evidence.json()["chunk_id"] == "chunk_test_1"

    detail = client.get(f"/api/v1/intelligence/cases/{case['case_id']}", headers=reader_headers)
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert len(body["saved_queries"]) == 1
    assert len(body["evidence_items"]) == 1
    assert body["evidence_items"][0]["document_id"] == document["document_id"]

    audit = client.get("/api/v1/audit/events?resource_type=analyst_case", headers=admin_headers)
    assert audit.status_code == 200, audit.text
    events = audit.json()["items"]
    event_types = {event["event_type"] for event in events}
    assert {
        "intelligence.case.created",
        "intelligence.case.query_saved",
        "intelligence.case.evidence_added",
    } <= event_types
    for event in events:
        metadata = event["metadata"]
        assert "snippet" not in metadata
        assert "query_text" not in metadata
