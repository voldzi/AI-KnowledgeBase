import hashlib
import hmac
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError
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
    model_config = ConfigDict(extra="forbid")
    session_id_hash: str = Field(pattern="^[0-9a-f]{64}$")
    subject_id: str = Field(min_length=1, max_length=160)
    issuer: str = Field(min_length=1, max_length=512)
    client_id: str = Field(min_length=1, max_length=160)
    keycloak_session_id: str | None = Field(default=None, max_length=160)
    encrypted_payload: str = Field(min_length=40, max_length=65536)
    persistent: bool = Field(default=False, strict=True)
    identity_validated_at: AwareDatetime
    last_seen_at: AwareDatetime
    idle_expires_at: AwareDatetime
    absolute_expires_at: AwareDatetime


class WebSessionPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_updated_at: AwareDatetime | None = None
    encrypted_payload: str | None = Field(default=None, min_length=40, max_length=65536)
    identity_validated_at: AwareDatetime | None = None
    last_seen_at: AwareDatetime | None = None
    idle_expires_at: AwareDatetime | None = None
    absolute_expires_at: AwareDatetime | None = None
    persistent: bool | None = Field(default=None, strict=True)
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
    values = {key: getattr(record, key) for key in WebSessionResponse.model_fields}
    return WebSessionResponse.model_validate({key: _utc(value) if isinstance(value, datetime) else value for key, value in values.items()})


def _payload(model: type[BaseModel], body: bytes):
    try:
        return model.model_validate_json(body)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail="Invalid session store request.") from exc


@router.post("", response_model=WebSessionResponse, status_code=201, openapi_extra={
    "requestBody": {"required": True, "content": {"application/json": {"schema": WebSessionWrite.model_json_schema()}}},
})
async def create_web_session(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _: bytes = Depends(_verify_internal_request),
) -> WebSessionResponse:
    payload = _payload(WebSessionWrite, await request.body())
    if payload.idle_expires_at > payload.absolute_expires_at:
        raise HTTPException(status_code=422, detail="Idle expiry exceeds absolute expiry.")
    now = datetime.now(timezone.utc)
    idle, absolute = _session_ttls(payload.persistent)
    if not now < payload.absolute_expires_at <= now + absolute or not now < payload.idle_expires_at <= now + idle or not now - timedelta(minutes=15) <= payload.identity_validated_at <= now + timedelta(seconds=5) or payload.last_seen_at > now + timedelta(seconds=5):
        raise HTTPException(status_code=422, detail="Session lifetime is invalid.")
    if settings.identity_mode == "managed" and payload.issuer != settings.managed_identity_issuer:
        raise HTTPException(status_code=422, detail="Managed session binding is invalid.")
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


@router.patch("/{session_id_hash}", response_model=WebSessionResponse, openapi_extra={
    "requestBody": {"required": True, "content": {"application/json": {"schema": WebSessionPatch.model_json_schema()}}},
    "responses": {"409": {"description": "Expired, revoked or concurrently changed session; token and policy rotation require expected_updated_at."}},
})
async def update_web_session(
    session_id_hash: str,
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _: bytes = Depends(_verify_internal_request),
) -> WebSessionResponse:
    payload = _payload(WebSessionPatch, await request.body())
    record = db.scalar(select(WebSession).where(WebSession.session_id_hash == session_id_hash).with_for_update())
    if record is None:
        raise HTTPException(status_code=404, detail="Web session not found.")
    values = payload.model_dump(exclude_none=True)
    revoked_reason = values.pop("revoked_reason", None)
    expected_updated_at = values.pop("expected_updated_at", None)
    now = datetime.now(timezone.utc)
    if not revoked_reason:
        if record.revoked_at is not None or min(_utc(record.idle_expires_at), _utc(record.absolute_expires_at)) <= now:
            raise HTTPException(status_code=409, detail="Web session is no longer active.")
        if expected_updated_at is not None and _utc(record.updated_at) != _utc(expected_updated_at):
            raise HTTPException(status_code=409, detail="Web session changed concurrently.")
        if {"encrypted_payload", "absolute_expires_at", "persistent"} & values.keys() and expected_updated_at is None:
            raise HTTPException(status_code=409, detail="Token or policy rotation requires a session revision.")
        absolute = values.get("absolute_expires_at", _utc(record.absolute_expires_at))
        persistent = values.get("persistent", record.persistent)
        if absolute > _utc(record.absolute_expires_at) or absolute <= now or (persistent and not record.persistent):
            raise HTTPException(status_code=422, detail="Session policy cannot extend an existing session.")
        idle = values.get("idle_expires_at", _utc(record.idle_expires_at))
        if idle > absolute:
            raise HTTPException(status_code=422, detail="Idle expiry exceeds absolute expiry.")
        maximum_idle, _ = _session_ttls(persistent)
        if idle > now + maximum_idle or any(values.get(key, now) > now + timedelta(seconds=5) for key in ("identity_validated_at", "last_seen_at")):
            raise HTTPException(status_code=422, detail="Session lifetime is invalid.")
        if settings.identity_mode == "managed" and record.issuer != settings.managed_identity_issuer:
            raise HTTPException(status_code=422, detail="Managed session binding is invalid.")
    elif record.revoked_at is not None:
        return _response(record)
    if revoked_reason:
        values = {}
    for key, value in values.items():
        setattr(record, key, value)
    if revoked_reason:
        record.revoked_at = now
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


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _session_ttls(persistent: bool) -> tuple[timedelta, timedelta]:
    return (timedelta(days=30), timedelta(days=90)) if persistent else (timedelta(hours=8), timedelta(hours=24))


@router.delete("/{session_id_hash}", status_code=204)
async def revoke_web_session(
    session_id_hash: str,
    db: Session = Depends(get_db),
    _: bytes = Depends(_verify_internal_request),
) -> Response:
    record = db.scalar(select(WebSession).where(WebSession.session_id_hash == session_id_hash).with_for_update())
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
        select(WebSession).where(WebSession.subject_id == subject_id, WebSession.revoked_at.is_(None)).with_for_update()
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
        ).with_for_update()
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
