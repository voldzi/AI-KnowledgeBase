from __future__ import annotations

from tests.conftest import make_client


def _version(version_id: str, label: str, content: str) -> dict[str, object]:
    return {
        "document_id": "doc_123",
        "document_version_id": version_id,
        "document_title": "Smernice pro spravu dokumentu",
        "version_label": label,
        "status": "valid",
        "classification": "internal",
        "content": content,
    }


def _source_document(document_id: str, version_id: str, title: str, content: str) -> dict[str, object]:
    return {
        "document_id": document_id,
        "document_version_id": version_id,
        "document_title": title,
        "version_label": "1.0",
        "status": "valid",
        "classification": "internal",
        "content": content,
    }


def test_compare_versions_returns_cited_changes_and_sources() -> None:
    payload = {
        "subject_id": "user_123",
        "left_version": _version(
            "ver_1",
            "1.0",
            "Vyjimku schvaluje gestor dokumentu.\n\nZadost obsahuje duvod a rozsah.",
        ),
        "right_version": _version(
            "ver_2",
            "2.0",
            (
                "Vyjimku schvaluje gestor dokumentu po posouzeni dopadu.\n\n"
                "Zadost obsahuje duvod, rozsah a dobu platnosti vyjimky.\n\n"
                "Platnost vyjimky je maximalne 30 dni."
            ),
        ),
    }

    with make_client() as client:
        response = client.post("/api/v1/governance/compare-versions", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["result_id"].startswith("gov_")
    assert body["change_counts"]["modified"] >= 1
    assert body["citations"]
    assert body["sources"]
    assert body["confidence"] in {"medium", "high"}


def test_check_compliance_uses_rag_sources_and_reports_failures() -> None:
    payload = {
        "subject_id": "user_123",
        "draft": {
            "title": "Navrh smernice pro vyjimky",
            "document_type": "directive",
            "classification": "internal",
            "content": "Navrh popisuje vyjimku pro tym. Zadost obsahuje duvod a rozsah.",
        },
    }

    with make_client() as client:
        response = client.post("/api/v1/governance/check-compliance", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "non_compliant"
    assert any(finding["status"] == "failed" for finding in body["findings"])
    assert body["citations"]
    assert body["sources"]
    assert body["confidence"] in {"medium", "high"}


def test_detect_conflicts_finds_approval_owner_mismatch() -> None:
    payload = {
        "subject_id": "user_123",
        "documents": [
            _source_document("doc_123", "ver_1", "Smernice A", "Vyjimku schvaluje gestor dokumentu."),
            _source_document("doc_124", "ver_2", "Smernice B", "Vyjimku schvaluje vedouci oddeleni."),
        ],
    }

    with make_client() as client:
        response = client.post("/api/v1/governance/detect-conflicts", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["confidence"] == "conflicting_sources"
    assert body["conflicts"][0]["conflict_type"] == "approval_owner_mismatch"
    assert body["conflicts"][0]["claims"][0]["citation"]


def test_generate_kb_article_returns_draft_proposal_with_citations() -> None:
    payload = {
        "subject_id": "user_123",
        "source_document": _source_document(
            "doc_123",
            "ver_1",
            "Smernice pro spravu dokumentu",
            (
                "Rizeny dokument musi mit gestora. "
                "Vyjimku schvaluje gestor dokumentu. "
                "Zadost musi obsahovat duvod, rozsah a dobu platnosti. "
                "Platnost dokumentu je evidovana v registru."
            ),
        ),
        "audience": "employees",
    }

    with make_client() as client:
        response = client.post("/api/v1/governance/generate-kb-article", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["article"]["publication_status"] == "draft_proposal"
    assert len(body["article"]["sections"]) >= 2
    assert body["citations"]
    assert body["sources"]


def test_validity_alerts_return_authorized_registry_metadata_sources() -> None:
    with make_client() as client:
        response = client.get("/api/v1/governance/validity-alerts?subject_id=user_123&days_before_expiry=60")

    assert response.status_code == 200
    body = response.json()
    assert body["alerts"]
    assert all(alert["document_id"] != "doc_denied" for alert in body["alerts"])
    assert body["citations"][0]["chunk_id"].startswith("registry:")
    assert body["confidence"] == "high"


def test_non_compliant_check_writes_warning_audit_event(monkeypatch) -> None:
    captured: list[dict[str, object]] = []

    from app import registry_client as registry_module

    original = registry_module.MockRegistryClient.write_audit_event

    async def capture(self, *, actor_id, event_type, resource_id, metadata, severity="info"):
        captured.append({"event_type": event_type, "severity": severity, "metadata": metadata})
        return await original(
            self,
            actor_id=actor_id,
            event_type=event_type,
            resource_id=resource_id,
            metadata=metadata,
            severity=severity,
        )

    monkeypatch.setattr(registry_module.MockRegistryClient, "write_audit_event", capture)

    payload = {
        "subject_id": "user_123",
        "draft": {
            "document_id": "doc_999",
            "title": "Navrh smernice pro vyjimky",
            "document_type": "directive",
            "classification": "internal",
            "content": "Navrh popisuje vyjimku pro tym. Zadost obsahuje duvod a rozsah.",
        },
    }

    with make_client() as client:
        response = client.post("/api/v1/governance/check-compliance", json=payload)

    assert response.status_code == 200
    assert response.json()["status"] == "non_compliant"
    compliance_events = [item for item in captured if item["event_type"] == "governance.check_compliance.executed"]
    assert len(compliance_events) == 1
    assert compliance_events[0]["severity"] == "warning"
    assert compliance_events[0]["metadata"]["document_id"] == "doc_999"
