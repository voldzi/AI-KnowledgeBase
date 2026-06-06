def _create_document(client, headers, **overrides):
    payload = {
        "title": "Workflow source",
        "document_type": "directive",
        "owner_id": "user_owner",
        "gestor_unit": "Knowledge Ops",
        "classification": "internal",
        "tags": ["workflow"],
    }
    payload.update(overrides)
    response = client.post("/api/v1/documents", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_workflow_tasks_are_derived_from_document_state(client, admin_headers):
    document = _create_document(client, admin_headers, classification="restricted")
    patched = client.patch(
        f"/api/v1/documents/{document['document_id']}",
        headers=admin_headers,
        json={"status": "review"},
    )
    assert patched.status_code == 200, patched.text

    response = client.get("/api/v1/workflow/tasks", headers=admin_headers)
    assert response.status_code == 200, response.text
    tasks = response.json()["items"]
    source_keys = {task["source_key"] for task in tasks}

    assert f"document-review:{document['document_id']}" in source_keys
    assert f"document-governance:{document['document_id']}" in source_keys
    governance = next(task for task in tasks if task["kind"] == "governance")
    assert governance["priority"] == "high"
    assert governance["document_id"] == document["document_id"]


def test_document_creation_seeds_owner_and_gestor_assignments(client, admin_headers):
    document = _create_document(client, admin_headers, owner_id="user_owner", gestor_unit="Knowledge Ops")

    assignments = document["assignments"]
    roles = {assignment["role"]: assignment for assignment in assignments}
    assert roles["owner"]["subject_id"] == "user_owner"
    assert roles["owner"]["subject_type"] == "user"
    assert roles["owner"]["is_primary"] is True
    assert roles["owner"]["last_audit_event_id"]
    assert roles["gestor"]["subject_id"] == "Knowledge Ops"
    assert roles["gestor"]["subject_type"] == "unit"

    listed = client.get(f"/api/v1/documents/{document['document_id']}/assignments", headers=admin_headers)
    assert listed.status_code == 200, listed.text
    assert {item["role"] for item in listed.json()["items"]} == {"owner", "gestor"}


def test_document_assignments_drive_review_task_owner_sla_and_escalation(client, admin_headers):
    document = _create_document(client, admin_headers, classification="restricted")
    replaced = client.put(
        f"/api/v1/documents/{document['document_id']}/assignments",
        headers=admin_headers,
        json={
            "assignments": [
                {
                    "role": "owner",
                    "subject_type": "user",
                    "subject_id": "user_owner",
                    "display_label": "Document Owner",
                    "is_primary": True,
                    "sla_days": 5,
                },
                {
                    "role": "reviewer",
                    "subject_type": "user",
                    "subject_id": "user_reviewer",
                    "display_label": "Security Reviewer",
                    "is_primary": True,
                    "sla_days": 1,
                    "escalation_subject_type": "unit",
                    "escalation_subject_id": "Compliance",
                    "escalation_label": "Compliance escalation",
                },
                {
                    "role": "auditor",
                    "subject_type": "group",
                    "subject_id": "auditors",
                    "display_label": "Audit team",
                    "is_primary": True,
                    "sla_days": 2,
                },
            ]
        },
    )
    assert replaced.status_code == 200, replaced.text
    reviewer_assignment = next(item for item in replaced.json()["items"] if item["role"] == "reviewer")

    submitted = client.patch(
        f"/api/v1/documents/{document['document_id']}",
        headers=admin_headers,
        json={"status": "review"},
    )
    assert submitted.status_code == 200, submitted.text

    listed = client.get("/api/v1/workflow/tasks?kind=review", headers=admin_headers)
    assert listed.status_code == 200, listed.text
    task = next(item for item in listed.json()["items"] if item["document_id"] == document["document_id"])

    assert task["owner_id"] == "user_reviewer"
    assert task["owner_label"] == "Security Reviewer"
    assert task["metadata"]["assignment_id"] == reviewer_assignment["assignment_id"]
    assert task["metadata"]["assignment_role"] == "reviewer"
    assert task["metadata"]["sla_days"] == 1
    assert task["metadata"]["escalation_subject_id"] == "Compliance"


def test_workflow_tasks_include_warning_audit_events(client, admin_headers):
    created = client.post(
        "/api/v1/audit/events",
        headers=admin_headers,
        json={
            "actor_id": "svc-ingestion",
            "event_type": "ingestion.job.failed",
            "resource_type": "ingestion_job",
            "resource_id": "ing_123",
            "severity": "warning",
            "metadata": {"document_id": "doc_missing"},
        },
    )
    assert created.status_code == 201, created.text

    response = client.get("/api/v1/workflow/tasks?kind=audit", headers=admin_headers)
    assert response.status_code == 200, response.text
    tasks = response.json()["items"]

    assert len(tasks) == 1
    assert tasks[0]["audit_event_id"] == created.json()["audit_event_id"]
    assert tasks[0]["job_id"] == "ing_123"


def test_workflow_task_action_resolves_task_and_writes_audit(client, admin_headers):
    document = _create_document(client, admin_headers)
    listed = client.get("/api/v1/workflow/tasks?kind=draft", headers=admin_headers)
    assert listed.status_code == 200, listed.text
    task = next(item for item in listed.json()["items"] if item["document_id"] == document["document_id"])

    resolved = client.post(
        f"/api/v1/workflow/tasks/{task['task_id']}/actions",
        headers=admin_headers,
        json={"action": "resolve", "comment": "Handled in test."},
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "resolved"
    assert resolved.json()["resolved_at"]

    active_listing = client.get("/api/v1/workflow/tasks?kind=draft", headers=admin_headers)
    assert active_listing.status_code == 200
    assert task["task_id"] not in {item["task_id"] for item in active_listing.json()["items"]}

    audit = client.get("/api/v1/audit/events?event_type=workflow.task.resolve", headers=admin_headers)
    assert audit.status_code == 200
    assert audit.json()["items"][0]["resource_id"] == task["task_id"]


def test_workflow_task_request_changes_survives_derived_sync(client, admin_headers):
    document = _create_document(client, admin_headers)
    listed = client.get("/api/v1/workflow/tasks?kind=draft", headers=admin_headers)
    assert listed.status_code == 200, listed.text
    task = next(item for item in listed.json()["items"] if item["document_id"] == document["document_id"])

    changed = client.post(
        f"/api/v1/workflow/tasks/{task['task_id']}/actions",
        headers=admin_headers,
        json={"action": "request_changes", "comment": "Needs a source file."},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["status"] == "open"
    assert changed.json()["metadata"]["last_action"] == "request_changes"

    active_listing = client.get("/api/v1/workflow/tasks?kind=draft", headers=admin_headers)
    assert active_listing.status_code == 200
    refreshed = next(item for item in active_listing.json()["items"] if item["task_id"] == task["task_id"])
    assert refreshed["status"] == "open"
    assert refreshed["metadata"]["last_action"] == "request_changes"
    assert refreshed["metadata"]["document_status"] == "draft"


def test_review_workflow_approval_enables_publish_gate(client, admin_headers):
    document = _create_document(client, admin_headers)
    created_version = client.post(
        f"/api/v1/documents/{document['document_id']}/versions",
        headers=admin_headers,
        json={
            "version_label": "1.0",
            "valid_from": "2026-07-01",
            "valid_to": None,
            "source_file_uri": "s3://akl-documents/doc/ver/file.pdf",
            "file_hash": "sha256:abc",
            "change_summary": "Ready for approval.",
        },
    )
    assert created_version.status_code == 201, created_version.text
    submitted = client.patch(
        f"/api/v1/documents/{document['document_id']}",
        headers=admin_headers,
        json={"status": "review"},
    )
    assert submitted.status_code == 200, submitted.text

    listed = client.get("/api/v1/workflow/tasks?kind=review", headers=admin_headers)
    assert listed.status_code == 200, listed.text
    task = next(item for item in listed.json()["items"] if item["document_id"] == document["document_id"])

    approved = client.post(
        f"/api/v1/workflow/tasks/{task['task_id']}/actions",
        headers=admin_headers,
        json={"action": "approve", "comment": "Approved for publication."},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "resolved"

    document_after_approval = client.get(f"/api/v1/documents/{document['document_id']}", headers=admin_headers)
    assert document_after_approval.status_code == 200
    assert document_after_approval.json()["status"] == "approved"

    published = client.post(
        f"/api/v1/documents/{document['document_id']}/versions/{created_version.json()['document_version_id']}/publish",
        headers=admin_headers,
    )
    assert published.status_code == 200, published.text
    assert published.json()["status"] == "valid"


def test_workflow_action_audit_keeps_assignment_context(client, admin_headers):
    document = _create_document(client, admin_headers)
    replaced = client.put(
        f"/api/v1/documents/{document['document_id']}/assignments",
        headers=admin_headers,
        json={
            "assignments": [
                {
                    "role": "owner",
                    "subject_type": "user",
                    "subject_id": "user_owner",
                    "is_primary": True,
                },
                {
                    "role": "reviewer",
                    "subject_type": "user",
                    "subject_id": "user_reviewer",
                    "is_primary": True,
                    "sla_days": 2,
                    "escalation_subject_type": "user",
                    "escalation_subject_id": "user_escalation",
                },
            ]
        },
    )
    assert replaced.status_code == 200, replaced.text
    reviewer_assignment = next(item for item in replaced.json()["items"] if item["role"] == "reviewer")

    submitted = client.patch(
        f"/api/v1/documents/{document['document_id']}",
        headers=admin_headers,
        json={"status": "review"},
    )
    assert submitted.status_code == 200, submitted.text

    listed = client.get("/api/v1/workflow/tasks?kind=review", headers=admin_headers)
    assert listed.status_code == 200, listed.text
    task = next(item for item in listed.json()["items"] if item["document_id"] == document["document_id"])

    resolved = client.post(
        f"/api/v1/workflow/tasks/{task['task_id']}/actions",
        headers=admin_headers,
        json={"action": "request_changes", "comment": "Needs owner update."},
    )
    assert resolved.status_code == 200, resolved.text

    audit = client.get("/api/v1/audit/events?event_type=workflow.task.request_changes", headers=admin_headers)
    assert audit.status_code == 200, audit.text
    event = audit.json()["items"][0]
    assert event["metadata"]["assignment_id"] == reviewer_assignment["assignment_id"]
    assert event["metadata"]["assignment_role"] == "reviewer"
    assert event["metadata"]["escalation_subject_id"] == "user_escalation"
