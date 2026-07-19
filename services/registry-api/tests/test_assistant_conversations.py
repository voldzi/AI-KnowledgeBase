from datetime import timedelta

from fastapi.testclient import TestClient

import app.api as registry_api
from app.assistant_retention import purge_expired_assistant_conversations
from app.information_policy import InformationPolicyBinding, canonical_policy_hash
from app.keycloak_directory import DirectoryUser
from app.models import (
    AuditEvent,
    AssistantConversation,
    AssistantConversationShare,
    AssistantMessage,
    Document,
    DocumentVersion,
    utcnow,
)


class _Directory:
    def __init__(self, users: list[DirectoryUser]) -> None:
        self._users = {user.subject: user for user in users}

    def search_users(self, query: str, max_results: int = 20) -> list[DirectoryUser]:
        normalized = query.casefold().strip()
        users = [
            user
            for user in self._users.values()
            if not normalized
            or normalized in user.name.casefold()
            or normalized in (user.email or "").casefold()
            or normalized in (user.username or "").casefold()
        ]
        return users[:max_results]

    def get_user(self, subject: str) -> DirectoryUser | None:
        return self._users.get(subject)


def _directory_user(
    subject: str,
    name: str,
    *,
    enabled: bool = True,
) -> DirectoryUser:
    return DirectoryUser(
        id=subject,
        subject=subject,
        provider="keycloak",
        name=name,
        initials="".join(part[0] for part in name.split()[:2]).upper(),
        email=f"{subject}@example.cz",
        username=subject,
        enabled=enabled,
    )


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
    assert body["messages"][0]["author_subject_id"] == "employee_1"
    assert body["messages"][0]["author_subject_type"] == "user"


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
    assert messages[1]["author_subject_id"] == "akb-assistant"
    assert messages[1]["author_subject_type"] == "service"
    assert messages[1]["author_display_name"] == "AKB Assistant"


