import hashlib
import hmac
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import add_audit_event
from app.config import Settings, get_settings
from app.database import get_db
from app.middleware import get_correlation_id
from app.models import WebSession, make_id


router = APIRouter(prefix="/api/v1/internal/web-sessions", tags=["Web sessions"])
MAX_CLOCK_SKEW_SECONDS = 60


class WebSessionWrite(BaseModel):
    session_id_hash: str = Field(pattern="^[0-9a-f]{64}$")
    subject_id: str = Field(min_length=1, max_length=160)
    issuer: str = Field(min_length=1, max_length=512)
    client_id: str = Field(min_length=1, max_length=160)
    keycloak_session_id: str | None = Field(default=None, max_length=160)
    encrypted_payload: str = Field(min_length=40, max_length=65536)
    persistent: bool = False
    identity_validated_at: datetime
    last_seen_at: datetime
    idle_expires_at: datetime
    absolute_expires_at: datetime


class WebSessionPatch(BaseModel):
    encrypted_payload: str | None = Field(default=None, min_length=40, max_length=65536)
    identity_validated_at: datetime | None = None
    last_seen_at: datetime | None = None
    idle_expires_at: datetime | None = None
    revoked_reason: str | None = Field(default=None, max_length=80)


class WebSessionResponse(WebSessionWrite):
    session_id: str
    revoked_at: datetime | None = None
    revoked_reason: str | None = None
    created_at: datetime
    updated_at: datetime


