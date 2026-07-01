from fastapi.testclient import TestClient


def _append_payload(role: str = "user", content: str = "Jak požádám o přístup?") -> dict[str, object]:
    return {
        "user_id": "employee_1",
        "messages": [
            {
                "role": role,
                "content": content,
                "citations": [],
                "metadata": {},
            }
        ],
    }


def test_append_creates_conversation_and_returns_messages(client: TestClient) -> None:
    response = client.post(
        "/api/v1/assistant/conversations/conv_test1/messages",
        json=_append_payload(),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["conversation_id"] == "conv_test1"
    assert body["user_id"] == "employee_1"
    assert len(body["messages"]) == 1
    assert body["messages"][0]["role"] == "user"


def test_append_accumulates_message_history(client: TestClient) -> None:
    client.post("/api/v1/assistant/conversations/conv_hist/messages", json=_append_payload())
    second = client.post(
        "/api/v1/assistant/conversations/conv_hist/messages",
        json={
            "user_id": "employee_1",
            "messages": [
                {
                    "role": "assistant",
                    "content": "Postup je následující...",
                    "response_type": "answer",
                    "citations": [{"chunk_id": "chunk_789", "document_id": "doc_123"}],
                    "metadata": {"confidence": "high"},
                }
            ],
        },
    )
    assert second.status_code == 201

    fetched = client.get("/api/v1/assistant/conversation-history/conv_hist")
    assert fetched.status_code == 200
    messages = fetched.json()["messages"]
    assert [message["role"] for message in messages] == ["user", "assistant"]
    assert messages[1]["citations"][0]["chunk_id"] == "chunk_789"


def test_append_rejects_user_mismatch(client: TestClient) -> None:
    client.post("/api/v1/assistant/conversations/conv_owned/messages", json=_append_payload())
    response = client.post(
        "/api/v1/assistant/conversations/conv_owned/messages",
        json={**_append_payload(), "user_id": "employee_2"},
    )
    assert response.status_code == 403


def test_get_unknown_conversation_returns_404(client: TestClient) -> None:
    response = client.get("/api/v1/assistant/conversation-history/conv_missing")
    assert response.status_code == 404


def test_reader_cannot_read_another_users_conversation(client: TestClient) -> None:
    owner_headers = {"X-AKL-Subject": "employee_1", "X-AKL-Roles": "reader"}
    other_headers = {"X-AKL-Subject": "employee_2", "X-AKL-Roles": "reader"}
    created = client.post(
        "/api/v1/assistant/conversations/conv_private/messages",
        headers=owner_headers,
        json=_append_payload(),
    )
    assert created.status_code == 201, created.text

    denied = client.get("/api/v1/assistant/conversation-history/conv_private", headers=other_headers)

    assert denied.status_code == 403


def test_owner_can_share_conversation_with_user_and_group(client: TestClient) -> None:
    owner_headers = {"X-AKL-Subject": "employee_1", "X-AKL-Roles": "reader"}
    user_headers = {"X-AKL-Subject": "employee_2", "X-AKL-Roles": "reader"}
    group_headers = {"X-AKL-Subject": "employee_3", "X-AKL-Roles": "reader", "X-AKL-Groups": "finance-team"}
    created = client.post(
        "/api/v1/assistant/conversations/conv_shared/messages",
        headers=owner_headers,
        json=_append_payload(),
    )
    assert created.status_code == 201, created.text

    shared = client.put(
        "/api/v1/assistant/conversation-history/conv_shared/shares",
        headers=owner_headers,
        json={
            "shares": [
                {"subject_type": "user", "subject_id": "employee_2", "permission": "viewer"},
                {"subject_type": "group", "subject_id": "finance-team", "permission": "commenter"},
            ]
        },
    )
    assert shared.status_code == 200, shared.text
    assert shared.json()["visibility"] == "shared"
    assert len(shared.json()["shared_with"]) == 2

    assert client.get("/api/v1/assistant/conversation-history/conv_shared", headers=user_headers).status_code == 200
    assert client.get("/api/v1/assistant/conversation-history/conv_shared", headers=group_headers).status_code == 200


def test_archive_hides_conversation_from_default_list(client: TestClient) -> None:
    owner_headers = {"X-AKL-Subject": "employee_1", "X-AKL-Roles": "reader"}
    created = client.post(
        "/api/v1/assistant/conversations/conv_archive/messages",
        headers=owner_headers,
        json=_append_payload(),
    )
    assert created.status_code == 201, created.text

    archived = client.patch(
        "/api/v1/assistant/conversation-history/conv_archive",
        headers=owner_headers,
        json={"status": "archived"},
    )
    assert archived.status_code == 200, archived.text
    assert archived.json()["status"] == "archived"
    assert archived.json()["archived_at"]

    visible = client.get("/api/v1/assistant/conversation-history", headers=owner_headers)
    assert visible.status_code == 200, visible.text
    assert visible.json()["items"] == []

    with_archived = client.get("/api/v1/assistant/conversation-history?include_archived=true", headers=owner_headers)
    assert with_archived.status_code == 200, with_archived.text
    assert [item["conversation_id"] for item in with_archived.json()["items"]] == ["conv_archive"]
