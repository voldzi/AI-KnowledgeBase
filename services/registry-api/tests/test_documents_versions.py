from datetime import date

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


def test_document_list_supports_registry_filters_paging_and_global_summary(
    client,
    admin_headers,
):
    contract = _create_document(
        client,
        admin_headers,
        title="Smlouva o servisní podpoře",
        document_type="contract",
        classification="internal",
        tags=["servis", "ict"],
    )
    directive = _create_document(
        client,
        admin_headers,
        title="Interní bezpečnostní směrnice",
        document_type="directive",
        classification="restricted",
        tags=["bezpečnost"],
    )
    updated = client.patch(
        f"/api/v1/documents/{directive['document_id']}",
        headers=admin_headers,
        json={"status": "review"},
    )
    assert updated.status_code == 200, updated.text

    listing = client.get(
        "/api/v1/documents"
        "?q=servisní"
        "&status_in=draft"
        "&classification_in=internal"
        "&document_type_in=contract"
        "&limit=1"
        "&offset=0",
        headers=admin_headers,
    )

    assert listing.status_code == 200, listing.text
    payload = listing.json()
    assert payload["limit"] == 1
    assert payload["offset"] == 0
    assert payload["total"] == 1
    assert [item["document_id"] for item in payload["items"]] == [contract["document_id"]]
    assert payload["summary"] == {
        "total_documents": 2,
        "valid_documents": 0,
        "review_documents": 2,
        "restricted_documents": 1,
    }


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
    db_session,
):
    def published_document(title, document_type, version_label, source_uri):
        policy_binding_id = (
            "pol_controlled_directive01"
            if document_type == "directive"
            else "pol_controlled_attachment01"
        )
        document = _create_document(
            client,
            admin_headers,
            title=title,
            document_type=document_type,
            tags=["controlled-document", "public_procurement"],
            metadata={"domain": "public_procurement"},
            governance_scope={"type": "organization", "id": "org_stratos"},
            information_policy={
                "schemaVersion": "stratos-information-policy-2",
                "policyBindingId": policy_binding_id,
                "policyVersion": "information-policy-2.0.0",
                "handlingClass": "INTERNAL",
                "legalClassification": "NONE",
                "tlp": None,
                "pap": None,
                "contentCategories": ["CONTRACTUAL"],
                "audience": {
                    "organizationId": "org_stratos",
                    "scopeType": "organization",
                    "scopeIds": [],
                    "recipientSubjectIds": [],
                },
                "obligations": ["AUDIT_ACCESS", "NO_EXTERNAL_AI"],
                "originatorId": "user_owner",
                "issuedAt": "2023-05-30T00:00:00Z",
                "reviewAt": "2024-05-30T00:00:00Z",
            },
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
            "profile_version": "3",
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

    rejected_only_rule = client.post(
        f"/api/v1/document-extractions/{extraction['extraction_id']}/feedback",
        headers=admin_headers,
        json={
            "field": "rules.internal.market-research.threshold",
            "ai_value": 20000,
            "final_value": None,
            "decision": "rejected",
            "reason": "Návrh vyžaduje další kontrolu.",
            "actor": "user_admin",
            "source_app": "STRATOS_PLATFORM",
            "source_entity_id": package["package_id"],
        },
    )
    assert rejected_only_rule.status_code == 201, rejected_only_rule.text
    assert rejected_only_rule.json()["extraction"]["status"] == "PROPOSED"

    no_verified_rules = client.post(
        f"/api/v1/controlled-documentation/packages/{package['package_id']}/status",
        headers=admin_headers,
        json={"target_status": "valid"},
    )
    assert no_verified_rules.status_code == 409, no_verified_rules.text
    assert no_verified_rules.json()["error"]["code"] == (
        "controlled_document_package_rules_not_verified"
    )

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
    assert accepted.json()["extraction"]["status"] == "ACCEPTED_IN_SOURCE_APP"

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
                    {
                        "rule_id": "internal.incomplete-fragment",
                        "normative_key": "public_procurement.market_research.threshold",
                        "category": "financial_limit",
                        "title": "Neúplný návrh",
                        "value": 10000,
                        "unit": "CZK",
                        "currency": "CZK",
                        "vat_basis": "including_vat",
                        "conditions": [],
                        "exceptions": [],
                        "responsible_roles": [],
                        "required_evidence": [],
                        "confidence": 0.4,
                        "citation": {
                            "document_id": directive["document_id"],
                            "document_version_id": directive_version[
                                "document_version_id"
                            ],
                            "chunk_id": "chunk_incomplete_fragment",
                            "section_path": ["Neúplná věta"],
                            "page_number": 10,
                            "quoted_text": "Návrh bez dostatečného normativního významu.",
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
        "internal.incomplete-fragment": "proposed",
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
    assert accepted_marketplace.json()["extraction"]["status"] == "PROPOSED"

    rejected_fragment = client.post(
        f"/api/v1/document-extractions/{extraction['extraction_id']}/feedback",
        headers=admin_headers,
        json={
            "field": "rules.internal.incomplete-fragment",
            "ai_value": 10000,
            "final_value": None,
            "decision": "rejected",
            "reason": "Citace neobsahuje úplné normativní pravidlo.",
            "actor": "user_admin",
            "source_app": "STRATOS_PLATFORM",
            "source_entity_id": package["package_id"],
        },
    )
    assert rejected_fragment.status_code == 201, rejected_fragment.text
    assert rejected_fragment.json()["extraction"]["status"] == (
        "ACCEPTED_IN_SOURCE_APP"
    )

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

    public_only_headers = {
        "X-AKL-Subject": "user_chat_only",
        "X-AKL-Roles": "stratos_user",
        "X-STRATOS-Capabilities": "akb:chat",
        "X-STRATOS-Scopes": "public",
    }
    public_only_rules = client.get(
        "/api/v1/controlled-documentation/rules"
        "?domain=public_procurement&valid_on=2026-01-01&consumer_view=true",
        headers=public_only_headers,
    )
    assert public_only_rules.status_code == 200
    assert public_only_rules.json()["rules"] == []

    chat_headers = {
        "X-AKL-Subject": "user_employee",
        "X-AKL-Roles": "stratos_user",
        "X-STRATOS-Capabilities": "akb:chat,akb:read_document",
        "X-STRATOS-Scopes": "public,recipient_set:employee-directives",
    }
    hidden_management_packages = client.get(
        "/api/v1/controlled-documentation/packages"
        "?domain=public_procurement&valid_on=2026-01-01",
        headers=chat_headers,
    )
    assert hidden_management_packages.status_code == 200
    assert [
        item["package_id"]
        for item in hidden_management_packages.json()["items"]
    ] == [package["package_id"]]

    chat_consumable = client.get(
        "/api/v1/controlled-documentation/rules"
        "?domain=public_procurement&valid_on=2026-01-01&consumer_view=true",
        headers=chat_headers,
    )
    assert chat_consumable.status_code == 200, chat_consumable.text
    assert {
        rule["proposal"]["rule_id"] for rule in chat_consumable.json()["rules"]
    } == {
        "internal.market-research.threshold",
        "internal.marketplace.threshold",
    }, chat_consumable.json()
    from app.models import AuditEvent

    employee_rule_audit = (
        db_session.query(AuditEvent)
        .filter_by(
            actor_id="user_employee",
            event_type="controlled_rules.user_read",
            resource_id="public_procurement:2026-01-01",
        )
        .order_by(AuditEvent.created_at.desc())
        .first()
    )
    assert employee_rule_audit is not None
    assert employee_rule_audit.event_metadata["consumer_view"] is True
    assert employee_rule_audit.event_metadata["rule_count"] == 2
    assert "quoted_text" not in str(employee_rule_audit.event_metadata)
    employee_directive_detail = client.get(
        f"/api/v1/documents/{directive['document_id']}",
        headers=chat_headers,
    )
    assert employee_directive_detail.status_code == 200, employee_directive_detail.text
    def employee_registry_ids(query=""):
        response = client.get("/api/v1/documents", headers=chat_headers, params={"q": query})
        assert response.status_code == 200, response.text
        return {item["document_id"] for item in response.json()["items"]}

    assert directive["document_id"] in employee_registry_ids(directive["title"])
    assert attachment["document_id"] in employee_registry_ids(attachment["title"])
    employee_directive_versions = client.get(
        f"/api/v1/documents/{directive['document_id']}/versions",
        headers=chat_headers,
    )
    assert employee_directive_versions.status_code == 200, employee_directive_versions.text
    employee_directive_rag_filter = client.post(
        "/api/v1/authz/filter-documents",
        headers=chat_headers,
        json={
            "subject_id": "user_employee",
            "action": "rag.query",
            "candidate_document_ids": [directive["document_id"]],
            "candidate_policy_hashes": {
                directive["document_id"]: [directive["policy_hash"]]
            },
            "candidate_document_versions": {
                directive["document_id"]: [directive_version["document_version_id"]]
            },
        },
    )
    assert employee_directive_rag_filter.status_code == 200, (
        employee_directive_rag_filter.text
    )
    assert employee_directive_rag_filter.json()["allowed_document_ids"] == [
        directive["document_id"]
    ]
    assert employee_directive_rag_filter.json()["allowed_document_version_ids"] == {
        directive["document_id"]: [directive_version["document_version_id"]]
    }

    chat_without_document_read = {
        **chat_headers,
        "X-STRATOS-Capabilities": "akb:chat",
    }
    hidden_source_detail = client.get(
        f"/api/v1/documents/{directive['document_id']}",
        headers=chat_without_document_read,
    )
    assert hidden_source_detail.status_code == 403
    assert "CAPABILITY_MISSING" in hidden_source_detail.json()["error"]["details"][
        "reason_codes"
    ]

    unrelated, _ = published_document(
        "Interní pracovní podklad mimo řízené směrnice",
        "other",
        "1",
        "s3://akl-documents/procurement/unrelated.docx",
    )
    unrelated_detail = client.get(
        f"/api/v1/documents/{unrelated['document_id']}",
        headers=chat_headers,
    )
    assert unrelated_detail.status_code == 403
    assert unrelated["document_id"] not in employee_registry_ids()
    unrelated_rag_filter = client.post(
        "/api/v1/authz/filter-documents",
        headers=chat_headers,
        json={
            "subject_id": "user_employee",
            "action": "rag.query",
            "candidate_document_ids": [unrelated["document_id"]],
            "candidate_policy_hashes": {
                unrelated["document_id"]: [unrelated["policy_hash"]]
            },
        },
    )
    assert unrelated_rag_filter.status_code == 200
    assert unrelated_rag_filter.json()["allowed_document_ids"] == []

    from app.models import ControlledDocumentPackage, Document

    stored_package = db_session.get(ControlledDocumentPackage, package["package_id"])
    assert stored_package is not None
    stored_directive = db_session.get(Document, directive["document_id"])
    assert stored_directive is not None
    stored_directive.classification = "restricted"
    db_session.commit()
    restricted_rules = client.get(
        "/api/v1/controlled-documentation/rules"
        "?domain=public_procurement&valid_on=2026-01-01&consumer_view=true",
        headers=chat_headers,
    )
    assert restricted_rules.status_code == 200
    assert restricted_rules.json()["rules"] == []
    restricted_detail = client.get(
        f"/api/v1/documents/{directive['document_id']}",
        headers=chat_headers,
    )
    assert restricted_detail.status_code == 403
    assert directive["document_id"] not in employee_registry_ids()
    stored_directive.classification = "internal"
    db_session.commit()

    stored_package.package_metadata = {
        **stored_package.package_metadata,
        "employee_access": False,
    }
    db_session.commit()
    opted_out_rules = client.get(
        "/api/v1/controlled-documentation/rules"
        "?domain=public_procurement&valid_on=2026-01-01&consumer_view=true",
        headers=chat_headers,
    )
    assert opted_out_rules.status_code == 200
    assert opted_out_rules.json()["rules"] == []
    assert directive["document_id"] not in employee_registry_ids()
    assert attachment["document_id"] not in employee_registry_ids()
    stored_package.package_metadata = {
        key: value
        for key, value in stored_package.package_metadata.items()
        if key != "employee_access"
    }
    db_session.commit()

    stored_package.effective_to = date(2025, 12, 31)
    db_session.commit()
    expired_source_detail = client.get(
        f"/api/v1/documents/{directive['document_id']}",
        headers=chat_headers,
    )
    assert expired_source_detail.status_code == 403
    assert directive["document_id"] not in employee_registry_ids()
    stored_package.effective_to = None
    db_session.commit()

    legacy_extraction_response = client.post(
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
            "profile_version": "2",
            "status": "PROPOSED",
            "classification": "internal",
            "requested_by": "user_admin",
            "result": {
                "domain": "public_procurement",
                "package_id": package["package_id"],
                "rules": [
                    {
                        "rule_id": "legacy.market-research.threshold",
                        "normative_key": (
                            "public_procurement.market_research.threshold"
                        ),
                        "category": "financial_limit",
                        "title": "Historický návrh limitu",
                        "value": 99000,
                        "unit": "CZK",
                        "currency": "CZK",
                        "vat_basis": "including_vat",
                        "conditions": [],
                        "exceptions": [],
                        "responsible_roles": [],
                        "required_evidence": [],
                        "confidence": 0.8,
                        "citation": {
                            "document_id": directive["document_id"],
                            "document_version_id": directive_version[
                                "document_version_id"
                            ],
                            "chunk_id": "chunk_legacy_threshold",
                            "section_path": ["Historický návrh"],
                            "page_number": 1,
                            "quoted_text": "Historický návrh 99 000 Kč.",
                        },
                    }
                ],
            },
        },
    )
    assert legacy_extraction_response.status_code == 201
    legacy_extraction = legacy_extraction_response.json()["extraction"]
    accepted_legacy = client.post(
        f"/api/v1/document-extractions/{legacy_extraction['extraction_id']}/feedback",
        headers=admin_headers,
        json={
            "field": "rules.legacy.market-research.threshold",
            "ai_value": 99000,
            "final_value": 99000,
            "decision": "accepted",
            "actor": "user_admin",
            "source_app": "STRATOS_PLATFORM",
            "source_entity_id": package["package_id"],
        },
    )
    assert accepted_legacy.status_code == 201, accepted_legacy.text

    broad_rules = client.get(
        "/api/v1/controlled-documentation/rules"
        "?domain=public_procurement&valid_on=2026-01-01",
        headers=chat_headers,
    )
    assert broad_rules.status_code == 200, broad_rules.text
    assert "legacy.market-research.threshold" in {
        rule["proposal"]["rule_id"] for rule in broad_rules.json()["rules"]
    }

    consumer_view = client.get(
        "/api/v1/controlled-documentation/rules"
        "?domain=public_procurement&valid_on=2026-01-01&consumer_view=true",
        headers=chat_headers,
    )
    assert consumer_view.status_code == 200, consumer_view.text
    assert {
        rule["proposal"]["rule_id"] for rule in consumer_view.json()["rules"]
    } == {
        "internal.market-research.threshold",
        "internal.marketplace.threshold",
    }, consumer_view.json()

    inactive_consumer_view = client.get(
        "/api/v1/controlled-documentation/rules"
        "?domain=public_procurement&valid_on=2026-01-01"
        "&consumer_view=true&include_inactive=true",
        headers=admin_headers,
    )
    assert inactive_consumer_view.status_code == 422
    assert inactive_consumer_view.json()["error"]["code"] == (
        "controlled_rule_consumer_view_inactive_forbidden"
    )

    budget_service = client.get(
        "/api/v1/integrations/controlled-rules-read/rules"
        "?domain=public_procurement&valid_on=2026-01-01",
        headers={
            "X-AKL-Subject": "service-account-svc-budget-controlled-rules",
            "X-AKL-Service-Client-ID": "svc-budget-controlled-rules",
            "X-AKL-Roles": "service_budget_rules_read",
            "X-Correlation-ID": "corr-controlled-rules-budget",
        },
    )
    assert budget_service.status_code == 200, budget_service.text
    budget_body = budget_service.json()
    assert budget_body["contract"] == "akb-controlled-rules-1"
    assert budget_body["revision"] == "1.0.0"
    assert budget_body["status"] == "no_data"
    assert budget_body["decision_eligible"] is False
    assert budget_body["source_version"].startswith("sha256:")
    assert budget_body["sources"] == []
    assert budget_body["rules"] == []
    assert budget_body["warnings"] == [
        "SOURCE_REVIEW_OVERDUE_POSSIBLY_STALE",
        "NO_VERIFIED_CONTROLLED_RULES_AVAILABLE",
    ]


def test_budget_controlled_rules_route_is_fail_closed_and_audited(
    client,
    db_session,
):
    from app.models import AuditEvent

    denied_route = client.get(
        "/api/v1/integrations/controlled-rules-read/rules"
        "?domain=public_procurement&valid_on=2026-01-01",
        headers={
            "X-AKL-Subject": "service-account-stratos-akb-service",
            "X-AKL-Service-Client-ID": "stratos-akb-service",
            "X-AKL-Roles": "service_budget_rules_read,service_ingestion",
            "X-Correlation-ID": "corr-controlled-rules-route-denied",
        },
    )
    assert denied_route.status_code == 403, denied_route.text
    assert denied_route.json()["error"]["code"] == "service_route_forbidden"

    denied_route_unknown_domain = client.get(
        "/api/v1/integrations/controlled-rules-read/rules"
        "?domain=unknown_domain&valid_on=2026-01-01",
        headers={
            "X-AKL-Subject": "service-account-stratos-akb-service",
            "X-AKL-Service-Client-ID": "stratos-akb-service",
            "X-AKL-Roles": "service_budget_rules_read,service_ingestion",
            "X-Correlation-ID": "corr-controlled-rules-domain-route-denied",
        },
    )
    assert denied_route_unknown_domain.status_code == 403
    assert denied_route_unknown_domain.json()["error"]["code"] == (
        "service_route_forbidden"
    )

    denied = client.get(
        "/api/v1/integrations/controlled-rules-read/rules"
        "?domain=public_procurement&valid_on=2026-01-01",
        headers={
            "X-AKL-Subject": "service-account-svc-budget-controlled-rules",
            "X-AKL-Service-Client-ID": "svc-budget-controlled-rules",
            "X-Correlation-ID": "corr-controlled-rules-denied",
        },
    )
    assert denied.status_code == 403, denied.text
    assert denied.json()["error"]["code"] == "controlled_rules_service_required"
    denied_events = db_session.query(AuditEvent).filter_by(
        event_type="controlled_rules.read.denied"
    ).all()
    assert {event.correlation_id for event in denied_events} == {
        "corr-controlled-rules-route-denied",
        "corr-controlled-rules-domain-route-denied",
        "corr-controlled-rules-denied",
    }
    denied_event = next(
        event
        for event in denied_events
        if event.correlation_id == "corr-controlled-rules-denied"
    )
    assert denied_event.event_metadata["reason_code"] == (
        "controlled_rules_service_required"
    )

    no_data = client.get(
        "/api/v1/integrations/controlled-rules-read/rules"
        "?domain=public_procurement&valid_on=2026-01-01",
        headers={
            "X-AKL-Subject": "service-account-svc-budget-controlled-rules",
            "X-AKL-Service-Client-ID": "svc-budget-controlled-rules",
            "X-AKL-Roles": "service_budget_rules_read",
            "X-Correlation-ID": "corr-controlled-rules-empty",
        },
    )
    assert no_data.status_code == 200, no_data.text
    assert no_data.json()["status"] == "no_data"
    assert no_data.json()["decision_eligible"] is False
    assert no_data.json()["rules"] == []
    assert no_data.json()["warnings"] == [
        "NO_APPLICABLE_AUTHORIZED_CONTROLLED_DOCUMENT_PACKAGE"
    ]
    returned_event = db_session.query(AuditEvent).filter_by(
        event_type="controlled_rules.read.returned"
    ).one()
    assert returned_event.correlation_id == "corr-controlled-rules-empty"
    assert returned_event.event_metadata["status"] == "no_data"
    assert returned_event.event_metadata["item_count"] == 0
    assert returned_event.event_metadata["source_version"].startswith("sha256:")


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

    directive_without_law = rule(
        package_id="directive-without-law",
        source_type=ControlledDocumentSourceType.internal_directive,
        authority_rank=60,
        value=100_000,
    )
    assert api_module._apply_controlled_rule_precedence([directive_without_law]) is False
    assert directive_without_law.precedence_status == "shadowed"
    assert directive_without_law.consumer_eligible is False
    assert not api_module._has_required_statutory_rule_coverage(
        "public_procurement",
        [law],
    )

    works = rule(
        package_id="law-works",
        source_type=ControlledDocumentSourceType.law,
        authority_rank=100,
        value=9_000_000,
    )
    works.proposal.normative_key = "public_procurement.vzmr.works.threshold"
    assert api_module._apply_controlled_rule_precedence([law, works]) is False
    assert api_module._has_required_statutory_rule_coverage(
        "public_procurement",
        [law, works],
    )

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


def test_official_legal_packages_materialize_temporal_versions_and_reject_local_law(
    client,
    admin_headers,
    monkeypatch,
):
    local = _create_document(client, admin_headers, title="Lokální předpis")
    local_version_response = client.post(
        f"/api/v1/documents/{local['document_id']}/versions",
        headers=admin_headers,
        json={
            "version_label": "1",
            "valid_from": "2023-01-01",
            "source_file_uri": "s3://akl-documents/local.docx",
        },
    )
    assert local_version_response.status_code == 201, local_version_response.text
    local_version = local_version_response.json()
    rejected = client.post(
        "/api/v1/controlled-documentation/packages",
        headers=admin_headers,
        json={
            "package_key": "public_procurement:local-law",
            "release_label": "1",
            "title": "Lokální předpis",
            "domain": "public_procurement",
            "source_type": "law",
            "effective_from": "2023-01-01",
            "primary_document_id": local["document_id"],
            "primary_document_version_id": local_version["document_version_id"],
            "members": [{
                "member_role": "main_document",
                "relation_type": "related_to",
                "document_id": local["document_id"],
                "document_version_id": local_version["document_version_id"],
            }],
        },
    )
    assert rejected.status_code == 409, rejected.text
    assert rejected.json()["error"]["code"] == "controlled_document_legal_source_not_official"

    official = _create_document(
        client,
        admin_headers,
        title="Zákon č. 134/2016 Sb.",
        document_type="regulation",
        classification="public",
        tags=["official-public-reference", "official-source-collection:czech-law"],
        metadata={
            "collection_id": "czech-law",
            "canonical_url": "https://e-sbirka.gov.cz/sb/2016/134",
        },
    )
    versions = []
    for label, valid_from, valid_to in [
        ("2023-01-01", "2023-01-01", "2023-12-31"),
        ("2024-01-01", "2024-01-01", None),
    ]:
        response = client.post(
            f"/api/v1/documents/{official['document_id']}/versions",
            headers=admin_headers,
            json={
                "version_label": label,
                "valid_from": valid_from,
                "valid_to": valid_to,
                "source_file_uri": f"s3://akl-documents/{label}.pdf",
            },
        )
        assert response.status_code == 201, response.text
        versions.append(response.json())
    for state in ["review", "approved"]:
        assert client.patch(
            f"/api/v1/documents/{official['document_id']}",
            headers=admin_headers,
            json={"status": state},
        ).status_code == 200
    monkeypatch.setattr(api_module, "_is_official_public_source_document", lambda _document: True)
    for version in reversed(versions):
        assert client.post(
            f"/api/v1/documents/{official['document_id']}/versions/{version['document_version_id']}/publish",
            headers=admin_headers,
        ).status_code == 200

    payload = {
        "domain": "public_procurement",
        "sources": [{
            "document_id": official["document_id"],
            "source_type": "law",
            "package_key": "public_procurement:law-134-2016",
        }],
    }
    created = client.post(
        "/api/v1/controlled-documentation/official-legal-packages",
        headers=admin_headers,
        json=payload,
    )
    assert created.status_code == 201, created.text
    assert len(created.json()["created"]) == 2
    assert {item["effective_from"] for item in created.json()["created"]} == {
        "2023-01-01",
        "2024-01-01",
    }
    idempotent = client.post(
        "/api/v1/controlled-documentation/official-legal-packages",
        headers=admin_headers,
        json=payload,
    )
    assert idempotent.status_code == 201, idempotent.text
    assert idempotent.json()["created"] == []
    assert len(idempotent.json()["existing"]) == 2


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
