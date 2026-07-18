from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from opentelemetry import metrics
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.audit import add_audit_event
from app.config import Settings
from app.database import SessionLocal
from app.models import (
    AuditEvent,
    AssistantConversation,
    utcnow,
)


logger = logging.getLogger(__name__)
meter = metrics.get_meter("akb.registry.assistant_retention")
expired_conversations_counter = meter.create_counter(
    "akb.assistant.conversations.expired",
    description="Assistant conversations selected after their retention deadline.",
    unit="{conversation}",
)
deleted_conversations_counter = meter.create_counter(
    "akb.assistant.conversations.deleted",
    description="Assistant conversations physically deleted.",
    unit="{conversation}",
)
deleted_messages_counter = meter.create_counter(
    "akb.assistant.messages.deleted",
    description="Assistant messages removed with a deleted conversation.",
    unit="{message}",
)
deleted_shares_counter = meter.create_counter(
    "akb.assistant.shares.deleted",
    description="Assistant sharing grants removed with a deleted conversation.",
    unit="{share}",
)
pruned_tombstones_counter = meter.create_counter(
    "akb.assistant.deletion_audits.pruned",
    description="Content-free assistant deletion audit records removed after audit retention.",
    unit="{audit_record}",
)

ASSISTANT_DELETION_EVENT_TYPES = (
    "assistant.conversation.deleted",
    "assistant.conversation.purged",
)


@dataclass(frozen=True)
class AssistantDeletionStats:
    conversations: int = 0
    messages: int = 0
    shares: int = 0
    audit_records_pruned: int = 0

    def plus(self, other: "AssistantDeletionStats") -> "AssistantDeletionStats":
        return AssistantDeletionStats(
            conversations=self.conversations + other.conversations,
            messages=self.messages + other.messages,
            shares=self.shares + other.shares,
            audit_records_pruned=(
                self.audit_records_pruned + other.audit_records_pruned
            ),
        )


def stage_assistant_conversation_deletion(
    db: Session,
    *,
    conversation: AssistantConversation,
    actor_id: str,
    reason: str,
    deleted_at: datetime | None = None,
) -> AssistantDeletionStats:
    """Stage a content-free audit tombstone and cascade delete in one transaction."""

    now = deleted_at or utcnow()
    stats = AssistantDeletionStats(
        conversations=1,
        messages=len(conversation.messages),
        shares=len(conversation.shares),
    )
    add_audit_event(
        db,
        actor_id=actor_id,
        event_type=(
            "assistant.conversation.purged"
            if reason == "retention"
            else "assistant.conversation.deleted"
        ),
        resource_type="assistant_conversation_tombstone",
        resource_id=conversation.conversation_id,
        metadata={
            "content_retained": False,
            "delete_reason": reason,
            "deleted_at": now.isoformat(),
            "message_count": stats.messages,
            "previous_status": conversation.status,
            "retention_until": (
                conversation.retention_until.isoformat()
                if conversation.retention_until
                else None
            ),
            "share_count": stats.shares,
        },
    )
    db.delete(conversation)
    return stats


def record_assistant_deletion_metrics(
    stats: AssistantDeletionStats,
    *,
    reason: str,
) -> None:
    attributes = {"reason": reason}
    if reason == "retention" and stats.conversations:
        expired_conversations_counter.add(stats.conversations, attributes)
    if stats.conversations:
        deleted_conversations_counter.add(stats.conversations, attributes)
    if stats.messages:
        deleted_messages_counter.add(stats.messages, attributes)
    if stats.shares:
        deleted_shares_counter.add(stats.shares, attributes)
    if stats.audit_records_pruned:
        pruned_tombstones_counter.add(stats.audit_records_pruned)


def purge_expired_assistant_conversations(
    db: Session,
    *,
    now: datetime | None = None,
    batch_size: int = 500,
    audit_retention_days: int = 730,
) -> AssistantDeletionStats:
    """Physically delete one locked batch of expired conversations."""

    effective_now = now or utcnow()
    statement = (
        select(AssistantConversation)
        .options(
            selectinload(AssistantConversation.messages),
            selectinload(AssistantConversation.shares),
        )
        .where(AssistantConversation.retention_until <= effective_now)
        .order_by(
            AssistantConversation.retention_until,
            AssistantConversation.conversation_id,
        )
        .limit(batch_size)
    )
    if db.get_bind().dialect.name == "postgresql":
        statement = statement.with_for_update(skip_locked=True)

    total = AssistantDeletionStats()
    conversations = list(db.execute(statement).scalars())
    for conversation in conversations:
        total = total.plus(
            stage_assistant_conversation_deletion(
                db,
                conversation=conversation,
                actor_id="system:assistant-retention",
                reason="retention",
                deleted_at=effective_now,
            )
        )

    audit_cutoff = effective_now - timedelta(days=audit_retention_days)
    pruned = db.execute(
        delete(AuditEvent).where(
            AuditEvent.event_type.in_(ASSISTANT_DELETION_EVENT_TYPES),
            AuditEvent.last_seen_at < audit_cutoff,
        ).execution_options(synchronize_session=False)
    )
    total = total.plus(
        AssistantDeletionStats(audit_records_pruned=int(pruned.rowcount or 0))
    )
    db.commit()
    record_assistant_deletion_metrics(total, reason="retention")
    return total


def run_assistant_purge_cycle(settings: Settings) -> AssistantDeletionStats:
    total = AssistantDeletionStats()
    while True:
        with SessionLocal() as db:
            batch = purge_expired_assistant_conversations(
                db,
                batch_size=settings.assistant_purge_batch_size,
                audit_retention_days=(
                    settings.assistant_deletion_audit_retention_days
                ),
            )
        total = total.plus(batch)
        if batch.conversations < settings.assistant_purge_batch_size:
            break
    logger.info(
        "assistant_conversation_purge_completed conversations=%s messages=%s "
        "shares=%s audit_records_pruned=%s",
        total.conversations,
        total.messages,
        total.shares,
        total.audit_records_pruned,
    )
    return total


async def assistant_purge_loop(settings: Settings) -> None:
    while True:
        try:
            await asyncio.to_thread(run_assistant_purge_cycle, settings)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("assistant_conversation_purge_failed")
        await asyncio.sleep(settings.assistant_purge_interval_seconds)
