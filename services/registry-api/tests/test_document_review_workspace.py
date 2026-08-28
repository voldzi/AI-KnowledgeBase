from datetime import datetime, timedelta, timezone
from dataclasses import replace
from pathlib import Path

import pytest
import yaml
from sqlalchemy import select

from app import api
from app.errors import problem
from app.models import Document, DocumentAssignment, DocumentFile, DocumentVersion, WorkflowTask


REVIEWER = {"X-AKL-Subject": "user_reviewer", "X-AKL-Roles": "reviewer"}


def source(client, headers, **overrides):
    payload = {
        "title": "Application manual", "document_type": "manual", "owner_id": "user_admin",
        "classification": "internal", "metadata": {"review_due_on": "2026-09-15"},
        "access_policies": [{"subjects": ["role:reviewer"], "actions": ["document.read", "document.version.publish"]}],
        "assignments": [
            {"role": "gestor", "subject_type": "user", "subject_id": "user_admin", "is_primary": True},
            {"role": "approver", "subject_type": "user", "subject_id": "user_reviewer", "is_primary": True},
        ],
        **overrides,
    }
    response = client.post("/api/v1/documents", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    doc = response.json()["document_id"]
    return doc, new_version(client, headers, doc)


def new_version(client, headers, doc, label="1.0", **overrides):
    response = client.post(f"/api/v1/documents/{doc}/versions", headers=headers, json={
        "version_label": label, "valid_from": "2026-08-01", "valid_to": "2027-08-01",
        "source_file_uri": f"s3://akl-documents/{doc}/{label}/manual.pdf", "file_hash": "sha256:" + "a" * 64,
        **overrides,
    })
    assert response.status_code == 201, response.text
    return response.json()["document_version_id"]


def submit(client, headers, doc, version):
    return client.post(f"/api/v1/documents/{doc}/versions/{version}/submit-review", headers=headers, json={})


def decide(client, headers, task, action="approve"):
    return client.post(f"/api/v1/workflow/tasks/{task}/actions", headers=headers, json={"action": action})


def test_exact_review_is_assigned_idempotent_and_audited(client, admin_headers):
    doc, version = source(client, admin_headers)
    response = submit(client, admin_headers, doc, version)
    assert response.status_code == 200, response.text
    task = response.json()
    assert task["document_version_id"] == version
    assert task["owner_id"] == "user_reviewer"
    assert task["allowed_actions"] == []
    assert submit(client, admin_headers, doc, version).json()["task_id"] == task["task_id"]
    listed = client.get("/api/v1/workflow/tasks?assigned_to_me=true&kind=review", headers=REVIEWER).json()
    assert listed["total"] == 1
    assert listed["items"][0]["assigned_to_me"] is True
    assert listed["items"][0]["allowed_actions"] == ["approve", "request_changes"]
    assert decide(client, admin_headers, task["task_id"]).status_code == 403
    approved = decide(client, REVIEWER, task["task_id"])
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "resolved"
    assert approved.json()["allowed_actions"] == []
    audit = client.get("/api/v1/audit/events?event_type=document.review.submitted", headers=admin_headers).json()
    assert len(audit["items"]) == 1
    assert set(audit["items"][0]["metadata"]) == {"document_id", "document_version_id", "assignment_id"}


def test_assignment_does_not_grant_approval_capability(client, admin_headers):
    doc, version = source(client, admin_headers)
    task = submit(client, admin_headers, doc, version).json()
    denied = decide(client, {**REVIEWER, "X-AKL-Roles": "reader"}, task["task_id"])
    assert denied.status_code == 403
    version_state = client.get(f"/api/v1/documents/{doc}/versions", headers=admin_headers).json()["items"][0]
    assert version_state["status"] == "review"


@pytest.mark.parametrize("assignments", [[], [
    {"role": "approver", "subject_type": "unit", "subject_id": "IT", "is_primary": True},
], [
    {"role": "approver", "subject_type": "service", "subject_id": "svc-test", "is_primary": True},
]])
def test_review_needs_human_or_group_assignment(client, admin_headers, assignments):
    doc, version = source(client, admin_headers, assignments=assignments)
    response = submit(client, admin_headers, doc, version)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "review_assignee_required"


@pytest.mark.parametrize("change", ["source", "metadata", "assignment", "new_version"])
def test_changed_review_cannot_be_approved(client, admin_headers, db_session, change):
    doc, version = source(client, admin_headers)
    task = submit(client, admin_headers, doc, version).json()
    if change == "source":
        db_session.get(DocumentVersion, version).file_hash = "sha256:" + "b" * 64
    elif change == "metadata":
        db_session.get(Document, doc).document_metadata = {"review_due_on": "2026-10-01"}
    elif change == "assignment":
        assignment = db_session.scalars(select(DocumentAssignment).where(
            DocumentAssignment.document_id == doc, DocumentAssignment.role == "approver",
        )).one()
        assignment.subject_id = "other_person"
    else:
        new_version(client, admin_headers, doc, "2.0")
    db_session.commit()
    response = decide(client, REVIEWER, task["task_id"])
    assert response.status_code in {403, 409}, response.text
    assert db_session.get(DocumentVersion, version).status == "review"


def test_returned_version_and_resubmission_have_separate_review_cycles(client, admin_headers):
    doc, version = source(client, admin_headers)
    first = submit(client, admin_headers, doc, version).json()
    response = decide(client, REVIEWER, first["task_id"], "request_changes")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "resolved"
    drafts = client.get("/api/v1/workflow/tasks?assigned_to_me=true&kind=draft", headers=admin_headers).json()["items"]
    assert len(drafts) == 1
    assert drafts[0]["document_version_id"] == version
    second = submit(client, admin_headers, doc, version)
    assert second.status_code == 200, second.text
    assert second.json()["task_id"] != first["task_id"]
    assert decide(client, REVIEWER, first["task_id"]).status_code == 409
    assert decide(client, REVIEWER, second.json()["task_id"]).status_code == 200


def test_published_version_survives_review_of_replacement(client, admin_headers, db_session):
    doc, first = source(client, admin_headers)
    review = submit(client, admin_headers, doc, first).json()
    assert decide(client, REVIEWER, review["task_id"]).status_code == 200
    path = f"/api/v1/documents/{doc}/versions"
    assert client.post(f"{path}/{first}/publish", headers=admin_headers).status_code == 200
    second = new_version(client, admin_headers, doc, "2.0")
    assert client.post(f"{path}/{second}/publish", headers=admin_headers).status_code == 409
    review2 = submit(client, admin_headers, doc, second).json()
    assert db_session.get(Document, doc).status == "valid"
    assert db_session.get(DocumentVersion, first).status == "valid"
    assert decide(client, REVIEWER, review2["task_id"]).status_code == 200
    assert db_session.get(DocumentVersion, first).status == "valid"
    assert client.post(f"{path}/{second}/publish", headers=admin_headers).status_code == 200
    assert db_session.get(DocumentVersion, first).status == "superseded"


def test_review_cannot_be_bypassed_by_patch_resolve_or_reassignment(client, admin_headers):
    doc, version = source(client, admin_headers)
    task = submit(client, admin_headers, doc, version).json()
    for status in ("approved", "valid"):
        assert client.patch(f"/api/v1/documents/{doc}", headers=admin_headers, json={"status": status}).status_code == 409
    for action in ("resolve", "assign"):
        assert decide(client, admin_headers, task["task_id"], action).status_code == 409
    changed_assignee = client.post(f"/api/v1/workflow/tasks/{task['task_id']}/actions", headers=REVIEWER,
                                  json={"action": "approve", "assignee_id": "user_reviewer"})
    assert changed_assignee.status_code == 400


def test_changed_approval_cannot_be_published(client, admin_headers, db_session):
    doc, version = source(client, admin_headers)
    task = submit(client, admin_headers, doc, version).json()
    assert decide(client, REVIEWER, task["task_id"]).status_code == 200
    db_session.get(Document, doc).title = "Changed title"
    db_session.commit()
    result = client.post(f"/api/v1/documents/{doc}/versions/{version}/publish", headers=admin_headers)
    assert result.status_code == 409
    assert result.json()["error"]["code"] == "review_source_changed"


@pytest.mark.parametrize("scan_status", ["pending_scan", "infected", "error"])
def test_unclean_source_is_not_reviewable(client, admin_headers, db_session, scan_status):
    doc, version = source(client, admin_headers)
    db_session.add(DocumentFile(document_id=doc, document_version_id=version,
                               uri="s3://akl-documents/source", filename="manual.pdf", mime_type="application/pdf",
                               size_bytes=100, content_security_status=scan_status))
    db_session.commit()
    result = submit(client, admin_headers, doc, version)
    assert result.status_code == 409
    assert result.json()["error"]["code"] == "review_scan_incomplete"


def test_required_scan_needs_exact_attested_source(client, admin_headers, monkeypatch):
    doc, version = source(client, admin_headers)
    monkeypatch.setattr(api.get_settings(), "content_security_required", True)
    assert submit(client, admin_headers, doc, version).status_code == 409


def test_personal_documents_use_assignments_not_admin_or_owner_label(client, admin_headers):
    doc, version = source(client, admin_headers)
    other, _ = source(client, admin_headers, title="Unassigned manual", owner_id="another_user", assignments=[])
    result = client.get("/api/v1/workflow/documents", headers=REVIEWER)
    assert result.status_code == 200, result.text
    assert result.json()["total"] == 1
    item = result.json()["items"][0]
    assert item["document_id"] == doc
    assert item["document_version_id"] == version
    assert item["assignment_roles"] == ["approver"]
    assert item["review_due_on"] == "2026-09-15"
    assert item["valid_to"] == "2027-08-01"
    assert other not in {row["document_id"] for row in result.json()["items"]}


def test_personal_pagination_filters_policy_before_offset(client, admin_headers, monkeypatch, db_session):
    hidden, _ = source(client, admin_headers, title="A hidden manual")
    visible, _ = source(client, admin_headers, title="B visible manual")
    db_session.get(Document, hidden).policy_hash = "denied-policy"
    db_session.commit()
    original = api.evaluate_runtime_document_access

    def authorize(principal, action, document, local_decision):
        if document.document_id == hidden:
            return replace(local_decision, allowed=False)
        return original(principal, action, document, local_decision)

    monkeypatch.setattr(api, "evaluate_runtime_document_access", authorize)
    result = client.get("/api/v1/workflow/documents?limit=1", headers=REVIEWER)
    assert result.status_code == 200
    assert result.json()["total"] == 1
    assert result.json()["items"][0]["document_id"] == visible


def test_personal_queue_fails_closed_when_policy_is_unavailable(client, admin_headers, monkeypatch):
    doc, version = source(client, admin_headers)
    submit(client, admin_headers, doc, version)

    def unavailable(*args, **kwargs):
        raise problem(503, "policy_unavailable", "Unavailable")

    monkeypatch.setattr(api, "evaluate_runtime_document_access", unavailable)
    for path in ("documents", "tasks?assigned_to_me=true"):
        assert client.get(f"/api/v1/workflow/{path}", headers=REVIEWER).status_code == 503


def test_personal_page_checks_exact_versions_only_for_visible_documents(client, admin_headers, monkeypatch):
    ids = [source(client, admin_headers, title=f"Manual {index}") for index in range(4)]
    original = api.require_global_action
    monkeypatch.setattr(api, "require_global_action", lambda *args, **kwargs: replace(
        original(*args, **kwargs), access_v2=True, capabilities=frozenset({"akb:read_document"}),
    ))
    checked = []
    monkeypatch.setattr(api, "require_document_version_action", lambda _p, _a, _d, version, _db: checked.append(version.document_version_id))
    response = client.get("/api/v1/workflow/documents?limit=1&offset=2", headers=REVIEWER)
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 4
    assert response.json()["items"][0]["document_id"] == ids[2][0]
    assert checked == [ids[2][1]]


def test_personal_filters_apply_before_paging(client, admin_headers):
    source(client, admin_headers, title="A unrelated manual")
    expected, _ = source(client, admin_headers, title="B selected manual", metadata={})
    response = client.get("/api/v1/workflow/documents?q=selected&assignment=approver&version_status=draft&deadline=missing&limit=1", headers=REVIEWER)
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["document_id"] == expected
    assert client.get("/api/v1/workflow/documents?assignment=managed", headers=REVIEWER).json()["total"] == 0
    assert client.get("/api/v1/workflow/documents?deadline=unexpected", headers=REVIEWER).status_code == 422


def test_reader_cannot_expand_personal_queue_or_approve(client, admin_headers, monkeypatch):
    own, own_version = source(client, admin_headers)
    mine = submit(client, admin_headers, own, own_version).json()["task_id"]
    other, other_version = source(client, admin_headers, title="Other person's manual", assignments=[
        {"role": "approver", "subject_type": "user", "subject_id": "other_reviewer", "is_primary": True},
    ])
    submit(client, admin_headers, other, other_version)
    original = api.require_global_action
    monkeypatch.setattr(api, "require_global_action", lambda *args, **kwargs: replace(
        original(*args, **kwargs), access_v2=True, capabilities=frozenset({"akb:read_document"}),
    ))
    monkeypatch.setattr(api, "require_document_version_action", lambda *args, **kwargs: None)
    for suffix in ("", "?assigned_to_me=false", "?limit=1&q=Application"):
        response = client.get(f"/api/v1/workflow/tasks{suffix}", headers=REVIEWER)
        assert response.status_code == 200, response.text
        assert response.json()["total"] == 1
        assert response.json()["items"][0]["task_id"] == mine
        assert response.json()["items"][0]["allowed_actions"] == []


def test_group_assignment_and_overdue_review_keep_original_approver(client, admin_headers, db_session):
    doc, version = source(client, admin_headers, assignments=[
        {"role": "approver", "subject_type": "group", "subject_id": "review_team", "is_primary": True},
    ])
    task = submit(client, admin_headers, doc, version).json()
    row = db_session.get(WorkflowTask, task["task_id"])
    row.due_at = datetime.now(timezone.utc) - timedelta(days=5)
    row.task_metadata = {**row.task_metadata, "escalation_subject_id": "another_user"}
    db_session.commit()
    group_headers = {**REVIEWER, "X-AKL-Groups": "review_team"}
    result = client.get("/api/v1/workflow/tasks?assigned_to_me=true&kind=review", headers=group_headers)
    assert result.status_code == 200, result.text
    assert result.json()["items"][0]["owner_id"] == "review_team"
    assert decide(client, group_headers, task["task_id"]).status_code == 200


def test_invalid_review_deadline_is_explicit(client, admin_headers):
    source(client, admin_headers, metadata={"review_due_on": "not-a-date"})
    item = client.get("/api/v1/workflow/documents", headers=REVIEWER).json()["items"][0]
    assert item["review_due_on"] is None
    assert item["review_date_invalid"] is True


def test_changed_approved_version_can_start_a_new_review(client, admin_headers, db_session):
    doc, version = source(client, admin_headers)
    first = submit(client, admin_headers, doc, version).json()
    assert decide(client, REVIEWER, first["task_id"]).status_code == 200
    db_session.get(Document, doc).title = "Updated manual"
    db_session.commit()
    second = submit(client, admin_headers, doc, version)
    assert second.status_code == 200, second.text
    assert second.json()["task_id"] != first["task_id"]
    assert db_session.get(DocumentVersion, version).status == "review"
    assert decide(client, REVIEWER, second.json()["task_id"]).status_code == 200
    assert client.post(f"/api/v1/documents/{doc}/versions/{version}/publish", headers=admin_headers).status_code == 200


def test_new_attachment_invalidates_pending_review(client, admin_headers, db_session):
    doc, version = source(client, admin_headers)
    task = submit(client, admin_headers, doc, version).json()
    db_session.add(DocumentFile(document_id=doc, document_version_id=version,
                               uri="s3://akl-documents/appendix", filename="appendix.pdf",
                               sha256="b" * 64, size_bytes=10, content_security_status="clean"))
    db_session.commit()
    response = decide(client, REVIEWER, task["task_id"])
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "review_source_changed"


def test_submitter_cannot_decide_their_own_bound_review(client, admin_headers):
    doc, version = source(client, admin_headers, assignments=[
        {"role": "approver", "subject_type": "group", "subject_id": "review-team", "is_primary": True},
    ])
    submitter = {**admin_headers, "X-AKL-Groups": "review-team"}
    task = submit(client, submitter, doc, version).json()
    assert task["assigned_to_me"] is True
    assert task["allowed_actions"] == []
    response = decide(client, submitter, task["task_id"])
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "review_self_approval_forbidden"


def test_return_feedback_is_visible_to_owner_but_not_in_audit(client, admin_headers):
    doc, version = source(client, admin_headers)
    task = submit(client, admin_headers, doc, version).json()
    feedback = "Please correct the appendix date."
    response = client.post(f"/api/v1/workflow/tasks/{task['task_id']}/actions", headers=REVIEWER,
                           json={"action": "request_changes", "comment": feedback})
    assert response.status_code == 200
    returned = client.get("/api/v1/workflow/tasks?assigned_to_me=true&kind=draft", headers=admin_headers).json()["items"]
    assert any(row["metadata"].get("last_comment") == feedback for row in returned)
    audit = client.get("/api/v1/audit/events?event_type=workflow.task.request_changes", headers=admin_headers)
    assert audit.status_code == 200
    assert feedback not in audit.text


@pytest.mark.parametrize("action", ["approve", "publish"])
def test_decision_and_publication_recheck_exact_version_policy(client, admin_headers, monkeypatch, db_session, action):
    doc, version = source(client, admin_headers)
    task = submit(client, admin_headers, doc, version).json()
    if action == "publish":
        assert decide(client, REVIEWER, task["task_id"]).status_code == 200
    original_global = api.require_global_action

    def access_v2(*args, **kwargs):
        return replace(original_global(*args, **kwargs), access_v2=True)

    def deny_publish(principal, operation, document, exact_version, db):
        assert exact_version.document_version_id == version
        if operation.value == "document.version.publish":
            raise problem(403, "policy_denied", "Denied")

    monkeypatch.setattr(api, "require_global_action", access_v2)
    monkeypatch.setattr(api, "require_document_version_action", deny_publish)
    response = decide(client, REVIEWER, task["task_id"], action)
    assert response.status_code == 403, response.text
    assert db_session.get(DocumentVersion, version).status != "valid"


def test_missing_effective_date_and_unexpected_fields_are_rejected(client, admin_headers):
    doc, _ = source(client, admin_headers)
    version = new_version(client, admin_headers, doc, "2", valid_from=None)
    response = submit(client, admin_headers, doc, version)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "review_source_incomplete"
    path = f"/api/v1/documents/{doc}/versions/{version}/submit-review"
    assert client.post(path, headers=admin_headers, json={"approver": "user_admin"}).status_code == 422
    assert client.post(path, headers=admin_headers, json={"comment": "x" * 1001}).status_code == 422


def test_approval_service_identity_is_denied(client, admin_headers, db_session):
    doc, version = source(client, admin_headers)
    task = submit(client, admin_headers, doc, version).json()
    response = decide(client, {**REVIEWER, "X-AKL-Service-Client-ID": "svc-governance"}, task["task_id"])
    assert response.status_code == 403
    assert db_session.get(DocumentVersion, version).status == "review"


def test_workflow_openapi_matches_runtime(client):
    stored = yaml.safe_load((Path(__file__).parents[1] / "openapi.yaml").read_text())
    runtime = client.app.openapi()
    for path in (
        "/api/v1/workflow/tasks", "/api/v1/workflow/documents",
        "/api/v1/documents/{document_id}/versions/{version_id}/submit-review",
    ):
        assert stored["paths"][path] == runtime["paths"][path]
    for name in (
        "DocumentReviewRequest", "WorkflowDocumentResponse", "WorkflowDocumentListResponse",
        "WorkflowTaskResponse", "WorkflowTaskListResponse",
    ):
        assert stored["components"]["schemas"][name] == runtime["components"]["schemas"][name]
