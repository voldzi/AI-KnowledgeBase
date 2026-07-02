from __future__ import annotations

from tests.conftest import make_client


def _payload(**overrides):
    payload = {
        "tenant_id": "tenant-a",
        "external_system": "STRATOS_ARCHFLOW",
        "external_ref": "archflow-source-set:srcset-1:goal-catalog",
        "entity_type": "ArchflowSourceSet",
        "entity_id": "srcset-1",
        "source_set_id": "srcset-1",
        "documents": [
            {
                "document_id": "doc_archflow_goals",
                "document_version_id": "ver_archflow_goals_1",
                "canonical_url": "/akb/documents/doc_archflow_goals",
                "classification": "internal",
            }
        ],
        "subject_id": "archflow-user",
        "profile": "archflow_goal_extraction_v1",
        "profile_version": "1",
        "classification_max": "internal",
        "context_tags": ["archflow", "goal-catalog", "source-set:srcset-1"],
        "max_chunks": 18,
    }
    payload.update(overrides)
    return payload


def test_archflow_goal_extraction_profile_is_available() -> None:
    with make_client() as client:
        response = client.get("/api/v1/stratos/extractions/profiles")

    assert response.status_code == 200
    profiles = {profile["profile"]: profile for profile in response.json()["profiles"]}
    assert "archflow_goal_extraction_v1" in profiles
    assert "architecture_package_review_v1" in profiles
    assert "architecture_handover_v1" in profiles
    assert "metric" in profiles["archflow_goal_extraction_v1"]["fields"]
    assert "integration_requirement" in profiles["architecture_package_review_v1"]["fields"]
    assert "operational_runbook" in profiles["architecture_handover_v1"]["fields"]
    assert profiles["archflow_goal_extraction_v1"]["supported_external_systems"] == ["STRATOS_ARCHFLOW"]


def test_archflow_goal_extraction_proposes_cited_goals_requirements_and_metrics() -> None:
    with make_client() as client:
        response = client.post("/api/v1/stratos/extractions/archflow-goals/propose", json=_payload())

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "PROPOSED"
    assert body["profile"] == "archflow_goal_extraction_v1"
    assert body["entity_type"] == "ArchflowSourceSet"
    assert body["metadata"]["source_set_id"] == "srcset-1"
    assert body["metadata"]["source_documents"][0]["document_id"] == "doc_archflow_goals"
    fields = {proposal["field"]: proposal for proposal in body["proposals"]}
    assert fields["goal"]["proposal"]["goal_type"] == "STRATEGIC_GOAL"
    assert "Zvýšit dostupnost digitálních služeb" in fields["goal"]["proposal"]["title"]
    assert fields["obligation"]["proposal"]["obligation_type"] == "SHALL"
    assert fields["requirement"]["proposal"]["candidate_requirements"][0]["requirement_type"] == "non_functional"
    assert fields["metric"]["proposal"]["suggested_metrics"][0]["target"] == "99,9 %"
    assert fields["risk"]["proposal"]["risk"]
    assert fields["goal"]["citation"]["chunk_id"] == "chunk_archflow_goal_1"
    assert fields["goal"]["citation"]["viewer_url"].startswith("/akb/documents/doc_archflow_goals")
    assert "chunk_archflow_goal_1" in body["source_chunk_ids"]


def test_archflow_goal_extraction_supports_goal_catalog_version_context() -> None:
    payload = _payload(
        external_ref="archflow-catalog-version:catver-1:source-set:srcset-1",
        entity_type="ArchflowGoalCatalogVersion",
        entity_id="catver-1",
        catalog_version_id="catver-1",
        documents=[],
        context_tags=["archflow", "goal-catalog", "catalog-version:catver-1"],
    )
    with make_client() as client:
        response = client.post("/api/v1/stratos/extractions/archflow-goals/propose", json=payload)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["entity_type"] == "ArchflowGoalCatalogVersion"
    assert body["document_id"] == "doc_archflow_goals"
    assert body["document_version_id"] == "ver_archflow_goals_1"
    assert body["metadata"]["source_set_id"] == "srcset-1"
    assert body["metadata"]["catalog_version_id"] == "catver-1"


