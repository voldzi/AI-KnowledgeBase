"""Materialize derived tasks off the request path, without publishing documents."""

import asyncio
import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import Settings
from app.database import SessionLocal


logger = logging.getLogger(__name__)


def maintain_workflow_tasks(db: Session) -> bool:
    from app.api import _escalate_overdue_tasks, _sync_derived_workflow_tasks

    # Serialize replicas without holding up reads or starting another writer.
    if db.get_bind().dialect.name == "postgresql" and not db.scalar(
        text("SELECT pg_try_advisory_xact_lock(1095451211, 1)")
    ):
        return False
    _sync_derived_workflow_tasks(db)
    db.flush()
    _escalate_overdue_tasks(db)
    return True


def run_workflow_maintenance_cycle() -> bool:
    with SessionLocal.begin() as db:
        return maintain_workflow_tasks(db)


async def workflow_maintenance_loop(settings: Settings) -> None:
    while True:
        try:
            completed = await asyncio.to_thread(run_workflow_maintenance_cycle)
            if completed:
                logger.info("workflow_maintenance_completed")
        except asyncio.CancelledError:
            raise
        except Exception:
            # Database errors may contain SQL parameters; never log the payload.
            logger.error("workflow_maintenance_failed")
        await asyncio.sleep(settings.workflow_maintenance_interval_seconds)
