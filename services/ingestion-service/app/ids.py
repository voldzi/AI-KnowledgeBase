from __future__ import annotations

import uuid
from datetime import UTC, datetime


def make_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def utcnow() -> datetime:
    return datetime.now(UTC)
