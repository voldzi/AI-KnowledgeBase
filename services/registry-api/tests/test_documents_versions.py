import app.api as api_module
from app.schemas import (
    ControlledDocumentSourceType,
    ControlledRuleCitation,
    ControlledRuleProposal,
    ControlledRuleResponse,
)


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


def test_rag_metadata_summary_uses_rag_query_authorization(
    client,
    admin_headers,
    monkeypatch,
):
    document = _create_document(client, admin_headers, title="Budget contract")
    calls: list[tuple[str, str]] = []

    def runtime_decision(_principal, action, resource, local_decision):
        calls.append((action, resource.document_id))
        return api_module.Decision(
            True,
            "runtime test allow",
            local_decision.constraints,
            ("RUNTIME_TEST",),
        )

    monkeypatch.setattr(api_module, "evaluate_runtime_document_access", runtime_decision)

    registry_summary = client.get("/api/v1/documents/metadata-summary", headers=admin_headers)
    rag_summary = client.get("/api/v1/documents/rag-metadata-summary", headers=admin_headers)

    assert registry_summary.status_code == 200, registry_summary.text
    assert rag_summary.status_code == 200, rag_summary.text
    assert registry_summary.json()["total_visible_documents"] == 1
    assert rag_summary.json()["total_visible_documents"] == 1
    assert calls == [
        ("document.read", document["document_id"]),
        ("rag.query", document["document_id"]),
    ]


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


