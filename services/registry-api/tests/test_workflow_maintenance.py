import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app import api, workflow_maintenance
from app.models import WorkflowTask


def test_task_get_never_runs_maintenance_or_writes(client, admin_headers, db_session, monkeypatch):
    def unexpected(*args, **kwargs):
        raise AssertionError("Read endpoint must not perform maintenance or commit")

    monkeypatch.setattr(api, "_sync_derived_workflow_tasks", unexpected)
    monkeypatch.setattr(api, "_escalate_overdue_tasks", unexpected)
    monkeypatch.setattr(db_session, "commit", unexpected)
    response = client.get("/api/v1/workflow/tasks", headers=admin_headers)
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 0


def test_maintenance_does_not_wait_for_another_replica(monkeypatch):
    def unexpected(*args):
        raise AssertionError("Another replica owns maintenance")

    monkeypatch.setattr(api, "_sync_derived_workflow_tasks", unexpected)
    db = SimpleNamespace(get_bind=lambda: SimpleNamespace(dialect=SimpleNamespace(name="postgresql")), scalar=lambda _stmt: False)
    assert workflow_maintenance.maintain_workflow_tasks(db) is False


@pytest.mark.parametrize("fail_after_write", [False, True])
def test_cycle_commits_or_rolls_back_as_one_transaction(db_session, monkeypatch, fail_after_write):
    factory = sessionmaker(bind=db_session.get_bind(), autoflush=False)
    monkeypatch.setattr(workflow_maintenance, "SessionLocal", factory)

    def materialize(db):
        db.add(WorkflowTask(
            task_id="task_cycle_fixture", kind="review", priority="medium", status="open",
            title="Cycle fixture", description="Fixture", source="fixture", owner_label="Fixture",
            role="approver", due_at=datetime.now(timezone.utc),
        ))
        db.flush()
        if fail_after_write:
            raise RuntimeError("fixture failure after write")
        return True

    monkeypatch.setattr(workflow_maintenance, "maintain_workflow_tasks", materialize)
    if fail_after_write:
        with pytest.raises(RuntimeError, match="fixture failure"):
            workflow_maintenance.run_workflow_maintenance_cycle()
    else:
        assert workflow_maintenance.run_workflow_maintenance_cycle() is True
    with factory() as check:
        assert check.scalars(select(WorkflowTask.task_id)).all() == ([] if fail_after_write else ["task_cycle_fixture"])


def test_worker_failure_is_safely_logged_and_retried(monkeypatch, caplog):
    def fail():
        raise RuntimeError("sensitive SQL parameters must not be logged")

    async def stop(_seconds):
        raise asyncio.CancelledError()

    monkeypatch.setattr(workflow_maintenance, "run_workflow_maintenance_cycle", fail)
    monkeypatch.setattr(workflow_maintenance.asyncio, "sleep", stop)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(workflow_maintenance.workflow_maintenance_loop(SimpleNamespace(workflow_maintenance_interval_seconds=60)))
    assert "workflow_maintenance_failed" in caplog.text
    assert "sensitive SQL" not in caplog.text
