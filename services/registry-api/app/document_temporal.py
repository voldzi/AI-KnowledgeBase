"""Resolve a publication timeline without rewriting immutable validity dates."""

from collections.abc import Iterable
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from app.models import DocumentVersion


def document_calendar_today() -> date:
    return datetime.now(ZoneInfo("Europe/Prague")).date()


def effective_document_version(
    versions: Iterable[DocumentVersion], applicable_on: date,
) -> DocumentVersion | None:
    """Pick the latest started publication, then check its withdrawal/expiry.

    A later publication is a timeline boundary even if it has since expired or
    been withdrawn. Falling back to an earlier open-ended version would silently
    revive replaced rules. Drafts and never-published cancellations do not count.
    """
    started = [
        version for version in versions
        if (version.status == "valid" or (
            version.status in {"superseded", "archived", "cancelled"}
            and version.published_at is not None
        ))
        and (_timeline_start(version) is None or _timeline_start(version) <= applicable_on)
    ]
    if not started:
        return None
    latest = max(started, key=_publication_order)
    if latest.status != "valid" or (
        latest.valid_to is not None and latest.valid_to < applicable_on
    ):
        return None
    return latest


def _publication_order(version: DocumentVersion) -> tuple:
    def utc(value: datetime | None) -> datetime:
        if value is None:
            return datetime.min.replace(tzinfo=timezone.utc)
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)

    return (
        _timeline_start(version) or date.min,
        utc(version.published_at or version.created_at),
        utc(version.created_at),
        version.document_version_id,
    )


def _timeline_start(version: DocumentVersion) -> date | None:
    # A record becomes available from its explicit creation date. This is not
    # normative/legal effectivity and never writes valid_from/valid_to.
    snapshot = version.profile_snapshot
    if snapshot is not None:
        lifecycle = snapshot.payload.get("lifecycle", {})
        if lifecycle.get("mode") == "record":
            recorded_on = lifecycle.get("recordedOn")
            try:
                return date.fromisoformat(recorded_on) if isinstance(recorded_on, str) else date.max
            except ValueError:
                return date.max
    return version.valid_from