def _canonical_body(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


async def _verify_internal_request(
    request: Request,
    settings: Settings = Depends(get_settings),
    timestamp: str = Header(alias="X-AKB-Session-Timestamp"),
    signature: str = Header(alias="X-AKB-Session-Signature"),
) -> bytes:
    try:
        issued_at = int(timestamp)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid session store signature.") from exc
    if abs(int(time.time()) - issued_at) > MAX_CLOCK_SKEW_SECONDS:
        raise HTTPException(status_code=401, detail="Expired session store signature.")
    body = await request.body()
    canonical = "\n".join(
        [timestamp, request.method.upper(), request.url.path, _canonical_body(body)]
    ).encode("utf-8")
    expected = hmac.new(
        settings.web_session_store_signing_secret.encode("utf-8"),
        canonical,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Invalid session store signature.")
    return body


def _response(record: WebSession) -> WebSessionResponse:
    return WebSessionResponse.model_validate(record, from_attributes=True)


@router.post("", response_model=WebSessionResponse, status_code=201)
async def create_web_session(
    request: Request,
    db: Session = Depends(get_db),
    _: bytes = Depends(_verify_internal_request),
) -> WebSessionResponse:
    payload = WebSessionWrite.model_validate_json(await request.body())
    if payload.idle_expires_at > payload.absolute_expires_at:
        raise HTTPException(status_code=422, detail="Idle expiry exceeds absolute expiry.")
    record = WebSession(session_id=make_id("sess"), **payload.model_dump())
    db.add(record)
    add_audit_event(
        db,
        actor_id=record.subject_id,
        event_type="auth.web_session.created",
        resource_type="web_session",
        resource_id=record.session_id,
        metadata={"persistent": record.persistent, "client_id": record.client_id},
        correlation_id=get_correlation_id(),
    )
    db.commit()
    db.refresh(record)
    return _response(record)


@router.get("/{session_id_hash}", response_model=WebSessionResponse)
async def get_web_session(
    session_id_hash: str,
    db: Session = Depends(get_db),
    _: bytes = Depends(_verify_internal_request),
) -> WebSessionResponse:
    record = db.scalar(select(WebSession).where(WebSession.session_id_hash == session_id_hash))
    if record is None:
        raise HTTPException(status_code=404, detail="Web session not found.")
    return _response(record)


@router.get("/subjects/{subject_id}/sessions", response_model=list[WebSessionResponse])
async def list_subject_sessions(
    subject_id: str,
    db: Session = Depends(get_db),
    _: bytes = Depends(_verify_internal_request),
) -> list[WebSessionResponse]:
    records = db.scalars(
        select(WebSession)
        .where(WebSession.subject_id == subject_id, WebSession.revoked_at.is_(None))
        .order_by(WebSession.last_seen_at.desc())
    ).all()
    return [_response(record) for record in records]


@router.patch("/{session_id_hash}", response_model=WebSessionResponse)
async def update_web_session(
    session_id_hash: str,
    request: Request,
    db: Session = Depends(get_db),
    _: bytes = Depends(_verify_internal_request),
) -> WebSessionResponse:
    payload = WebSessionPatch.model_validate_json(await request.body())
    record = db.scalar(select(WebSession).where(WebSession.session_id_hash == session_id_hash))
    if record is None:
        raise HTTPException(status_code=404, detail="Web session not found.")
    values = payload.model_dump(exclude_none=True)
    revoked_reason = values.pop("revoked_reason", None)
    for key, value in values.items():
        setattr(record, key, value)
    if revoked_reason:
        record.revoked_at = datetime.now(timezone.utc)
        record.revoked_reason = revoked_reason
        add_audit_event(
            db,
            actor_id=record.subject_id,
            event_type="auth.web_session.revoked",
            resource_type="web_session",
            resource_id=record.session_id,
            metadata={"reason": revoked_reason},
            correlation_id=get_correlation_id(),
        )
    db.commit()
    db.refresh(record)
    return _response(record)


@router.delete("/{session_id_hash}", status_code=204)
async def revoke_web_session(
    session_id_hash: str,
    db: Session = Depends(get_db),
    _: bytes = Depends(_verify_internal_request),
) -> Response:
    record = db.scalar(select(WebSession).where(WebSession.session_id_hash == session_id_hash))
    if record is not None and record.revoked_at is None:
        record.revoked_at = datetime.now(timezone.utc)
        record.revoked_reason = "logout"
        add_audit_event(
            db,
            actor_id=record.subject_id,
            event_type="auth.web_session.revoked",
            resource_type="web_session",
            resource_id=record.session_id,
            metadata={"reason": "logout"},
            correlation_id=get_correlation_id(),
        )
        db.commit()
    return Response(status_code=204)


@router.delete("/subjects/{subject_id}/all", status_code=204)
async def revoke_subject_sessions(
    subject_id: str,
    db: Session = Depends(get_db),
    _: bytes = Depends(_verify_internal_request),
) -> Response:
    now = datetime.now(timezone.utc)
    records = db.scalars(
        select(WebSession).where(WebSession.subject_id == subject_id, WebSession.revoked_at.is_(None))
    ).all()
    for record in records:
        record.revoked_at = now
        record.revoked_reason = "global_logout"
        add_audit_event(
            db,
            actor_id=subject_id,
            event_type="auth.web_session.revoked",
            resource_type="web_session",
            resource_id=record.session_id,
            metadata={"reason": "global_logout"},
            correlation_id=get_correlation_id(),
        )
    db.commit()
    return Response(status_code=204)


@router.delete("/subjects/{subject_id}/sessions/{session_id}", status_code=204)
async def revoke_subject_session(
    subject_id: str,
    session_id: str,
    db: Session = Depends(get_db),
    _: bytes = Depends(_verify_internal_request),
) -> Response:
    record = db.scalar(
        select(WebSession).where(
            WebSession.subject_id == subject_id,
            WebSession.session_id == session_id,
        )
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Web session not found.")
    if record.revoked_at is None:
        record.revoked_at = datetime.now(timezone.utc)
        record.revoked_reason = "device_revoked"
        add_audit_event(
            db,
            actor_id=subject_id,
            event_type="auth.web_session.revoked",
            resource_type="web_session",
            resource_id=record.session_id,
            metadata={"reason": "device_revoked"},
            correlation_id=get_correlation_id(),
        )
        db.commit()
    return Response(status_code=204)