def test_non_overlapping_legal_versions_remain_valid_and_resolve_by_date(
    client,
    admin_headers,
):
    document = _create_document(
        client,
        admin_headers,
        title="134/2016 Sb. – Zákon o zadávání veřejných zakázek",
        document_type="regulation",
    )

    def create_and_publish(label, valid_from, valid_to):
        created = client.post(
            f"/api/v1/documents/{document['document_id']}/versions",
            headers=admin_headers,
            json={
                "version_label": label,
                "valid_from": valid_from,
                "valid_to": valid_to,
                "source_file_uri": f"s3://akl-documents/law/{label}.json",
                "file_hash": f"sha256:{label}",
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
        published = client.post(
            f"/api/v1/documents/{document['document_id']}/versions/"
            f"{created.json()['document_version_id']}/publish",
            headers=admin_headers,
        )
        assert published.status_code == 200, published.text
        return published.json()

    historical = create_and_publish("effective-2023", "2023-01-01", "2023-12-31")
    current = create_and_publish("effective-2024", "2024-01-01", None)

    versions = client.get(
        f"/api/v1/documents/{document['document_id']}/versions",
        headers=admin_headers,
    )
    assert versions.status_code == 200, versions.text
    statuses = {
        item["document_version_id"]: item["status"]
        for item in versions.json()["items"]
    }
    assert statuses[historical["document_version_id"]] == "valid"
    assert statuses[current["document_version_id"]] == "valid"

    historical_at = client.get(
        f"/api/v1/documents/{document['document_id']}/versions?valid_on=2023-06-01",
        headers=admin_headers,
    )
    assert historical_at.status_code == 200, historical_at.text
    assert [
        item["document_version_id"]
        for item in historical_at.json()["items"]
    ] == [historical["document_version_id"]]


def test_controlled_document_package_and_approved_rule_are_consumable(
    client,
    admin_headers,
):
    def published_document(title, document_type, version_label, source_uri):
        document = _create_document(
            client,
            admin_headers,
            title=title,
            document_type=document_type,
            tags=["controlled-document", "public_procurement"],
            metadata={"domain": "public_procurement"},
        )
        created = client.post(
            f"/api/v1/documents/{document['document_id']}/versions",
            headers=admin_headers,
            json={
                "version_label": version_label,
                "valid_from": "2023-05-30",
                "source_file_uri": source_uri,
                "file_hash": f"sha256:{version_label}",
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
        published = client.post(
            f"/api/v1/documents/{document['document_id']}/versions/"
            f"{created.json()['document_version_id']}/publish",
            headers=admin_headers,
        )
        assert published.status_code == 200, published.text
        return document, published.json()

    directive, directive_version = published_document(
        "Směrnice č. 2/2023 o zadávání veřejných zakázek",
        "directive",
        "1",
        "s3://akl-documents/procurement/directive.docx",
    )
    attachment, attachment_version = published_document(
        "Příloha č. 2 – formulář",
        "attachment",
        "1",
        "s3://akl-documents/procurement/pr2.docx",
    )
    package_response = client.post(
        "/api/v1/controlled-documentation/packages",
        headers=admin_headers,
        json={
            "package_key": "public_procurement:sm-2-2023",
            "release_label": "1",
            "title": "Směrnice č. 2/2023 včetně příloh",
            "domain": "public_procurement",
            "source_type": "internal_directive",
            "effective_from": "2023-05-30",
            "primary_document_id": directive["document_id"],
            "primary_document_version_id": directive_version["document_version_id"],
            "members": [
                {
                    "member_role": "main_document",
                    "relation_type": "related_to",
                    "document_id": directive["document_id"],
                    "document_version_id": directive_version["document_version_id"],
                    "ordinal": 0,
                },
                {
                    "member_role": "attachment",
                    "relation_type": "contains_attachment",
                    "document_id": attachment["document_id"],
                    "document_version_id": attachment_version["document_version_id"],
                    "ordinal": 1,
                },
            ],
            "metadata": {"review_due_on": "2024-05-30"},
        },
    )
    assert package_response.status_code == 201, package_response.text
    package = package_response.json()
    assert package["status"] == "draft"
    assert len(package["members"]) == 2

    transitioned = client.post(
        f"/api/v1/controlled-documentation/packages/{package['package_id']}/status",
        headers=admin_headers,
        json={"target_status": "approved"},
    )
    assert transitioned.status_code == 200, transitioned.text
    package = transitioned.json()

    missing_rules = client.post(
        f"/api/v1/controlled-documentation/packages/{package['package_id']}/status",
        headers=admin_headers,
        json={"target_status": "valid"},
    )
    assert missing_rules.status_code == 409, missing_rules.text
    assert missing_rules.json()["error"]["code"] == (
        "controlled_document_package_rules_not_proposed"
    )

    extraction_response = client.post(
        "/api/v1/document-extractions",
        headers=admin_headers,
        json={
            "tenant_id": "org_stratos",
            "external_system": "STRATOS_PLATFORM",
            "external_ref": package["package_id"],
            "entity_type": "controlled_document_package",
            "entity_id": package["package_id"],
            "document_id": directive["document_id"],
            "document_version_id": directive_version["document_version_id"],
            "profile": "controlled_document_rules_v1",
            "profile_version": "1",
            "status": "PROPOSED",
            "classification": "internal",
            "requested_by": "user_admin",
            "result": {
                "domain": "public_procurement",
                "package_id": package["package_id"],
                "rules": [
                    {
                        "rule_id": "internal.market-research.threshold",
                        "normative_key": "public_procurement.market_research.threshold",
                        "category": "financial_limit",
                        "title": "Průzkum trhu",
                        "value": 20000,
                        "unit": "CZK",
                        "currency": "CZK",
                        "vat_basis": "including_vat",
                        "conditions": [],
                        "exceptions": [],
                        "responsible_roles": ["příkazce operace"],
                        "required_evidence": ["záznam o průzkumu trhu"],
                        "confidence": 0.91,
                        "citation": {
                            "document_id": directive["document_id"],
                            "document_version_id": directive_version[
                                "document_version_id"
                            ],
                            "chunk_id": "chunk_procurement_threshold",
                            "section_path": ["Článek 6"],
                            "page_number": 8,
                            "quoted_text": "Průzkum trhu se provádí nad 20 000 Kč.",
                        },
                    }
                ],
            },
        },
    )
    assert extraction_response.status_code == 201, extraction_response.text
    extraction = extraction_response.json()["extraction"]

    authoring_view = client.get(
        "/api/v1/controlled-documentation/rules"
        "?domain=public_procurement&valid_on=2026-01-01"
        "&approved_only=false&include_inactive=true",
        headers=admin_headers,
    )
    assert authoring_view.status_code == 200, authoring_view.text
    assert authoring_view.json()["rules"][0]["verification_status"] == "proposed"

    pending_review = client.post(
        f"/api/v1/controlled-documentation/packages/{package['package_id']}/status",
        headers=admin_headers,
        json={"target_status": "valid"},
    )
    assert pending_review.status_code == 409, pending_review.text
    assert pending_review.json()["error"]["code"] == (
        "controlled_document_package_rules_pending_review"
    )

    before_approval = client.get(
        "/api/v1/controlled-documentation/rules"
        "?domain=public_procurement&valid_on=2026-01-01",
        headers=admin_headers,
    )
    assert before_approval.status_code == 200, before_approval.text
    assert before_approval.json()["rules"] == []
    assert before_approval.json()["warnings"] == [
        "NO_APPLICABLE_AUTHORIZED_CONTROLLED_DOCUMENT_PACKAGE"
    ]

    accepted = client.post(
        f"/api/v1/document-extractions/{extraction['extraction_id']}/feedback",
        headers=admin_headers,
        json={
            "field": "rules.internal.market-research.threshold",
            "ai_value": 20000,
            "final_value": 20000,
            "decision": "accepted",
            "actor": "user_admin",
            "source_app": "STRATOS_PLATFORM",
            "source_entity_id": package["package_id"],
        },
    )
    assert accepted.status_code == 201, accepted.text

    refreshed = client.post(
        "/api/v1/document-extractions",
        headers=admin_headers,
        json={
            "tenant_id": extraction["tenant_id"],
            "external_system": extraction["external_system"],
            "external_ref": extraction["external_ref"],
            "entity_type": extraction["entity_type"],
            "entity_id": extraction["entity_id"],
            "document_id": extraction["document_id"],
            "document_version_id": extraction["document_version_id"],
            "profile": extraction["profile"],
            "profile_version": extraction["profile_version"],
            "status": "PROPOSED",
            "classification": extraction["classification"],
            "requested_by": "user_admin",
            "refresh_existing": True,
            "result": {
                "domain": "public_procurement",
                "package_id": package["package_id"],
                "rules": [
                    extraction["result"]["rules"][0],
                    {
                        "rule_id": "internal.marketplace.threshold",
                        "normative_key": "public_procurement.marketplace.threshold",
                        "category": "financial_limit",
                        "title": "Elektronické tržiště",
                        "value": 50000,
                        "unit": "CZK",
                        "currency": "CZK",
                        "vat_basis": "excluding_vat",
                        "conditions": [],
                        "exceptions": [],
                        "responsible_roles": ["zadavatel"],
                        "required_evidence": [],
                        "confidence": 0.9,
                        "citation": {
                            "document_id": directive["document_id"],
                            "document_version_id": directive_version[
                                "document_version_id"
                            ],
                            "chunk_id": "chunk_marketplace_threshold",
                            "section_path": ["Elektronická tržiště"],
                            "page_number": 9,
                            "quoted_text": (
                                "Standardizovaná komodita nad 50 000 Kč bez DPH "
                                "se zadává přes elektronické tržiště."
                            ),
                        },
                    },
                ],
            },
        },
    )
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json()["created"] is False
    assert refreshed.json()["extraction"]["extraction_id"] == extraction["extraction_id"]

    refreshed_rules = client.get(
        "/api/v1/controlled-documentation/rules"
        "?domain=public_procurement&valid_on=2026-01-01"
        "&approved_only=false&include_inactive=true",
        headers=admin_headers,
    )
    assert refreshed_rules.status_code == 200, refreshed_rules.text
    statuses = {
        item["proposal"]["rule_id"]: item["verification_status"]
        for item in refreshed_rules.json()["rules"]
    }
    assert statuses == {
        "internal.market-research.threshold": "accepted",
        "internal.marketplace.threshold": "proposed",
    }

    accepted_marketplace = client.post(
        f"/api/v1/document-extractions/{extraction['extraction_id']}/feedback",
        headers=admin_headers,
        json={
            "field": "rules.internal.marketplace.threshold",
            "ai_value": 50000,
            "final_value": 50000,
            "decision": "accepted",
            "actor": "user_admin",
            "source_app": "STRATOS_PLATFORM",
            "source_entity_id": package["package_id"],
        },
    )
    assert accepted_marketplace.status_code == 201, accepted_marketplace.text

    activated = client.post(
        f"/api/v1/controlled-documentation/packages/{package['package_id']}/status",
        headers=admin_headers,
        json={"target_status": "valid"},
    )
    assert activated.status_code == 200, activated.text
    assert activated.json()["status"] == "valid"

    consumable = client.get(
        "/api/v1/controlled-documentation/rules"
        "?domain=public_procurement&valid_on=2026-01-01",
        headers=admin_headers,
    )
    assert consumable.status_code == 200, consumable.text
    body = consumable.json()
    assert body["rules"][0]["verification_status"] == "accepted"
    assert body["rules"][0]["proposal"]["value"] == 20000
    assert body["rules"][0]["proposal"]["citation"]["document_version_id"] == (
        directive_version["document_version_id"]
    )
    assert body["rules"][0]["precedence_status"] == "supplemental"
    assert body["rules"][0]["consumer_eligible"] is True
    assert "SOURCE_REVIEW_OVERDUE_POSSIBLY_STALE" in body["warnings"]


def test_controlled_rule_precedence_prefers_law_and_closes_equal_rank_conflict():
    citation = ControlledRuleCitation(
        document_id="doc_source",
        document_version_id="ver_source",
        chunk_id="chunk_source",
        quoted_text="Rozhodný limit činí stanovenou částku.",
    )

    def rule(
        *,
        package_id: str,
        source_type: ControlledDocumentSourceType,
        authority_rank: int,
        value: int,
    ) -> ControlledRuleResponse:
        return ControlledRuleResponse(
            extraction_id=f"ext_{package_id}",
            package_id=package_id,
            source_type=source_type,
            authority_rank=authority_rank,
            proposal=ControlledRuleProposal(
                rule_id=f"{package_id}.threshold",
                normative_key="public_procurement.vzmr.supplies.threshold",
                category="financial_limit",
                title="Limit veřejné zakázky",
                value=value,
                unit="CZK",
                currency="CZK",
                confidence=1,
                citation=citation,
            ),
            verification_status="accepted",
        )

    law = rule(
        package_id="law",
        source_type=ControlledDocumentSourceType.law,
        authority_rank=100,
        value=3_000_000,
    )
    directive = rule(
        package_id="directive",
        source_type=ControlledDocumentSourceType.internal_directive,
        authority_rank=60,
        value=100_000,
    )

    assert api_module._apply_controlled_rule_precedence([directive, law]) is False
    assert law.precedence_status == "authoritative"
    assert law.consumer_eligible is True
    assert directive.precedence_status == "shadowed"
    assert directive.consumer_eligible is False

    conflicting_law = rule(
        package_id="law-conflict",
        source_type=ControlledDocumentSourceType.law,
        authority_rank=100,
        value=4_000_000,
    )
    assert api_module._apply_controlled_rule_precedence(
        [law, conflicting_law]
    ) is True
    assert law.precedence_status == "conflict"
    assert conflicting_law.precedence_status == "conflict"
    assert law.consumer_eligible is False
    assert conflicting_law.consumer_eligible is False


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