def test_assistant_feedback_is_private_bounded_and_idempotent(
    client: TestClient,
    db_session,
    monkeypatch,
) -> None:
    recorded_metrics: list[tuple[str, str | None]] = []
    monkeypatch.setattr(
        registry_api,
        "record_assistant_feedback_metric",
        lambda *, rating, reason_code: recorded_metrics.append(
            (rating, reason_code)
        ),
    )
    created = client.post(
        "/api/v1/assistant/conversations/conv_feedback/messages",
        json={
            "user_id": "employee_1",
            "messages": [
                {
                    "role": "assistant",
                    "content": "Citovaná odpověď.",
                    "response_type": "answer",
                    "citations": [],
                    "metadata": {},
                }
            ],
        },
    )
    assert created.status_code == 201, created.text
    message_id = created.json()["messages"][0]["message_id"]

    helpful = client.put(
        f"/api/v1/assistant/conversation-history/conv_feedback/messages/{message_id}/feedback",
        json={"rating": "helpful", "reason_code": "accurate_useful"},
    )
    assert helpful.status_code == 200, helpful.text
    feedback_id = helpful.json()["feedback_id"]

    updated = client.put(
        f"/api/v1/assistant/conversation-history/conv_feedback/messages/{message_id}/feedback",
        json={"rating": "not_helpful", "reason_code": "citation_problem"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["feedback_id"] == feedback_id
    assert updated.json()["rating"] == "not_helpful"

    fetched = client.get(
        "/api/v1/assistant/conversation-history/conv_feedback",
    )
    assert fetched.status_code == 200
    assert fetched.json()["messages"][0]["viewer_feedback"] == updated.json()
    assert recorded_metrics == [
        ("helpful", "accurate_useful"),
        ("not_helpful", "citation_problem"),
    ]
    db_session.expire_all()
    audits = (
        db_session.query(AuditEvent)
        .filter(AuditEvent.event_type == "assistant.response.feedback")
        .all()
    )
    assert len(audits) == 2
    assert all(
        audit.event_metadata["content_retained_in_audit"] is False
        for audit in audits
    )
    assert all("content" not in audit.event_metadata for audit in audits)


def test_assistant_feedback_rejects_unbounded_or_user_message_feedback(
    client: TestClient,
) -> None:
    created = client.post(
        "/api/v1/assistant/conversations/conv_feedback_invalid/messages",
        json=_append_payload(),
    )
    assert created.status_code == 201
    user_message_id = created.json()["messages"][0]["message_id"]

    missing_reason = client.put(
        f"/api/v1/assistant/conversation-history/conv_feedback_invalid/messages/{user_message_id}/feedback",
        json={"rating": "not_helpful"},
    )
    assert missing_reason.status_code == 422

    wrong_role = client.put(
        f"/api/v1/assistant/conversation-history/conv_feedback_invalid/messages/{user_message_id}/feedback",
        json={"rating": "helpful"},
    )
    assert wrong_role.status_code == 422

    free_text = client.put(
        f"/api/v1/assistant/conversation-history/conv_feedback_invalid/messages/{user_message_id}/feedback",
        json={
            "rating": "not_helpful",
            "reason_code": "because this free text could be sensitive",
        },
    )
    assert free_text.status_code == 422


def test_history_redacts_answer_when_cited_version_is_not_available(
    client: TestClient,
    db_session,
    monkeypatch,
) -> None:
    metric_counts: list[int] = []
    monkeypatch.setattr(
        registry_api,
        "record_assistant_history_access_change_metrics",
        metric_counts.append,
    )
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
    assert metric_counts == [1, 1]
    db_session.expire_all()
    audits = (
        db_session.query(AuditEvent)
        .filter(
            AuditEvent.resource_id == "conv_redacted",
            AuditEvent.event_type
            == "assistant.history.source_access_changed",
        )
        .all()
    )
    assert len(audits) == 2
    assert all(
        audit.event_metadata
        == {
            "content_retained_in_audit": False,
            "redacted_message_count": 1,
        }
        for audit in audits
    )


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


def test_history_keeps_answer_for_exact_valid_official_public_reference(
    client: TestClient,
    db_session,
) -> None:
    policy = InformationPolicyBinding.model_validate(
        {
            "schemaVersion": "stratos-information-policy-2",
            "policyBindingId": "pol_historyofficial01",
            "policyVersion": "information-policy-2.0.0",
            "handlingClass": "PUBLIC",
            "legalClassification": "NONE",
            "tlp": None,
            "pap": None,
            "contentCategories": ["PUBLIC_INFORMATION"],
            "audience": {
                "organizationId": "org_stratos",
                "scopeType": "organization",
                "scopeIds": [],
                "recipientSubjectIds": [],
            },
            "obligations": ["AUDIT_ACCESS"],
            "originatorId": "service:akb",
            "issuedAt": "2026-07-19T08:00:00Z",
            "reviewAt": None,
        }
    )
    policy_hash = canonical_policy_hash(policy)
    document_id = "doc_history_official_public"
    version_id = "ver_history_official_public"
    document = Document(
        document_id=document_id,
        title="Zákon o státní statistické službě",
        document_type="regulation",
        status="valid",
        classification="public",
        owner_id="service:akb",
        organization_id="org_stratos",
        tags=["official-public-reference", "official-source-collection:czso"],
        document_metadata={
            "source_model": "official-public-reference-v1",
            "source_public": True,
            "audience": "organization",
            "anonymous_publication": False,
            "collection_id": "czso",
            "authority": "Český statistický úřad",
            "canonical_url": "https://www.czso.cz/csu/czso/statistical-service",
        },
        policy_binding_id=policy.policy_binding_id,
        policy_version=policy.policy_version,
        policy_hash=policy_hash,
        policy_summary=policy.model_dump(mode="json", by_alias=True, exclude_none=False),
        governance_scope_type="organization",
        governance_scope_id="org_stratos",
    )
    version = DocumentVersion(
        document_version_id=version_id,
        document_id=document_id,
        version_label="1.0",
        status="valid",
        organization_id="org_stratos",
        policy_binding_id=policy.policy_binding_id,
        policy_version=policy.policy_version,
        policy_hash=policy_hash,
        policy_summary=policy.model_dump(mode="json", by_alias=True, exclude_none=False),
        governance_scope_type="organization",
        governance_scope_id="org_stratos",
        governance_registration_status="MOCK_BYPASSED",
        governed_source_version=version_id,
        source_file_uri="s3://akl-documents/official/czso/statistical-service.html",
        file_hash=f"sha256:{'c' * 64}",
    )
    db_session.add_all([document, version])
    db_session.commit()
    public_headers = {
        "X-AKL-Subject": "employee_public",
        "X-AKL-Roles": "stratos_user",
        "X-STRATOS-Capabilities": "akb:chat,akb:read_document",
        "X-STRATOS-Scopes": "public",
        "X-STRATOS-Organization-ID": "org_stratos",
    }
    client.post(
        "/api/v1/assistant/conversations/conv_official_public/messages",
        headers=public_headers,
        json={
            "user_id": "employee_public",
            "messages": [
                {
                    "role": "user",
                    "content": "Jakým zákonem se řídí státní statistická služba?",
                    "citations": [],
                    "metadata": {},
                }
            ],
        },
    )
    appended = client.post(
        "/api/v1/assistant/conversations/conv_official_public/messages",
        headers=public_headers,
        json={
            "user_id": "employee_public",
            "messages": [
                {
                    "role": "assistant",
                    "content": "Řídí se zákonem č. 89/1995 Sb.",
                    "response_type": "answer",
                    "citations": [
                        {
                            "chunk_id": "chunk_history_official_public",
                            "document_id": document_id,
                            "document_version_id": version_id,
                        }
                    ],
                    "metadata": {"confidence": "high"},
                }
            ],
        },
    )
    fetched = client.get(
        "/api/v1/assistant/conversation-history/conv_official_public",
        headers=public_headers,
    )
    direct_read = client.get(
        f"/api/v1/documents/{document_id}",
        headers=public_headers,
    )

    assert appended.status_code == 201, appended.text
    assert appended.json()["messages"][1]["availability"] == "available"
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["messages"][1]["availability"] == "available"
    assert fetched.json()["messages"][1]["content"] == "Řídí se zákonem č. 89/1995 Sb."
    assert fetched.json()["messages"][1]["citations"][0]["document_version_id"] == version_id
    assert direct_read.status_code == 403
    assert "PUBLIC_PROJECTION_REQUIRED" in direct_read.json()["error"]["details"][
        "reason_codes"
    ]


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


def test_owner_can_share_conversation_with_verified_user(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        registry_api,
        "_directory_adapter",
        lambda: _Directory([_directory_user("employee_2", "Eva Horáková")]),
    )
    owner_headers = {"X-AKL-Subject": "employee_1", "X-AKL-Roles": "reader"}
    user_headers = {"X-AKL-Subject": "employee_2", "X-AKL-Roles": "reader"}
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
            ]
        },
    )
    assert shared.status_code == 200, shared.text
    assert shared.json()["visibility"] == "shared"
    assert len(shared.json()["shared_with"]) == 1
    assert shared.json()["shared_with"][0]["subject_display_name"] == "Eva Horáková"

    assert client.get("/api/v1/assistant/conversation-history/conv_shared", headers=user_headers).status_code == 200


