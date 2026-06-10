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

    fetched = client.get("/api/v1/assistant/conversations/conv_hist")
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
    response = client.get("/api/v1/assistant/conversations/conv_missing")
    assert response.status_code == 404