def test_archflow_goal_extraction_get_returns_generic_stored_result() -> None:
    with make_client() as client:
        created = client.post("/api/v1/stratos/extractions/archflow-goals/propose", json=_payload())
        extraction_id = created.json()["extraction_id"]
        fetched = client.get(f"/api/v1/stratos/extractions/{extraction_id}")

    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["extraction_id"] == extraction_id
    assert fetched.json()["proposals"][0]["field"] in {
        "goal",
        "capability",
        "obligation",
        "requirement",
        "metric",
        "legal_basis",
        "risk",
    }


def test_archflow_goal_extraction_feedback_marks_source_app_status() -> None:
    with make_client() as client:
        created = client.post("/api/v1/stratos/extractions/archflow-goals/propose", json=_payload())
        extraction_id = created.json()["extraction_id"]
        feedback = client.post(
            f"/api/v1/stratos/extractions/{extraction_id}/feedback",
            json={
                "field": "goal",
                "ai_value": {"title": "Zvýšit dostupnost digitálních služeb", "goal_type": "STRATEGIC_GOAL"},
                "final_value": {"title": "Zajistit dostupnost klíčových digitálních služeb", "goal_type": "STRATEGIC_GOAL"},
                "decision": "edited",
                "reason": "Úprava názvu podle terminologie katalogu cílů.",
                "actor": "archflow-reviewer",
                "source_app": "STRATOS_ARCHFLOW",
                "source_entity_id": "srcset-1",
            },
        )

    assert feedback.status_code == 200, feedback.text
    assert feedback.json()["feedback_id"].startswith("extfb_")
    assert feedback.json()["extraction"]["status"] == "ACCEPTED_IN_SOURCE_APP"


def test_archflow_goal_extraction_is_idempotent_for_same_document_version() -> None:
    with make_client() as client:
        first = client.post("/api/v1/stratos/extractions/archflow-goals/propose", json=_payload())
        second = client.post("/api/v1/stratos/extractions/archflow-goals/propose", json=_payload())

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.json()["extraction_id"] == first.json()["extraction_id"]


def test_archflow_goal_extraction_permission_denied_when_target_document_is_denied() -> None:
    with make_client(
        {
            "AKL_RAG_AUTHZ_MODE": "registry",
            "AKL_RAG_REGISTRY_CLIENT_MODE": "mock",
            "AKL_RAG_MOCK_DENIED_DOCUMENT_IDS": "doc_archflow_goals",
        }
    ) as client:
        response = client.post("/api/v1/stratos/extractions/archflow-goals/propose", json=_payload())

    assert response.status_code == 403


def _architecture_payload(**overrides):
    payload = {
        "tenant_id": "tenant-a",
        "external_system": "STRATOS_ARCHFLOW",
        "external_ref": "archflow-need:need-1:architecture-artifact:artifact-package-1",
        "entity_type": "ArchitectureArtifact",
        "entity_id": "artifact-package-1",
        "need_id": "need-1",
        "artifact_type": "TARGET_ARCHITECTURE",
        "document_id": "doc_archflow_package",
        "document_version_id": "ver_archflow_package_1",
        "documents": [
            {
                "document_id": "doc_archflow_package",
                "document_version_id": "ver_archflow_package_1",
                "canonical_url": "/akb/documents/doc_archflow_package",
                "classification": "internal",
            }
        ],
        "subject_id": "archflow-architect",
        "profile": "architecture_package_review_v1",
        "profile_version": "1",
        "classification_max": "internal",
        "context_tags": [
            "archflow",
            "STRATOS_ARCHFLOW",
            "need:need-1",
            "architecture-artifact:artifact-package-1",
            "artifact-type:TARGET_ARCHITECTURE",
        ],
        "max_chunks": 18,
    }
    payload.update(overrides)
    return payload


