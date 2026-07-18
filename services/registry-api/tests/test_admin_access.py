from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import UserProfile


def _upsert_payload(role: str = "document_manager") -> dict[str, str]:
    return {
        "subject_type": "user",
        "subject_id": "user_abc",
        "role": role,
        "status": "active",
    }


def test_upsert_role_mapping_creates_and_lists(client: TestClient, db_session: Session) -> None:
    db_session.add(UserProfile(user_id="user_abc", display_name="Alice Bedna"))
    db_session.commit()

    response = client.post("/api/v1/admin/role-mappings", json=_upsert_payload())
    assert response.status_code == 200
    body = response.json()
    assert body["subject_id"] == "user_abc"
    assert body["role"] == "document_manager"
    assert body["status"] == "active"
    assert body["display_name"] == "Alice Bedna"

    listing = client.get("/api/v1/admin/role-mappings")
    assert listing.status_code == 200
    members = listing.json()["members"]
    assert len(members) == 1
    assert members[0]["role_mapping_id"] == body["role_mapping_id"]


def test_upsert_role_mapping_is_idempotent(client: TestClient) -> None:
    first = client.post("/api/v1/admin/role-mappings", json=_upsert_payload())
    second = client.post("/api/v1/admin/role-mappings", json=_upsert_payload())
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["role_mapping_id"] == second.json()["role_mapping_id"]


def test_removed_role_mapping_hidden_unless_requested(client: TestClient) -> None:
    created = client.post("/api/v1/admin/role-mappings", json=_upsert_payload())
    mapping_id = created.json()["role_mapping_id"]

    patched = client.patch(
        f"/api/v1/admin/role-mappings/{mapping_id}/status",
        json={"status": "removed"},
    )
    assert patched.status_code == 200
    assert patched.json()["status"] == "removed"

    default_listing = client.get("/api/v1/admin/role-mappings")
    assert default_listing.json()["members"] == []

    full_listing = client.get("/api/v1/admin/role-mappings", params={"include_removed": "true"})
    assert len(full_listing.json()["members"]) == 1


def test_update_status_of_unknown_mapping_returns_404(client: TestClient) -> None:
    response = client.patch(
        "/api/v1/admin/role-mappings/rolemap_missing/status",
        json={"status": "removed"},
    )
    assert response.status_code == 404


def test_directory_search_without_keycloak_config_returns_503(client: TestClient) -> None:
    response = client.get("/api/v1/admin/directory/users", params={"query": "alice"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "keycloak_directory_not_configured"


def test_workflow_directory_search_requires_workflow_write(client: TestClient, reader_headers: dict[str, str]) -> None:
    forbidden = client.get("/api/v1/directory/users", params={"query": "alice"}, headers=reader_headers)
    assert forbidden.status_code == 403

    reviewer = client.get(
        "/api/v1/directory/users",
        params={"query": "alice"},
        headers={
            "X-AKL-Subject": "user_reviewer",
            "X-AKL-Roles": "reviewer",
        },
    )
    assert reviewer.status_code == 503
    assert reviewer.json()["error"]["code"] == "keycloak_directory_not_configured"

    default_listing = client.get(
        "/api/v1/directory/users",
        headers={
            "X-AKL-Subject": "user_reviewer",
            "X-AKL-Roles": "reviewer",
        },
    )
    assert default_listing.status_code == 503
    assert default_listing.json()["error"]["code"] == "keycloak_directory_not_configured"


def test_assistant_directory_search_requires_rag_access(
    client: TestClient,
) -> None:
    denied = client.get(
        "/api/v1/assistant/directory/users",
        headers={
            "X-AKL-Subject": "user_without_chat",
            "X-AKL-Roles": "stratos_user",
        },
    )
    assert denied.status_code == 403

    reader = client.get(
        "/api/v1/assistant/directory/users",
        headers={
            "X-AKL-Subject": "user_reader",
            "X-AKL-Roles": "reader",
        },
    )
    assert reader.status_code == 503
    assert reader.json()["error"]["code"] == "keycloak_directory_not_configured"