def test_new_group_share_is_rejected_without_group_directory(
    client: TestClient,
) -> None:
    created = client.post(
        "/api/v1/assistant/conversations/conv_group/messages",
        json=_append_payload(),
    )
    assert created.status_code == 201, created.text
    response = client.put(
        "/api/v1/assistant/conversation-history/conv_group/shares",
        json={
            "shares": [
                {
                    "subject_type": "group",
                    "subject_id": "finance-team",
                    "permission": "viewer",
                }
            ]
        },
    )
    assert response.status_code == 422
    assert (
        response.json()["error"]["code"]
        == "assistant_group_directory_unavailable"
    )


def test_share_rejects_inactive_directory_user(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        registry_api,
        "_directory_adapter",
        lambda: _Directory(
            [_directory_user("employee_inactive", "Neaktivní Osoba", enabled=False)]
        ),
    )
    client.post(
        "/api/v1/assistant/conversations/conv_inactive/messages",
        json=_append_payload(),
    )
    response = client.put(
        "/api/v1/assistant/conversation-history/conv_inactive/shares",
        json={
            "shares": [
                {
                    "subject_type": "user",
                    "subject_id": "employee_inactive",
                    "permission": "viewer",
                }
            ]
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "directory_user_inactive"


def test_commenter_message_keeps_actual_author(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        registry_api,
        "_directory_adapter",
        lambda: _Directory([_directory_user("employee_2", "Eva Horáková")]),
    )
    owner_headers = {"X-AKL-Subject": "employee_1", "X-AKL-Roles": "reader"}
    commenter_headers = {
        "X-AKL-Subject": "employee_2",
        "X-AKL-Roles": "reader",
    }
    client.post(
        "/api/v1/assistant/conversations/conv_comment/messages",
        headers=owner_headers,
        json=_append_payload(),
    )
    shared = client.put(
        "/api/v1/assistant/conversation-history/conv_comment/shares",
        headers=owner_headers,
        json={
            "shares": [
                {
                    "subject_type": "user",
                    "subject_id": "employee_2",
                    "permission": "commenter",
                }
            ]
        },
    )
    assert shared.status_code == 200, shared.text

    appended = client.post(
        "/api/v1/assistant/conversations/conv_comment/messages",
        headers=commenter_headers,
        json={
            "user_id": "employee_1",
            "messages": [
                {
                    "role": "user",
                    "content": "Doplňuji otázku jako komentátor.",
                }
            ],
        },
    )
    assert appended.status_code == 201, appended.text
    assert appended.json()["messages"][-1]["author_subject_id"] == "employee_2"
    assert appended.json()["messages"][-1]["author_display_name"] == "Eva Horáková"


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


def test_owner_can_rename_pin_archive_and_restore_conversation(
    client: TestClient,
) -> None:
    owner_headers = {"X-AKL-Subject": "employee_1", "X-AKL-Roles": "reader"}
    for conversation_id in ("conv_regular", "conv_managed"):
        created = client.post(
            f"/api/v1/assistant/conversations/{conversation_id}/messages",
            headers=owner_headers,
            json=_append_payload(),
        )
        assert created.status_code == 201, created.text

    managed = client.patch(
        "/api/v1/assistant/conversation-history/conv_managed",
        headers=owner_headers,
        json={"title": "Řízení služeb IT", "pinned": True},
    )
    assert managed.status_code == 200, managed.text
    assert managed.json()["title"] == "Řízení služeb IT"
    assert managed.json()["pinned_at"]

    listed = client.get(
        "/api/v1/assistant/conversation-history",
        headers=owner_headers,
    )
    assert listed.status_code == 200, listed.text
    assert [
        item["conversation_id"] for item in listed.json()["items"]
    ] == ["conv_managed", "conv_regular"]

    archived = client.patch(
        "/api/v1/assistant/conversation-history/conv_managed",
        headers=owner_headers,
        json={"status": "archived"},
    )
    assert archived.status_code == 200, archived.text
    rejected_append = client.post(
        "/api/v1/assistant/conversations/conv_managed/messages",
        headers=owner_headers,
        json=_append_payload(content="Toto se nesmí přidat do archivu."),
    )
    assert rejected_append.status_code == 409
    assert rejected_append.json()["error"]["code"] == "conversation_archived"

    restored = client.patch(
        "/api/v1/assistant/conversation-history/conv_managed",
        headers=owner_headers,
        json={"status": "active", "pinned": False},
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["status"] == "active"
    assert restored.json()["archived_at"] is None
    assert restored.json()["pinned_at"] is None
    appended = client.post(
        "/api/v1/assistant/conversations/conv_managed/messages",
        headers=owner_headers,
        json=_append_payload(content="Po obnovení lze pokračovat."),
    )
    assert appended.status_code == 201, appended.text


def test_owner_delete_cascades_content_and_keeps_content_free_audit(
    client: TestClient,
    db_session,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        registry_api,
        "_directory_adapter",
        lambda: _Directory([_directory_user("employee_2", "Eva Horáková")]),
    )
    owner_headers = {"X-AKL-Subject": "employee_1", "X-AKL-Roles": "reader"}
    created = client.post(
        "/api/v1/assistant/conversations/conv_delete/messages",
        headers=owner_headers,
        json={
            **_append_payload(),
            "title": "Citlivý pracovní dotaz",
            "messages": [
                {"role": "user", "content": "Text, který nesmí zůstat."},
                {"role": "assistant", "content": "Odpověď, která se také maže."},
            ],
        },
    )
    assert created.status_code == 201, created.text
    shared = client.put(
        "/api/v1/assistant/conversation-history/conv_delete/shares",
        headers=owner_headers,
        json={
            "shares": [
                {
                    "subject_type": "user",
                    "subject_id": "employee_2",
                    "permission": "viewer",
                }
            ]
        },
    )
    assert shared.status_code == 200, shared.text

    deleted = client.delete(
        "/api/v1/assistant/conversation-history/conv_delete",
        headers=owner_headers,
    )
    assert deleted.status_code == 204, deleted.text
    db_session.expire_all()
    assert db_session.get(AssistantConversation, "conv_delete") is None
    assert (
        db_session.query(AssistantMessage)
        .filter(AssistantMessage.conversation_id == "conv_delete")
        .count()
        == 0
    )
    assert (
        db_session.query(AssistantConversationShare)
        .filter(AssistantConversationShare.conversation_id == "conv_delete")
        .count()
        == 0
    )
    audit = (
        db_session.query(AuditEvent)
        .filter(
            AuditEvent.resource_id == "conv_delete",
            AuditEvent.event_type == "assistant.conversation.deleted",
        )
        .one()
    )
    assert audit.event_type == "assistant.conversation.deleted"
    assert audit.resource_type == "assistant_conversation_tombstone"
    assert audit.event_metadata["content_retained"] is False
    assert audit.event_metadata["message_count"] == 2
    assert audit.event_metadata["share_count"] == 1
    assert "Citlivý" not in str(audit.event_metadata)
    assert "Text, který" not in str(audit.event_metadata)


def test_shared_reader_cannot_delete_owner_conversation(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        registry_api,
        "_directory_adapter",
        lambda: _Directory([_directory_user("employee_2", "Eva Horáková")]),
    )
    owner_headers = {"X-AKL-Subject": "employee_1", "X-AKL-Roles": "reader"}
    reader_headers = {"X-AKL-Subject": "employee_2", "X-AKL-Roles": "reader"}
    client.post(
        "/api/v1/assistant/conversations/conv_delete_denied/messages",
        headers=owner_headers,
        json=_append_payload(),
    )
    client.put(
        "/api/v1/assistant/conversation-history/conv_delete_denied/shares",
        headers=owner_headers,
        json={
            "shares": [
                {
                    "subject_type": "user",
                    "subject_id": "employee_2",
                    "permission": "viewer",
                }
            ]
        },
    )

    denied = client.delete(
        "/api/v1/assistant/conversation-history/conv_delete_denied",
        headers=reader_headers,
    )
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "conversation_owner_required"
    assert (
        client.get(
            "/api/v1/assistant/conversation-history/conv_delete_denied",
            headers=owner_headers,
        ).status_code
        == 200
    )


def test_retention_purge_is_physical_and_idempotent(
    client: TestClient,
    db_session,
) -> None:
    owner_headers = {"X-AKL-Subject": "employee_1", "X-AKL-Roles": "reader"}
    now = utcnow()
    for conversation_id in ("conv_expired", "conv_retained"):
        created = client.post(
            f"/api/v1/assistant/conversations/{conversation_id}/messages",
            headers=owner_headers,
            json={
                **_append_payload(),
                "retention_until": (now + timedelta(days=1)).isoformat(),
            },
        )
        assert created.status_code == 201, created.text
    expired = db_session.get(AssistantConversation, "conv_expired")
    assert expired is not None
    expired.retention_until = now - timedelta(seconds=1)
    db_session.add(
        AuditEvent(
            audit_event_id="audit_old_assistant_deletion",
            actor_id="employee_legacy",
            event_type="assistant.conversation.deleted",
            resource_type="assistant_conversation_tombstone",
            resource_id="conv_old_deleted",
            event_metadata={"content_retained": False},
            last_seen_at=now - timedelta(days=731),
            created_at=now - timedelta(days=731),
        )
    )
    db_session.commit()

    first = purge_expired_assistant_conversations(
        db_session,
        now=now,
        batch_size=50,
        audit_retention_days=730,
    )
    assert first.conversations == 1
    assert first.messages == 1
    assert first.audit_records_pruned == 1
    assert db_session.get(AssistantConversation, "conv_expired") is None
    assert db_session.get(AssistantConversation, "conv_retained") is not None
    tombstone = (
        db_session.query(AuditEvent)
        .filter(AuditEvent.resource_id == "conv_expired")
        .one()
    )
    assert tombstone.event_type == "assistant.conversation.purged"
    assert tombstone.actor_id == "system:assistant-retention"
    assert (
        db_session.get(AuditEvent, "audit_old_assistant_deletion") is None
    )

    second = purge_expired_assistant_conversations(
        db_session,
        now=now,
        batch_size=50,
        audit_retention_days=730,
    )
    assert second.conversations == 0
    assert (
        db_session.query(AuditEvent)
        .filter(AuditEvent.resource_id == "conv_expired")
        .count()
        == 1
    )


def test_append_cannot_revive_expired_conversation(
    client: TestClient,
    db_session,
) -> None:
    owner_headers = {"X-AKL-Subject": "employee_1", "X-AKL-Roles": "reader"}
    created = client.post(
        "/api/v1/assistant/conversations/conv_cannot_revive/messages",
        headers=owner_headers,
        json=_append_payload(),
    )
    assert created.status_code == 201, created.text
    conversation = db_session.get(
        AssistantConversation,
        "conv_cannot_revive",
    )
    assert conversation is not None
    conversation.retention_until = utcnow() - timedelta(seconds=1)
    db_session.commit()

    response = client.post(
        "/api/v1/assistant/conversations/conv_cannot_revive/messages",
        headers=owner_headers,
        json=_append_payload(content="Toto nesmí vlákno obnovit."),
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "conversation_not_found"
