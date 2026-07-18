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
                    "citations": [],
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
    assert messages[1]["availability"] == "available"
    assert messages[1]["content"] == "Postup je následující..."


def test_history_redacts_answer_when_cited_version_is_not_available(
    client: TestClient,
) -> None:
    client.post(
        "/api/v1/assistant/conversations/conv_redacted/messages",
        json=_append_payload(),
    )
    appended = client.post(
        "/api/v1/assistant/conversations/conv_redacted/messages",
        json={
            "user_id": "employee_1",
            "messages": [
                {
                    "role": "assistant",
                    "content": "Obsah, který nesmí obejít aktuální oprávnění.",
                    "response_type": "answer",
                    "citations": [
                        {
                            "chunk_id": "chunk_removed",
                            "document_id": "doc_removed",
                            "document_version_id": "ver_removed",
                        }
                    ],
                    "metadata": {
                        "confidence": "high",
                        "report_artifacts": [{"artifact_id": "sensitive_report"}],
                    },
                }
            ],
        },
    )
    assert appended.status_code == 201
    redacted = appended.json()["messages"][1]
    assert redacted["availability"] == "source_access_changed"
    assert redacted["content"] == ""
    assert redacted["citations"] == []
    assert redacted["metadata"] == {"history_access_changed": True}

    fetched = client.get(
        "/api/v1/assistant/conversation-history/conv_redacted",
    )
    assert fetched.status_code == 200
    assert fetched.json()["messages"][1] == redacted


def test_history_keeps_answer_when_exact_cited_version_is_still_authorized(
    client: TestClient,
) -> None:
    owner_headers = {
        "X-AKL-Subject": "employee_1",
        "X-AKL-Roles": "stratos_user",
        "X-STRATOS-Capabilities": "akb:upload,akb:manage_document,akb:chat",
        "X-STRATOS-Scopes": "organization",
        "X-STRATOS-Organization-ID": "org_stratos",
    }
    document = client.post(
        "/api/v1/documents",
        headers=owner_headers,
        json={
            "title": "Aktuální metodika",
            "document_type": "manual",
            "owner_id": "employee_1",
            "classification": "internal",
            "information_policy": {
                "schemaVersion": "stratos-information-policy-2",
                "policyBindingId": "pol_historyauthorized01",
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
                "originatorId": "employee_1",
                "issuedAt": "2026-07-18T08:00:00Z",
                "reviewAt": None,
            },
        },
    )
    assert document.status_code == 201, document.text
    document_id = document.json()["document_id"]
    version = client.post(
        f"/api/v1/documents/{document_id}/versions",
        headers=owner_headers,
        json={
            "version_label": "1.0",
            "source_file_uri": "s3://akl-documents/history/authorized.pdf",
            "file_hash": f"sha256:{'a' * 64}",
        },
    )
    assert version.status_code == 201, version.text
    version_id = version.json()["document_version_id"]

    client.post(
        "/api/v1/assistant/conversations/conv_authorized/messages",
        headers=owner_headers,
        json=_append_payload(),
    )
    appended = client.post(
        "/api/v1/assistant/conversations/conv_authorized/messages",
        headers=owner_headers,
        json={
            "user_id": "employee_1",
            "messages": [
                {
                    "role": "assistant",
                    "content": "Tato odpověď zůstává dostupná.",
                    "response_type": "answer",
                    "citations": [
                        {
                            "chunk_id": "chunk_authorized",
                            "document_id": document_id,
                            "document_version_id": version_id,
                        }
                    ],
                    "metadata": {"confidence": "high"},
                }
            ],
        },
    )
    assert appended.status_code == 201, appended.text
    answer = appended.json()["messages"][1]
    assert answer["availability"] == "available"
    assert answer["content"] == "Tato odpověď zůstává dostupná."
    assert answer["citations"][0]["document_version_id"] == version_id


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