def test_archflow_architecture_package_extraction_proposes_cited_review_items() -> None:
    with make_client() as client:
        response = client.post(
            "/api/v1/stratos/extractions/architecture-package/propose",
            json=_architecture_payload(),
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "PROPOSED"
    assert body["profile"] == "architecture_package_review_v1"
    assert body["entity_type"] == "ArchitectureArtifact"
    assert body["metadata"]["artifact_type"] == "TARGET_ARCHITECTURE"
    assert body["metadata"]["need_id"] == "need-1"
    fields = {proposal["field"]: proposal for proposal in body["proposals"]}
    assert "package_scope" in fields
    assert "architecture_decision" in fields
    assert "integration_requirement" in fields
    assert fields["integration_requirement"]["citation"]["chunk_id"] == "chunk_archflow_package_1"
    assert fields["integration_requirement"]["citation"]["viewer_url"].startswith("/akb/documents/doc_archflow_package")


def test_archflow_architecture_handover_extraction_proposes_cited_handover_items() -> None:
    payload = _architecture_payload(
        external_ref="archflow-need:need-1:architecture-artifact:artifact-handover-1",
        entity_id="artifact-handover-1",
        artifact_type="HANDOVER_PACKAGE",
        document_id="doc_archflow_handover",
        document_version_id="ver_archflow_handover_1",
        documents=[
            {
                "document_id": "doc_archflow_handover",
                "document_version_id": "ver_archflow_handover_1",
                "canonical_url": "/akb/documents/doc_archflow_handover",
                "classification": "internal",
            }
        ],
        profile="architecture_handover_v1",
        context_tags=[
            "archflow",
            "STRATOS_ARCHFLOW",
            "need:need-1",
            "architecture-artifact:artifact-handover-1",
            "artifact-type:HANDOVER_PACKAGE",
        ],
    )
    with make_client() as client:
        response = client.post("/api/v1/stratos/extractions/architecture-handover/propose", json=payload)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "PROPOSED"
    assert body["profile"] == "architecture_handover_v1"
    fields = {proposal["field"]: proposal for proposal in body["proposals"]}
    assert "as_built_state" in fields
    assert "handover_item" in fields
    assert "operational_runbook" in fields
    assert fields["as_built_state"]["citation"]["chunk_id"] == "chunk_archflow_handover_1"


def test_archflow_architecture_extraction_get_returns_generic_stored_result() -> None:
    with make_client() as client:
        created = client.post(
            "/api/v1/stratos/extractions/architecture-package/propose",
            json=_architecture_payload(),
        )
        extraction_id = created.json()["extraction_id"]
        fetched = client.get(f"/api/v1/stratos/extractions/{extraction_id}")

    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["extraction_id"] == extraction_id
    assert fetched.json()["profile"] == "architecture_package_review_v1"
    assert fetched.json()["metadata"]["artifact_type"] == "TARGET_ARCHITECTURE"


def test_archflow_architecture_extraction_rejects_wrong_endpoint_profile() -> None:
    payload = _architecture_payload(profile="architecture_handover_v1")
    with make_client() as client:
        response = client.post("/api/v1/stratos/extractions/architecture-package/propose", json=payload)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_EXTRACTION_PROFILE"


def test_archflow_architecture_extraction_permission_denied_when_target_document_is_denied() -> None:
    with make_client(
        {
            "AKL_RAG_AUTHZ_MODE": "registry",
            "AKL_RAG_REGISTRY_CLIENT_MODE": "mock",
            "AKL_RAG_MOCK_DENIED_DOCUMENT_IDS": "doc_archflow_package",
        }
    ) as client:
        response = client.post(
            "/api/v1/stratos/extractions/architecture-package/propose",
            json=_architecture_payload(),
        )

    assert response.status_code == 403
