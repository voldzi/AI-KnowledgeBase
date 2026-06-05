from typing import Any

from sqlalchemy.orm import Session

from app.middleware import get_correlation_id
from app.models import AuditEvent


def add_audit_event(
    db: Session,
    *,
    actor_id: str,
    event_type: str,
    resource_type: str,
    resource_id: str,
    severity: str = "info",
    metadata: dict[str, Any] | None = None,
    correlation_id: str | None = None,
) -> AuditEvent:
    event = AuditEvent(
        actor_id=actor_id,
        event_type=event_type,
        resource_type=resource_type,
        resource_id=resource_id,
        severity=severity,
        correlation_id=correlation_id or get_correlation_id(),
        event_metadata=metadata or {},
    )
    db.add(event)
    return event
